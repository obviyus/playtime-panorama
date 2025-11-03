import "~/server/set-working-directory";
import {
	getPlaytimePayload,
	getVanityResolution,
	SteamIdentifierError,
} from "~/server/steam";
import { getLeaderboardSnapshot } from "~/server/leaderboard";
import leaderboardBundle from "~/templates/leaderboard.html";
import profileBundle from "~/templates/profile.html";
import rootBundle from "~/templates/root.html";

const DEFAULT_PORT = Number(Bun.env.PORT ?? Bun.env.BUN_PORT ?? 3000);
const developmentMode = Bun.env.NODE_ENV !== "production";

if (!Bun.env.STEAM_API_KEY) {
	console.warn("Missing STEAM_API_KEY. /api/playtime requests will fail.");
}

type PlaytimePayloadLoader = (
	steamID: string,
	apiKeyOverride?: string,
) => Promise<{
	game_count: number;
	games: unknown[];
}>;

async function createPlaytimeResponse(
	identifier: string,
	loadPayload: PlaytimePayloadLoader,
	apiKeyOverride?: string,
) {
	const trimmed = identifier.trim();

	if (!trimmed) {
		return Response.json(
			{ error: "Steam identifier is required." },
			{ status: 400 },
		);
	}

	let resolvedSteamID: string;

	try {
		resolvedSteamID = await getVanityResolution(trimmed, apiKeyOverride);
	} catch (error) {
		if (error instanceof SteamIdentifierError) {
			console.warn(
				`Steam vanity resolution failed for "${trimmed}": ${error.message}`,
			);
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
		const payload = await loadPayload(resolvedSteamID, apiKeyOverride);
		return Response.json(
			{
				...payload,
				steamID: resolvedSteamID,
				resolvedFrom:
					resolvedSteamID === trimmed ? undefined : trimmed,
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
				const apiKey = new URL(req.url).searchParams.get('api_key') ||
							   req.headers.get('X-Steam-API-Key') ||
							   undefined;
				return createPlaytimeResponse(
					req.params.identifier ?? "",
					(steamID, apiKeyOverride) => getPlaytimePayload(steamID, apiKeyOverride),
					apiKey
				);
			},
		},
		"/leaderboard": leaderboardBundle,
		"/api/leaderboard": {
			GET: async () => {
				try {
					const snapshot = await getLeaderboardSnapshot();
					return Response.json(snapshot, {
						headers: {
							"Cache-Control": "no-store",
						},
					});
				} catch (error) {
					console.error("Failed to load leaderboard snapshot", error);
					return Response.json(
						{ error: "Unable to load leaderboard right now." },
						{ status: 500 },
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

console.log(`playtime-panorama server running on ${server.url}...`);
