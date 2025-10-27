import { SQL } from "bun";
import type { SteamGame } from "~/server/steam";

const DEFAULT_CACHE_URL = "sqlite://./steam-cache.db";
const cacheUrl = Bun.env.STEAM_CACHE_URL ?? DEFAULT_CACHE_URL;

const sql =
	cacheUrl === ":memory:" || cacheUrl.includes("://")
		? new SQL(cacheUrl)
		: new SQL(cacheUrl, { adapter: "sqlite" });

export const PLAYTIME_TTL_SECONDS = 60 * 60 * 24;

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

interface PlaytimeCacheRow {
	steam_id: string;
	payload: string;
	fetched_at: number;
}

async function deletePlaytimeCacheEntry(steamId: string) {
	await sql`
		DELETE FROM playtime_cache
		WHERE steam_id = ${steamId}
	`;
}

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

type PlaytimeRowStatus = "ok" | "expired" | "empty" | "invalid";

interface ParseOptions {
	allowExpired?: boolean;
}

function parseCachedPlaytimeRow(
	row: PlaytimeCacheRow,
	options?: ParseOptions,
): { status: PlaytimeRowStatus; payload: CachedPlaytimePayload | null } {
	const allowExpired = options?.allowExpired ?? false;
	const ageSeconds = nowSeconds() - row.fetched_at;
	if (!allowExpired && ageSeconds > PLAYTIME_TTL_SECONDS) {
		return { status: "expired", payload: null };
	}

	try {
		const payload = JSON.parse(row.payload) as CachedPlaytimePayload;

		if (!payload.game_count) {
			return { status: "empty", payload: null };
		}

		return { status: "ok", payload };
	} catch (error) {
		console.error("Failed to parse cached playtime payload", error);
		return { status: "invalid", payload: null };
	}
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
		return null;
	}

	const parsed = parseCachedPlaytimeRow({ steam_id: steamId, ...row });

	if (parsed.status === "ok" && parsed.payload) {
		return parsed.payload;
	}

	if (parsed.status === "empty" || parsed.status === "invalid") {
		await deletePlaytimeCacheEntry(steamId);
	}

	return null;
}

export async function cachePlaytimePayload(
	steamId: string,
	payload: CachedPlaytimePayload,
) {
	if (!payload.game_count) {
		await deletePlaytimeCacheEntry(steamId);
		return;
	}

	const serialized = JSON.stringify(payload);
	const timestamp = nowSeconds();

	await sql`
		INSERT INTO playtime_cache (steam_id, payload, fetched_at)
		VALUES (${steamId}, ${serialized}, ${timestamp})
		ON CONFLICT(steam_id)
		DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
	`;
}

export interface CachedPlaytimeRecord {
	steamId: string;
	payload: CachedPlaytimePayload;
	fetchedAt: number;
}

interface ListCachedPlaytimeOptions {
	includeExpired?: boolean;
}

export async function listCachedPlaytimeRecords(
	options?: ListCachedPlaytimeOptions,
): Promise<CachedPlaytimeRecord[]> {
	const includeExpired = options?.includeExpired ?? false;
	const rows = (await sql`
		SELECT steam_id, payload, fetched_at
		FROM playtime_cache
	`) as PlaytimeCacheRow[];

	const validRecords: CachedPlaytimeRecord[] = [];

	for (const row of rows) {
		const parsed = parseCachedPlaytimeRow(row, {
			allowExpired: includeExpired,
		});

		if (parsed.status === "ok" && parsed.payload) {
			validRecords.push({
				steamId: row.steam_id,
				payload: parsed.payload,
				fetchedAt: row.fetched_at,
			});
			continue;
		}

		if (parsed.status === "empty" || parsed.status === "invalid") {
			await deletePlaytimeCacheEntry(row.steam_id);
		}
	}

	return validRecords;
}

export async function countPlaytimeCacheEntries(): Promise<number> {
	const rows = await sql`
		SELECT COUNT(*) AS count
		FROM playtime_cache
	`;
	const row = rows[0] as { count: number | string | bigint } | undefined;
	const value = row?.count ?? 0;
	return typeof value === "number" ? value : Number(value);
}
