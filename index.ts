import "./set-working-directory";
import {
	getPlaytimePayload,
	getVanityResolution,
	SteamIdentifierError,
} from "./steam";
import profileBundle from "./templates/profile.html";
import rootBundle from "./templates/root.html";

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
		"/": rootBundle,
		"/:steamID": profileBundle,
	},
	fetch() {
		return new Response("Not Found", { status: 404 });
	},
});

console.log(`playtime-panorama server running on ${server.url}...`);
