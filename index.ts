import profileBundle from "./templates/profile.html";
import rootBundle from "./templates/root.html";

const STEAM_API_BASE =
	"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const STEAM_VANITY_API_BASE =
	"https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/";
const DEFAULT_PORT = Number(Bun.env.PORT ?? Bun.env.BUN_PORT ?? 3000);
const developmentMode = Bun.env.NODE_ENV !== "production";

interface SteamGame {
	appid: number;
	name?: string;
	playtime_forever: number;
	rtime_last_played?: number;
}

interface SteamOwnedGamesResponse {
	response?: {
		game_count: number;
		games?: SteamGame[];
	};
}

interface SteamResolveVanityResponse {
	response?: {
		success: number;
		steamid?: string;
		message?: string;
	};
}

class SteamIdentifierError extends Error {
	status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "SteamIdentifierError";
		this.status = status;
	}
}

const steamIdPattern = /^\d{17}$/;

if (!Bun.env.STEAM_API_KEY) {
	console.warn("Missing STEAM_API_KEY. /api/playtime requests will fail.");
}

function buildSteamRequestUrl(steamID: string, apiKey: string) {
	const params = new URLSearchParams({
		key: apiKey,
		steamid: steamID,
		include_appinfo: "1",
		include_played_free_games: "1",
	});

	return `${STEAM_API_BASE}?${params.toString()}`;
}

function buildVanityResolveUrl(identifier: string, apiKey: string) {
	const params = new URLSearchParams({
		key: apiKey,
		vanityurl: identifier,
	});

	return `${STEAM_VANITY_API_BASE}?${params.toString()}`;
}

async function resolveSteamIdentifier(rawIdentifier: string) {
	const identifier = rawIdentifier.trim();

	if (!identifier) {
		throw new SteamIdentifierError("Steam identifier is required.");
	}

	if (steamIdPattern.test(identifier)) {
		return identifier;
	}

	const apiKey = Bun.env.STEAM_API_KEY;

	if (!apiKey) {
		throw new SteamIdentifierError("STEAM_API_KEY is not configured", 500);
	}

	const requestUrl = buildVanityResolveUrl(identifier, apiKey);
	const response = await fetch(requestUrl);

	if (!response.ok) {
		const errorBody = await response.text();
		throw new SteamIdentifierError(
			`Steam API error (${response.status}): ${errorBody.slice(0, 200)}`,
			502,
		);
	}

	const payload = (await response.json()) as SteamResolveVanityResponse;
	const { success: successCode = 0, steamid, message } = payload.response ?? {};

	if (successCode === 1 && steamid) {
		return steamid;
	}

	if (successCode === 42) {
		throw new SteamIdentifierError(
			message ?? "No vanity URL match found.",
			404,
		);
	}

	throw new SteamIdentifierError(
		message ?? "Unable to resolve the vanity URL.",
		502,
	);
}

async function fetchPlaytimeFromSteam(steamID: string) {
	const apiKey = Bun.env.STEAM_API_KEY;

	if (!apiKey) {
		throw new Error("STEAM_API_KEY is not configured");
	}

	const requestUrl = buildSteamRequestUrl(steamID, apiKey);
	const steamResponse = await fetch(requestUrl);

	if (!steamResponse.ok) {
		const errorBody = await steamResponse.text();
		throw new Error(
			`Steam API error (${steamResponse.status}): ${errorBody.slice(0, 200)}`,
		);
	}

	const data = (await steamResponse.json()) as SteamOwnedGamesResponse;
	console.log(
		`Found ${data.response?.game_count ?? 0} games for SteamID ${steamID}`,
	);

	const response = data.response ?? { game_count: 0, games: [] };
	const games =
		response.games?.filter((game) => game.playtime_forever > 10) ?? [];

	return {
		game_count: games.length,
		games,
	};
}

const server = Bun.serve({
	port: DEFAULT_PORT,
	development: developmentMode
		? {
				hmr: true,
				console: true,
			}
		: false,
	routes: {
		"/api/playtime/:identifier": {
			GET: async (req) => {
				const { identifier } = req.params;

				if (!identifier) {
					return Response.json(
						{ error: "Steam identifier is required." },
						{ status: 400 },
					);
				}

				let resolvedSteamID: string;

				try {
					resolvedSteamID = await resolveSteamIdentifier(identifier);
				} catch (error) {
					if (error instanceof SteamIdentifierError) {
						console.error(error);
						return Response.json(
							{ error: error.message },
							{ status: error.status },
						);
					}

					console.error(error);
					return Response.json(
						{ error: "Unable to resolve the Steam identifier." },
						{ status: 502 },
					);
				}

				try {
					const payload = await fetchPlaytimeFromSteam(resolvedSteamID);
					return Response.json(
						{
							...payload,
							steamID: resolvedSteamID,
							resolvedFrom:
								resolvedSteamID === identifier ? undefined : identifier,
						},
						{
							headers: {
								"Cache-Control": "s-maxage=300, stale-while-revalidate=900",
							},
						},
					);
				} catch (error) {
					console.error(error);
					return Response.json(
						{ error: "Unable to fetch playtime data from Steam." },
						{ status: 502 },
					);
				}
			},
		},
		"/": rootBundle,
		"/:steamID": profileBundle,
	},
	fetch() {
		return new Response("Not Found", { status: 404 });
	},
});

console.log(`Steam collage server running on ${server.url}`);
