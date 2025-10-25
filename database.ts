import { SQL } from "bun";
import type { SteamGame } from "./steam";

const DEFAULT_CACHE_URL = "sqlite://./steam-cache.db";
const cacheUrl = Bun.env.STEAM_CACHE_URL ?? DEFAULT_CACHE_URL;

const sql =
	cacheUrl === ":memory:" || cacheUrl.includes("://")
		? new SQL(cacheUrl)
		: new SQL(cacheUrl, { adapter: "sqlite" });

const PLAYTIME_TTL_SECONDS = 60 * 60 * 24;

await sql`PRAGMA journal_mode = WAL`;

await sql`
	CREATE TABLE IF NOT EXISTS vanity_cache (
		vanity TEXT PRIMARY KEY,
		steam_id TEXT NOT NULL,
		create_time INTEGER NOT NULL
	)
`;

await sql`
	CREATE TABLE IF NOT EXISTS playtime_cache (
		steam_id TEXT PRIMARY KEY,
		payload TEXT NOT NULL,
		fetched_at INTEGER NOT NULL
	)
`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

const normalizeVanity = (value: string) => value.trim().toLowerCase();

export async function getCachedVanityResolution(vanity: string) {
	const normalized = normalizeVanity(vanity);
	if (!normalized) {
		return null;
	}

	const rows = await sql`
		SELECT steam_id
		FROM vanity_cache
		WHERE vanity = ${normalized}
		LIMIT 1
	`;

	return rows.length ? (rows[0].steam_id as string) : null;
}

export async function cacheVanityResolution(vanity: string, steamId: string) {
	const normalized = normalizeVanity(vanity);
	if (!normalized) {
		return;
	}

	const timestamp = nowSeconds();

	await sql`
		INSERT INTO vanity_cache (vanity, steam_id, create_time)
		VALUES (${normalized}, ${steamId}, ${timestamp})
		ON CONFLICT(vanity)
		DO UPDATE SET steam_id = excluded.steam_id, create_time = excluded.create_time
	`;
}

export interface CachedPlaytimePayload {
	game_count: number;
	games: SteamGame[];
}

export async function getCachedPlaytimePayload(
	steamId: string,
): Promise<CachedPlaytimePayload | null> {
	const rows = await sql`
		SELECT payload, fetched_at
		FROM playtime_cache
		WHERE steam_id = ${steamId}
		LIMIT 1
	`;

	if (!rows.length) {
		return null;
	}

	const row = rows[0] as { payload: string; fetched_at: number };
	const isExpired = nowSeconds() - row.fetched_at > PLAYTIME_TTL_SECONDS;

	if (isExpired) {
		await sql`
			DELETE FROM playtime_cache
			WHERE steam_id = ${steamId}
		`;
		return null;
	}

	try {
		return JSON.parse(row.payload) as CachedPlaytimePayload;
	} catch (error) {
		console.error("Failed to parse cached playtime payload", error);
		await sql`
			DELETE FROM playtime_cache
			WHERE steam_id = ${steamId}
		`;
		return null;
	}
}

export async function cachePlaytimePayload(
	steamId: string,
	payload: CachedPlaytimePayload,
) {
	const serialized = JSON.stringify(payload);
	const timestamp = nowSeconds();

	await sql`
		INSERT INTO playtime_cache (steam_id, payload, fetched_at)
		VALUES (${steamId}, ${serialized}, ${timestamp})
		ON CONFLICT(steam_id)
		DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
	`;
}
