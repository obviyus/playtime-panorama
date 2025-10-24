import { config } from "dotenv";

config();

const STEAM_API_BASE =
	"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const STEAM_CDN_BASE = "https://cdn.steamstatic.com/steam/apps";
const DEFAULT_PORT = Number(Bun.env.PORT ?? Bun.env.BUN_PORT ?? 3000);

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

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&#39;";
			default:
				return char;
		}
	});
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

	return data.response ?? { game_count: 0, games: [] };
}

async function loadTemplate(templateName: string) {
	const file = Bun.file(
		new URL(`./templates/${templateName}`, import.meta.url),
	);
	return file.text();
}

const [rootTemplate, profileTemplate] = await Promise.all([
	loadTemplate("root.html"),
	loadTemplate("profile.html"),
]);

function applyTemplate(template: string, replacements: Record<string, string>) {
	let output = template;
	for (const [key, value] of Object.entries(replacements)) {
		output = output.split(key).join(value);
	}
	return output;
}

function rootHtml() {
	return rootTemplate;
}

function steamProfileHtml(steamID: string) {
	const safeSteamID = escapeHtml(steamID);
	return applyTemplate(profileTemplate, {
		__STEAM_ID_HTML__: safeSteamID,
		__STEAM_ID_JSON__: JSON.stringify(steamID),
		__STEAM_CDN_BASE__: JSON.stringify(STEAM_CDN_BASE),
	});
}

const server = Bun.serve({
	port: DEFAULT_PORT,
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
		"/": () =>
			new Response(rootHtml(), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			}),
		"/:steamID": (req) =>
			new Response(steamProfileHtml(req.params.steamID), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			}),
	},
	fetch() {
		return new Response("Not Found", { status: 404 });
	},
});

console.log(`Steam collage server running on ${server.url}`);
