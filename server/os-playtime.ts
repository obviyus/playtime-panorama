import type { CachedPlaytimeRecord } from "~/server/database";
import type { SteamGame } from "~/server/steam";

export const PLATFORM_FIELDS = [
	"playtime_windows_forever",
	"playtime_mac_forever",
	"playtime_linux_forever",
	"playtime_deck_forever",
] as const satisfies readonly (keyof SteamGame)[];

export type PlatformPlaytimeField = (typeof PLATFORM_FIELDS)[number];

export function gameHasPlatformData(game: SteamGame): boolean {
	return PLATFORM_FIELDS.every((field) => field in game);
}

export function recordNeedsPlatformData(record: CachedPlaytimeRecord): boolean {
	if (!record.payload?.games?.length) {
		return false;
	}

	return record.payload.games.some((game) => !gameHasPlatformData(game));
}

export function filterRecordsNeedingPlatformData(
	records: CachedPlaytimeRecord[],
): CachedPlaytimeRecord[] {
	return records.filter(recordNeedsPlatformData);
}
