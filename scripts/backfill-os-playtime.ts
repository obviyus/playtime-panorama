import "~/server/set-working-directory";
import {
	listCachedPlaytimeRecords,
	type CachedPlaytimeRecord,
} from "~/server/database";
import { getPlaytimePayload, type SteamGame } from "~/server/steam";

const PLATFORM_FIELDS = [
	"playtime_windows_forever",
	"playtime_mac_forever",
	"playtime_linux_forever",
	"playtime_deck_forever",
] as const satisfies readonly (keyof SteamGame)[];

function hasPlatformData(game: SteamGame): boolean {
	return PLATFORM_FIELDS.every((field) => field in game);
}

function needsEnrichment(record: CachedPlaytimeRecord): boolean {
	if (!record.payload?.games?.length) {
		return false;
	}

	return record.payload.games.some((game) => !hasPlatformData(game));
}

async function main() {
	if (!Bun.env.STEAM_API_KEY) {
		console.error("STEAM_API_KEY must be set to enrich playtime records.");
		process.exit(1);
	}

	const cachedRecords = await listCachedPlaytimeRecords({ includeExpired: true });
	const targets = cachedRecords.filter(needsEnrichment);

	if (!targets.length) {
		console.log("All cached playtime records already include per-platform data.");
		return;
	}

	console.log(
		`Found ${targets.length} cached profile${targets.length === 1 ? "" : "s"} missing platform data.`,
	);

	let updated = 0;
	for (const [index, record] of targets.entries()) {
		const prefix = `[${index + 1}/${targets.length}]`;
		try {
			console.log(`${prefix} Refreshing ${record.steamId}...`);
			await getPlaytimePayload(record.steamId, { forceRefresh: true });
			updated += 1;
		} catch (error) {
			console.error(`${prefix} Failed to refresh ${record.steamId}:`, error);
		}
	}

	console.log(`Enrichment complete. Updated ${updated} profile${updated === 1 ? "" : "s"}.`);
}

await main();
