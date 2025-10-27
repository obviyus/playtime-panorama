import "~/server/set-working-directory";
import {
	getPlaytimePayload,
	getVanityResolution,
	SteamIdentifierError,
} from "~/server/steam";
import { getLeaderboardSnapshot } from "~/server/leaderboard";
import {
	formatOsPlaytimeBackfillStatus,
	startOsPlaytimeBackfill,
} from "~/server/backfill/os-playtime";
import leaderboardBundle from "~/templates/leaderboard.html";
import profileBundle from "~/templates/profile.html";
import rootBundle from "~/templates/root.html";

const DEFAULT_PORT = Number(Bun.env.PORT ?? Bun.env.BUN_PORT ?? 3000);
const developmentMode = Bun.env.NODE_ENV !== "production";

if (!Bun.env.STEAM_API_KEY) {
	console.warn("Missing STEAM_API_KEY. /api/playtime requests will fail.");
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
					resolvedSteamID = await getVanityResolution(identifier);
				} catch (error) {
					if (error instanceof SteamIdentifierError) {
						console.warn(
							`Steam vanity resolution failed for "${identifier}": ${error.message}`,
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
					const payload = await getPlaytimePayload(resolvedSteamID);

					return Response.json(
						{
							...payload,
							steamID: resolvedSteamID,
							resolvedFrom:
								resolvedSteamID === identifier.trim() ? undefined : identifier,
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
		"/api/backfill/os-playtime": {
			GET: async (req) => {
				const adminKey = Bun.env.ADMIN_KEY;
				const url = new URL(req.url);
				const providedAdminKey = url.searchParams.get("ADMIN_KEY") ?? "";

				if (!adminKey || providedAdminKey !== adminKey) {
					return new Response("Forbidden\n", {
						status: 403,
						headers: {
							"Content-Type": "text/plain; charset=utf-8",
						},
					});
				}

				const apiKeyParam = url.searchParams.get("STEAM_API_KEY");
				const shouldStart = apiKeyParam !== null;
				const apiKeyOverride = apiKeyParam?.trim()
					? apiKeyParam.trim()
					: undefined;

				let statusCode = 200;
				let prefix = "";

				if (shouldStart) {
					if (!apiKeyOverride && !Bun.env.STEAM_API_KEY) {
						prefix = "A STEAM_API_KEY must be provided to start the backfill.\n";
						statusCode = 400;
					} else {
						const startResult = startOsPlaytimeBackfill({
							apiKeyOverride,
						});

						if (startResult.started) {
							prefix = "Backfill job started.\n";
							statusCode = 202;
						} else {
							prefix = `${startResult.reason ?? "A backfill job is already running."}\n`;
							statusCode = 409;
						}
					}
				}

				const body = `${prefix}${formatOsPlaytimeBackfillStatus()}`;
				return new Response(body, {
					status: statusCode,
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
					},
				});
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
