import type { CachedPlaytimePayload, PlaytimeMetricsRow } from "./types";

export const PLAYTIME_TTL_SECONDS = 60 * 60 * 24;
export const MANUAL_REFRESH_COOLDOWN_SECONDS = 60 * 60;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const normalizeVanity = (value: string) => value.trim().toLowerCase();

interface PlaytimeCacheRow {
	steam_id: string;
	payload: string;
	fetched_at: number;
}

interface MetricsDatabaseRow {
	steam_id: string;
	fetched_at: number;
	game_count: number;
	total_minutes: number;
	average_minutes: number;
	top_game_appid: number | null;
	top_game_name: string | null;
	top_game_minutes: number | null;
}

function asNumber(value: unknown): number {
	const number = Number(value ?? 0);
	return Number.isFinite(number) ? number : 0;
}

function parsePayload(raw: string): CachedPlaytimePayload | null {
	try {
		const payload = JSON.parse(raw) as CachedPlaytimePayload;
		if (!Number.isInteger(payload.game_count) || payload.game_count <= 0 || !Array.isArray(payload.games)) return null;
		return payload;
	} catch {
		return null;
	}
}

function summarizePayload(payload: CachedPlaytimePayload) {
	let totalMinutes = 0;
	let topGame: CachedPlaytimePayload["games"][number] | undefined;
	for (const game of payload.games) {
		const minutes = Math.max(0, Math.trunc(asNumber(game.playtime_forever)));
		totalMinutes += minutes;
		if (!topGame || minutes > Math.max(0, asNumber(topGame.playtime_forever))) topGame = game;
	}
	const topName = topGame?.name?.trim() ?? "";
	const topAppId = Math.trunc(asNumber(topGame?.appid));
	return {
		gameCount: payload.game_count,
		totalMinutes,
		averageMinutes: payload.game_count ? totalMinutes / payload.game_count : 0,
		topGame: topName && topAppId > 0 ? {
			appid: topAppId,
			name: topName,
			minutes: Math.max(0, Math.trunc(asNumber(topGame?.playtime_forever))),
		} : undefined,
	};
}

async function deleteInvalidEntry(db: D1Database, steamId: string) {
	await db.batch([
		db.prepare(`
			INSERT INTO game_playtime_totals (appid, name, total_minutes)
			SELECT
				CAST(json_extract(game.value, '$.appid') AS INTEGER),
				'',
				-SUM(MAX(CAST(json_extract(game.value, '$.playtime_forever') AS INTEGER), 0))
			FROM playtime_cache AS cache
			JOIN json_each(cache.payload, '$.games') AS game
			WHERE cache.steam_id = ?
			GROUP BY CAST(json_extract(game.value, '$.appid') AS INTEGER)
			ON CONFLICT(appid) DO UPDATE SET
				total_minutes = MAX(game_playtime_totals.total_minutes + excluded.total_minutes, 0)
		`).bind(steamId),
		db.prepare("DELETE FROM playtime_metrics WHERE steam_id = ?").bind(steamId),
		db.prepare("DELETE FROM playtime_cache WHERE steam_id = ?").bind(steamId),
		db.prepare("DELETE FROM game_playtime_totals WHERE total_minutes <= 0"),
	]);
}

export async function getCachedVanityResolution(db: D1Database, vanity: string): Promise<string | null> {
	const normalized = normalizeVanity(vanity);
	if (!normalized) return null;
	const row = await db.prepare("SELECT steam_id FROM vanity_cache WHERE vanity = ? LIMIT 1").bind(normalized).first<{ steam_id: string }>();
	return row?.steam_id ?? null;
}

export async function cacheVanityResolution(db: D1Database, vanity: string, steamId: string): Promise<void> {
	const normalized = normalizeVanity(vanity);
	if (!normalized) return;
	await db.prepare(`
		INSERT INTO vanity_cache (vanity, steam_id, create_time) VALUES (?, ?, ?)
		ON CONFLICT(vanity) DO UPDATE SET steam_id = excluded.steam_id, create_time = excluded.create_time
	`).bind(normalized, steamId, nowSeconds()).run();
}

export async function getCachedPlaytimePayload(db: D1Database, steamId: string): Promise<CachedPlaytimePayload | null> {
	const row = await db.prepare("SELECT steam_id, payload, fetched_at FROM playtime_cache WHERE steam_id = ? LIMIT 1")
		.bind(steamId).first<PlaytimeCacheRow>();
	if (!row || nowSeconds() - asNumber(row.fetched_at) > PLAYTIME_TTL_SECONDS) return null;
	const payload = parsePayload(row.payload);
	if (payload) return payload;
	await deleteInvalidEntry(db, steamId);
	return null;
}

export async function cachePlaytimePayload(db: D1Database, steamId: string, payload: CachedPlaytimePayload): Promise<void> {
	if (!payload.game_count) {
		await deleteInvalidEntry(db, steamId);
		return;
	}
	const serialized = JSON.stringify(payload);
	const timestamp = nowSeconds();
	const summary = summarizePayload(payload);

	// D1 batch 在单个事务内执行：先移除旧记录贡献，再写入新缓存和汇总，最后加回新记录贡献。
	await db.batch([
		db.prepare(`
			INSERT INTO game_playtime_totals (appid, name, total_minutes)
			SELECT
				CAST(json_extract(game.value, '$.appid') AS INTEGER),
				'',
				-SUM(MAX(CAST(json_extract(game.value, '$.playtime_forever') AS INTEGER), 0))
			FROM playtime_cache AS cache
			JOIN json_each(cache.payload, '$.games') AS game
			WHERE cache.steam_id = ?
			GROUP BY CAST(json_extract(game.value, '$.appid') AS INTEGER)
			ON CONFLICT(appid) DO UPDATE SET
				total_minutes = MAX(game_playtime_totals.total_minutes + excluded.total_minutes, 0)
		`).bind(steamId),
		db.prepare(`
			INSERT INTO playtime_cache (steam_id, payload, fetched_at) VALUES (?, ?, ?)
			ON CONFLICT(steam_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
		`).bind(steamId, serialized, timestamp),
		db.prepare(`
			INSERT INTO playtime_metrics (
				steam_id, fetched_at, game_count, total_minutes, average_minutes,
				top_game_appid, top_game_name, top_game_minutes
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(steam_id) DO UPDATE SET
				fetched_at = excluded.fetched_at,
				game_count = excluded.game_count,
				total_minutes = excluded.total_minutes,
				average_minutes = excluded.average_minutes,
				top_game_appid = excluded.top_game_appid,
				top_game_name = excluded.top_game_name,
				top_game_minutes = excluded.top_game_minutes
		`).bind(
			steamId, timestamp, summary.gameCount, summary.totalMinutes, summary.averageMinutes,
			summary.topGame?.appid ?? null, summary.topGame?.name ?? null, summary.topGame?.minutes ?? null,
		),
		db.prepare(`
			INSERT INTO game_playtime_totals (appid, name, total_minutes)
			SELECT
				CAST(json_extract(game.value, '$.appid') AS INTEGER),
				COALESCE(MAX(NULLIF(TRIM(json_extract(game.value, '$.name')), '')), ''),
				SUM(MAX(CAST(json_extract(game.value, '$.playtime_forever') AS INTEGER), 0))
			FROM json_each(?, '$.games') AS game
			WHERE CAST(json_extract(game.value, '$.appid') AS INTEGER) > 0
			GROUP BY CAST(json_extract(game.value, '$.appid') AS INTEGER)
			HAVING SUM(MAX(CAST(json_extract(game.value, '$.playtime_forever') AS INTEGER), 0)) > 0
			ON CONFLICT(appid) DO UPDATE SET
				total_minutes = game_playtime_totals.total_minutes + excluded.total_minutes,
				name = CASE
					WHEN TRIM(game_playtime_totals.name) != '' THEN game_playtime_totals.name
					WHEN TRIM(excluded.name) != '' THEN excluded.name
					ELSE game_playtime_totals.name
				END
		`).bind(serialized),
		db.prepare("DELETE FROM game_playtime_totals WHERE total_minutes <= 0"),
	]);
}

function mapMetricsRow(row: MetricsDatabaseRow): PlaytimeMetricsRow {
	const appid = Math.trunc(asNumber(row.top_game_appid));
	const name = row.top_game_name?.trim() ?? "";
	const minutes = Math.max(0, Math.trunc(asNumber(row.top_game_minutes)));
	return {
		steamId: String(row.steam_id),
		fetchedAt: asNumber(row.fetched_at),
		gameCount: asNumber(row.game_count),
		totalMinutes: asNumber(row.total_minutes),
		averageMinutes: asNumber(row.average_minutes),
		topGame: appid > 0 && name && minutes > 0 ? { appid, name, minutes } : undefined,
	};
}

export async function listPlaytimeMetrics(db: D1Database, orderBy: "game_count" | "total_minutes" | "average_minutes", limit: number): Promise<PlaytimeMetricsRow[]> {
	const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
	const secondary = orderBy === "game_count" ? "total_minutes" : "game_count";
	const result = await db.prepare(`
		SELECT steam_id, fetched_at, game_count, total_minutes, average_minutes,
			top_game_appid, top_game_name, top_game_minutes
		FROM playtime_metrics
		WHERE game_count > 0 AND total_minutes > 0
		ORDER BY ${orderBy} DESC, ${secondary} DESC, steam_id ASC
		LIMIT ?
	`).bind(safeLimit).all<MetricsDatabaseRow>();
	return result.results.map(mapMetricsRow);
}

export async function getLeaderboardAggregates(db: D1Database) {
	const [metrics, games, topGame, cacheCount] = await Promise.all([
		db.prepare("SELECT COUNT(*) AS profile_count, COALESCE(SUM(game_count), 0) AS total_game_count, COALESCE(SUM(total_minutes), 0) AS total_minutes FROM playtime_metrics").first<Record<string, number>>(),
		db.prepare("SELECT COUNT(*) AS count FROM game_playtime_totals WHERE total_minutes > 0").first<{ count: number }>(),
		db.prepare("SELECT appid, name, total_minutes FROM game_playtime_totals WHERE total_minutes > 0 ORDER BY total_minutes DESC, appid ASC LIMIT 1").first<{ appid: number; name: string; total_minutes: number }>(),
		db.prepare("SELECT COUNT(*) AS count FROM playtime_cache").first<{ count: number }>(),
	]);
	return {
		profileCount: asNumber(metrics?.profile_count),
		totalGameCount: asNumber(metrics?.total_game_count),
		totalMinutes: asNumber(metrics?.total_minutes),
		uniqueGameCount: asNumber(games?.count),
		playtimeCacheSize: asNumber(cacheCount?.count),
		topGame: topGame && topGame.appid > 0 && topGame.name?.trim() ? {
			appid: asNumber(topGame.appid), name: topGame.name.trim(), minutes: asNumber(topGame.total_minutes),
		} : undefined,
	};
}

export async function attemptManualRefreshReservation(db: D1Database, steamId: string, now: number, cooldownSeconds = MANUAL_REFRESH_COOLDOWN_SECONDS) {
	const threshold = Math.max(0, now - cooldownSeconds);
	const row = await db.prepare(`
		INSERT INTO playtime_refresh_locks (steam_id, requested_at) VALUES (?, ?)
		ON CONFLICT(steam_id) DO UPDATE SET requested_at = CASE
			WHEN playtime_refresh_locks.requested_at <= ? THEN excluded.requested_at
			ELSE playtime_refresh_locks.requested_at
		END
		RETURNING requested_at
	`).bind(steamId, now, threshold).first<{ requested_at: number }>();
	const stored = asNumber(row?.requested_at);
	return stored === now
		? { allowed: true as const }
		: { allowed: false as const, retryAfterSeconds: Math.max(0, cooldownSeconds - (now - stored)) };
}
