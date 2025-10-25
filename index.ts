import profileBundle from "./templates/profile.html";
import rootBundle from "./templates/root.html";

const STEAM_API_BASE =
	"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
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
		"/api/playtime/:steamID": {
			GET: async (req) => {
				const { steamID } = req.params;

				if (!steamID) {
					return Response.json(
						{ error: "steamID is required." },
						{ status: 400 },
					);
				}

				try {
					const payload = await fetchPlaytimeFromSteam(steamID);
					return Response.json(payload, {
						headers: {
							"Cache-Control": "s-maxage=300, stale-while-revalidate=900",
						},
					});
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
