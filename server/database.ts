import { SQL } from "bun";
import type { SteamGame } from "~/server/steam";

const DEFAULT_CACHE_URL = "sqlite://./steam-cache.db";
const cacheUrl = Bun.env.STEAM_CACHE_URL ?? DEFAULT_CACHE_URL;

const sql =
	cacheUrl === ":memory:" || cacheUrl.includes("://")
		? new SQL(cacheUrl)
		: new SQL(cacheUrl, { adapter: "sqlite" });

export const PLAYTIME_TTL_SECONDS = 60 * 60 * 24;
export const MANUAL_REFRESH_COOLDOWN_SECONDS = 60 * 60;

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

await sql`
	CREATE TABLE IF NOT EXISTS playtime_metrics (
		steam_id TEXT PRIMARY KEY,
		fetched_at INTEGER NOT NULL,
		game_count INTEGER NOT NULL,
		total_minutes INTEGER NOT NULL,
		average_minutes REAL NOT NULL,
		top_game_appid INTEGER,
		top_game_name TEXT,
		top_game_minutes INTEGER
	)
`;

await sql`
	CREATE TABLE IF NOT EXISTS game_playtime_totals (
		appid INTEGER PRIMARY KEY,
		name TEXT,
		total_minutes INTEGER NOT NULL
	)
`;

await sql`
	CREATE TABLE IF NOT EXISTS playtime_refresh_locks (
		steam_id TEXT PRIMARY KEY,
		requested_at INTEGER NOT NULL
	)
`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

const normalizeVanity = (value: string) => value.trim().toLowerCase();

interface PlaytimeCacheRow {
	steam_id: string;
	payload: string;
	fetched_at: number;
}

type PlaytimeRowStatus = "ok" | "expired" | "empty" | "invalid";

interface ParseOptions {
	allowExpired?: boolean;
}

function coerceNumber(value: number | string | bigint | null | undefined): number {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : 0;
	}
	if (typeof value === "bigint") {
		return Number(value);
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
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

function sanitizeAppId(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}

	const parsed = Number.parseInt(String(value), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMinutes(value: unknown): number {
	const numeric = Number(value ?? 0);
	if (!Number.isFinite(numeric) || numeric <= 0) {
		return 0;
	}
	return Math.trunc(numeric);
}

export interface CachedPlaytimePayload {
	game_count: number;
	games: SteamGame[];
}

export interface PlaytimeSummary {
	gameCount: number;
	totalMinutes: number;
	averageMinutes: number;
	topGame?: {
		appid: number;
		name: string;
		minutes: number;
	};
}

export interface PlaytimeMetricsRow extends PlaytimeSummary {
	steamId: string;
	fetchedAt: number;
}

function summarizePayload(payload: CachedPlaytimePayload): PlaytimeSummary {
	let totalMinutes = 0;
	let topGame: SteamGame | null = null;

	for (const game of payload.games) {
		const minutes = normalizeMinutes(game.playtime_forever);
		if (minutes > 0) {
			totalMinutes += minutes;
		}

		if (!topGame) {
			topGame = game;
			continue;
		}

		const candidateMinutes = normalizeMinutes(game.playtime_forever);
		const currentTopMinutes = normalizeMinutes(topGame.playtime_forever);
		if (candidateMinutes > currentTopMinutes) {
			topGame = game;
		}
	}

	const averageMinutes = payload.game_count
		? totalMinutes / payload.game_count
		: 0;

	const sanitizedTopGame = (() => {
		if (!topGame) {
			return undefined;
		}
		const trimmedName = (topGame.name ?? "").trim();
		if (!trimmedName) {
			return undefined;
		}
		const appid = sanitizeAppId(topGame.appid);
		if (!appid) {
			return undefined;
		}
		return {
			appid,
			name: trimmedName,
			minutes: normalizeMinutes(topGame.playtime_forever),
		};
	})();

	return {
		gameCount: payload.game_count,
		totalMinutes,
		averageMinutes,
		topGame: sanitizedTopGame,
	};
}

interface GameMinutesEntry {
	appid: number;
	minutes: number;
	name: string;
}

function extractGameMinutes(payload: CachedPlaytimePayload): GameMinutesEntry[] {
	const result: GameMinutesEntry[] = [];
	for (const game of payload.games) {
		const appid = sanitizeAppId(game.appid);
		if (!appid) {
			continue;
		}
		const minutes = normalizeMinutes(game.playtime_forever);
		if (!minutes) {
			continue;
		}
		const trimmedName = (game.name ?? "").trim();
		result.push({
			appid,
			minutes,
			name: trimmedName,
		});
	}
	return result;
}

async function adjustGameTotals(entries: GameMinutesEntry[], multiplier: 1 | -1) {
	for (const entry of entries) {
		const delta = entry.minutes * multiplier;
		if (!delta) {
			continue;
		}
		const nameValue = multiplier > 0 ? entry.name : "";
		await sql`
			INSERT INTO game_playtime_totals (appid, name, total_minutes)
			VALUES (${entry.appid}, ${nameValue}, ${delta})
			ON CONFLICT(appid)
			DO UPDATE SET
				total_minutes = MAX(game_playtime_totals.total_minutes + excluded.total_minutes, 0),
				name = CASE
					WHEN TRIM(game_playtime_totals.name) != "" THEN game_playtime_totals.name
					WHEN TRIM(excluded.name) != "" THEN excluded.name
					ELSE game_playtime_totals.name
				END
		`;
	}

	await sql`
		DELETE FROM game_playtime_totals
		WHERE total_minutes <= 0
	`;
}

const metricsPresenceRow = (await sql`
	SELECT COUNT(*) AS count
	FROM playtime_metrics
	LIMIT 1
`) as Array<{ count?: number | string | bigint | null }>;

const cachePresenceRow = (await sql`
	SELECT COUNT(*) AS count
	FROM playtime_cache
	LIMIT 1
`) as Array<{ count?: number | string | bigint | null }>;

let materializedReady = coerceNumber(metricsPresenceRow[0]?.count) > 0 || coerceNumber(cachePresenceRow[0]?.count) === 0;
let metricsDirty = !materializedReady;
let materializationPromise: Promise<void> | null = null;

async function refreshMaterializedAggregates() {
	await sql`BEGIN`;
	try {
		await sql`DELETE FROM playtime_metrics`;
		await sql`DELETE FROM game_playtime_totals`;

		await sql`
			INSERT INTO playtime_metrics (
				steam_id,
				fetched_at,
				game_count,
				total_minutes,
				average_minutes,
				top_game_appid,
				top_game_name,
				top_game_minutes
			)
			WITH record_games AS (
				SELECT
					pc.steam_id AS steam_id,
					pc.fetched_at AS fetched_at,
					CAST(json_extract(pc.payload, '$.game_count') AS INTEGER) AS game_count,
					CAST(json_extract(g.value, '$.appid') AS INTEGER) AS appid,
					TRIM(json_extract(g.value, '$.name')) AS name,
					CAST(json_extract(g.value, '$.playtime_forever') AS INTEGER) AS minutes
				FROM playtime_cache pc
				LEFT JOIN json_each(pc.payload, '$.games') AS g
			),
			totals AS (
				SELECT
					record_games.steam_id,
					MAX(record_games.fetched_at) AS fetched_at,
					MAX(COALESCE(record_games.game_count, 0)) AS game_count,
					SUM(CASE WHEN record_games.minutes > 0 THEN record_games.minutes ELSE 0 END) AS total_minutes
				FROM record_games
				GROUP BY record_games.steam_id
			),
			top_games AS (
				SELECT
					record_games.steam_id,
					record_games.appid,
					record_games.name,
					CASE WHEN record_games.minutes > 0 THEN record_games.minutes ELSE 0 END AS minutes,
					ROW_NUMBER() OVER (
						PARTITION BY record_games.steam_id
						ORDER BY
							CASE WHEN record_games.name IS NULL OR TRIM(record_games.name) = '' THEN 1 ELSE 0 END,
							CASE WHEN record_games.minutes > 0 THEN record_games.minutes ELSE 0 END DESC,
							COALESCE(record_games.appid, 0) ASC
					) AS rank
				FROM record_games
				WHERE record_games.appid IS NOT NULL AND record_games.name IS NOT NULL AND TRIM(record_games.name) != ''
			)
			SELECT
				totals.steam_id,
				totals.fetched_at,
				totals.game_count,
				COALESCE(totals.total_minutes, 0) AS total_minutes,
				CASE
					WHEN totals.game_count > 0 THEN COALESCE(totals.total_minutes, 0) * 1.0 / totals.game_count
					ELSE 0
				END AS average_minutes,
				top_games.appid AS top_game_appid,
				top_games.name AS top_game_name,
				top_games.minutes AS top_game_minutes
			FROM totals
			LEFT JOIN top_games ON top_games.steam_id = totals.steam_id AND top_games.rank = 1
			WHERE totals.game_count > 0 AND COALESCE(totals.total_minutes, 0) > 0
		`;

		await sql`
			INSERT INTO game_playtime_totals (appid, name, total_minutes)
			WITH record_games AS (
				SELECT
					CAST(json_extract(g.value, '$.appid') AS INTEGER) AS appid,
					TRIM(json_extract(g.value, '$.name')) AS name,
					CAST(json_extract(g.value, '$.playtime_forever') AS INTEGER) AS minutes
				FROM playtime_cache pc
				JOIN json_each(pc.payload, '$.games') AS g
			)
			SELECT
				record_games.appid,
				COALESCE(MAX(CASE WHEN record_games.name != '' THEN record_games.name END), '') AS name,
				SUM(CASE WHEN record_games.minutes > 0 THEN record_games.minutes ELSE 0 END) AS total_minutes
			FROM record_games
			WHERE record_games.appid IS NOT NULL
			GROUP BY record_games.appid
			HAVING total_minutes > 0
		`;

		await sql`COMMIT`;
	} catch (error) {
		await sql`ROLLBACK`;
		throw error;
	}
}

async function ensureMaterializedAggregates() {
	if (materializedReady && !metricsDirty) {
		return;
	}

	if (!materializationPromise) {
		materializationPromise = refreshMaterializedAggregates()
			.then(() => {
				materializedReady = true;
				metricsDirty = false;
			})
			.catch((error) => {
				materializedReady = false;
				metricsDirty = true;
				throw error;
			})
			.finally(() => {
				materializationPromise = null;
			});
	}

	await materializationPromise;
}

async function deletePlaytimeCacheEntry(steamId: string, existingRow?: PlaytimeCacheRow) {
	const rows = existingRow
		? [existingRow]
		: ((await sql`
			SELECT steam_id, payload, fetched_at
			FROM playtime_cache
			WHERE steam_id = ${steamId}
			LIMIT 1
		`) as PlaytimeCacheRow[]);

	const row = rows[0];

	if (row && materializedReady && !metricsDirty) {
		const parsed = parseCachedPlaytimeRow(row, { allowExpired: true });
		if (parsed.status === "ok" && parsed.payload) {
			const previousEntries = extractGameMinutes(parsed.payload);
			if (previousEntries.length) {
				await adjustGameTotals(previousEntries, -1);
			}
		}
		await sql`
			DELETE FROM playtime_metrics
			WHERE steam_id = ${steamId}
		`;
	} else {
		metricsDirty = true;
	}

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
		await deletePlaytimeCacheEntry(steamId, {
			steam_id: steamId,
			payload: row.payload,
			fetched_at: row.fetched_at,
		});
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

	const existingRows = (await sql`
		SELECT steam_id, payload, fetched_at
		FROM playtime_cache
		WHERE steam_id = ${steamId}
		LIMIT 1
	`) as PlaytimeCacheRow[];

	await sql`
		INSERT INTO playtime_cache (steam_id, payload, fetched_at)
		VALUES (${steamId}, ${serialized}, ${timestamp})
		ON CONFLICT(steam_id)
		DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
	`;

	if (!materializedReady || metricsDirty) {
		metricsDirty = true;
		return;
	}

	const summary = summarizePayload(payload);
	const newEntries = extractGameMinutes(payload);

	const existingRow = existingRows[0];
	if (existingRow) {
		const parsedExisting = parseCachedPlaytimeRow(existingRow, {
			allowExpired: true,
		});
		if (parsedExisting.status === "ok" && parsedExisting.payload) {
			const previousEntries = extractGameMinutes(parsedExisting.payload);
			if (previousEntries.length) {
				await adjustGameTotals(previousEntries, -1);
			}
		}
	}

	if (newEntries.length) {
		await adjustGameTotals(newEntries, 1);
	}

	await sql`
		INSERT INTO playtime_metrics (
			steam_id,
			fetched_at,
			game_count,
			total_minutes,
			average_minutes,
			top_game_appid,
			top_game_name,
			top_game_minutes
		)
		VALUES (
			${steamId},
			${timestamp},
			${summary.gameCount},
			${summary.totalMinutes},
			${summary.averageMinutes},
			${summary.topGame?.appid ?? null},
			${summary.topGame?.name ?? null},
			${summary.topGame?.minutes ?? null}
		)
		ON CONFLICT(steam_id) DO UPDATE SET
			fetched_at = excluded.fetched_at,
			game_count = excluded.game_count,
			total_minutes = excluded.total_minutes,
			average_minutes = excluded.average_minutes,
			top_game_appid = excluded.top_game_appid,
			top_game_name = excluded.top_game_name,
			top_game_minutes = excluded.top_game_minutes
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
			await deletePlaytimeCacheEntry(row.steam_id, row);
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

function mapMetricsRow(row: any): PlaytimeMetricsRow {
	const steamId = String(row.steam_id);
	const fetchedAt = coerceNumber(row.fetched_at);
	const gameCount = coerceNumber(row.game_count);
	const totalMinutes = coerceNumber(row.total_minutes);
	const averageMinutes = Number(row.average_minutes ?? 0);
	const topGameAppId = sanitizeAppId(row.top_game_appid);
	const topGameMinutes = coerceNumber(row.top_game_minutes);
	const rawName = typeof row.top_game_name === "string" ? row.top_game_name.trim() : "";

	return {
		steamId,
		fetchedAt,
		gameCount,
		totalMinutes,
		averageMinutes,
		topGame:
			topGameAppId && rawName && topGameMinutes
				? {
					appid: topGameAppId,
					name: rawName,
					minutes: topGameMinutes,
				}
				: undefined,
	};
}

export async function listPlaytimeMetricsByGameCount(
	limit: number,
): Promise<PlaytimeMetricsRow[]> {
	await ensureMaterializedAggregates();
	const rows = await sql`
		SELECT steam_id, fetched_at, game_count, total_minutes, average_minutes, top_game_appid, top_game_name, top_game_minutes
		FROM playtime_metrics
		WHERE game_count > 0 AND total_minutes > 0
		ORDER BY game_count DESC, total_minutes DESC, steam_id ASC
		LIMIT ${limit}
	`;
	return (rows as any[]).map(mapMetricsRow);
}

export async function listPlaytimeMetricsByTotalMinutes(
	limit: number,
): Promise<PlaytimeMetricsRow[]> {
	await ensureMaterializedAggregates();
	const rows = await sql`
		SELECT steam_id, fetched_at, game_count, total_minutes, average_minutes, top_game_appid, top_game_name, top_game_minutes
		FROM playtime_metrics
		WHERE game_count > 0 AND total_minutes > 0
		ORDER BY total_minutes DESC, game_count DESC, steam_id ASC
		LIMIT ${limit}
	`;
	return (rows as any[]).map(mapMetricsRow);
}

export async function listPlaytimeMetricsByAverageMinutes(
	limit: number,
): Promise<PlaytimeMetricsRow[]> {
	await ensureMaterializedAggregates();
	const rows = await sql`
		SELECT steam_id, fetched_at, game_count, total_minutes, average_minutes, top_game_appid, top_game_name, top_game_minutes
		FROM playtime_metrics
		WHERE game_count > 0 AND total_minutes > 0
		ORDER BY average_minutes DESC, total_minutes DESC, steam_id ASC
		LIMIT ${limit}
	`;
	return (rows as any[]).map(mapMetricsRow);
}

export interface LeaderboardAggregateSnapshot {
	profileCount: number;
	totalGameCount: number;
	totalMinutes: number;
}

export async function getLeaderboardAggregates(): Promise<LeaderboardAggregateSnapshot> {
	await ensureMaterializedAggregates();
	const rows = await sql`
		SELECT
			COUNT(*) AS profile_count,
			SUM(game_count) AS total_game_count,
			SUM(total_minutes) AS total_minutes
		FROM playtime_metrics
	`;
	const row = rows[0] as
		| {
			profile_count?: number | string | bigint | null;
			total_game_count?: number | string | bigint | null;
			total_minutes?: number | string | bigint | null;
		}
		| undefined;
	return {
		profileCount: coerceNumber(row?.profile_count),
		totalGameCount: coerceNumber(row?.total_game_count),
		totalMinutes: coerceNumber(row?.total_minutes),
	};
}

export async function attemptManualRefreshReservation(
	steamId: string,
	now: number,
	cooldownSeconds: number,
): Promise<
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number }
> {
	const threshold = Math.max(0, now - cooldownSeconds);
	const rows = await sql`
		INSERT INTO playtime_refresh_locks (steam_id, requested_at)
		VALUES (${steamId}, ${now})
		ON CONFLICT(steam_id)
		DO UPDATE SET requested_at = CASE
			WHEN playtime_refresh_locks.requested_at <= ${threshold} THEN excluded.requested_at
			ELSE playtime_refresh_locks.requested_at
		END
		RETURNING requested_at
	`;
	const stored = coerceNumber(rows[0]?.requested_at);
	if (stored === now) {
		return { allowed: true };
	}

	const retryAfterSeconds = Math.max(
		0,
		cooldownSeconds - (now - stored),
	);

	return { allowed: false, retryAfterSeconds };
}

export interface AggregateTopGame {
	appid: number;
	name: string;
	minutes: number;
}

export async function getAggregateTopGame(): Promise<AggregateTopGame | undefined> {
	await ensureMaterializedAggregates();
	const rows = await sql`
		SELECT appid, name, total_minutes
		FROM game_playtime_totals
		WHERE total_minutes > 0
		ORDER BY total_minutes DESC
		LIMIT 1
	`;
	const row = rows[0] as
		| { appid?: number | string | bigint | null; name?: string | null; total_minutes?: number | string | bigint | null }
		| undefined;
	if (!row) {
		return undefined;
	}
	const appid = sanitizeAppId(row.appid);
	const name = typeof row.name === "string" ? row.name.trim() : "";
	const minutes = coerceNumber(row.total_minutes);
	if (!appid || !name || !minutes) {
		return undefined;
	}
	return { appid, name, minutes };
}

export async function getUniqueTrackedGameCount(): Promise<number> {
	await ensureMaterializedAggregates();
	const rows = await sql`
		SELECT COUNT(*) AS count
		FROM game_playtime_totals
		WHERE total_minutes > 0
	`;
	const row = rows[0] as { count?: number | string | bigint | null } | undefined;
	return coerceNumber(row?.count);
}
