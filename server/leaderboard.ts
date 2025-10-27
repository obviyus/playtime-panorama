import type { SteamGame } from "~/server/steam";
import {
	listCachedPlaytimeRecords,
	type CachedPlaytimeRecord,
	countPlaytimeCacheEntries,
} from "~/server/database";

interface LeaderboardEntry {
	steamId: string;
	profileHref: string;
	gameCount: number;
	totalMinutes: number;
	averageMinutes: number;
	lastUpdated: number;
	topGame?: {
		appid: number;
		name: string;
		minutes: number;
	};
}

export interface LeaderboardMetrics {
	byGameCount: LeaderboardEntry[];
	byTotalPlaytime: LeaderboardEntry[];
	byAveragePlaytime: LeaderboardEntry[];
}

export interface LeaderboardSummary {
	totalMinutes: number;
	uniqueGameCount: number;
	topGame?: {
		appid: number;
		name: string;
		minutes: number;
	};
	averagePlaytimeMinutes: number;
	averageGameCount: number;
}

export interface LeaderboardSnapshot {
	generatedAt: number;
	metrics: LeaderboardMetrics;
	playtimeCacheSize: number;
	summary: LeaderboardSummary;
}

const MAX_ROWS = 25;
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedSnapshot: LeaderboardSnapshot | null = null;
let cachedSnapshotExpiry = 0;

function summarizeRecord(record: CachedPlaytimeRecord): LeaderboardEntry {
	const totalMinutes = record.payload.games.reduce((total, game) => {
		return total + (Number.isFinite(game.playtime_forever) ? game.playtime_forever : 0);
	}, 0);

	const averageMinutes =
		record.payload.game_count > 0
			? totalMinutes / record.payload.game_count
			: 0;

	const topGame = record.payload.games.reduce<SteamGame | null>(
		(currentMax, game) => {
			if (!currentMax) {
				return game;
			}

			const currentMaxPlaytime = currentMax.playtime_forever ?? 0;
			const candidatePlaytime = game.playtime_forever ?? 0;

			return candidatePlaytime > currentMaxPlaytime ? game : currentMax;
		},
		null,
	);

	return {
		steamId: record.steamId,
		profileHref: `/${encodeURIComponent(record.steamId)}`,
		gameCount: record.payload.game_count,
		totalMinutes,
		averageMinutes,
		lastUpdated: record.fetchedAt,
		topGame:
			topGame && (topGame.name ?? "").trim()
				? {
					appid: topGame.appid,
					name: (topGame.name ?? "").trim(),
					minutes: topGame.playtime_forever ?? 0,
				}
				: undefined,
	};
}

function compareByGameCount(a: LeaderboardEntry, b: LeaderboardEntry) {
	if (a.gameCount !== b.gameCount) {
		return b.gameCount - a.gameCount;
	}

	if (a.totalMinutes !== b.totalMinutes) {
		return b.totalMinutes - a.totalMinutes;
	}

	return a.steamId.localeCompare(b.steamId);
}

function compareByTotalMinutes(a: LeaderboardEntry, b: LeaderboardEntry) {
	if (a.totalMinutes !== b.totalMinutes) {
		return b.totalMinutes - a.totalMinutes;
	}

	if (a.gameCount !== b.gameCount) {
		return b.gameCount - a.gameCount;
	}

	return a.steamId.localeCompare(b.steamId);
}

function compareByAverageMinutes(a: LeaderboardEntry, b: LeaderboardEntry) {
	if (a.averageMinutes !== b.averageMinutes) {
		return b.averageMinutes - a.averageMinutes;
	}

	if (a.totalMinutes !== b.totalMinutes) {
		return b.totalMinutes - a.totalMinutes;
	}

	return a.steamId.localeCompare(b.steamId);
}

function limitEntries(entries: LeaderboardEntry[]) {
	return entries.filter((entry) => entry.gameCount > 0 && entry.totalMinutes > 0);
}

export async function getLeaderboardSnapshot(): Promise<LeaderboardSnapshot> {
	const now = Date.now();

	if (cachedSnapshot && cachedSnapshotExpiry > now) {
		return cachedSnapshot;
	}

	const cachedRecords = await listCachedPlaytimeRecords({ includeExpired: true });
	const summaries = cachedRecords.map(summarizeRecord);

	const filteredSummaries = limitEntries(summaries);

	const profileCount = cachedRecords.length;

	let cumulativeMinutes = 0;
	let totalGameCount = 0;
	const uniqueAppIds = new Set<number>();
	const gameMinutes = new Map<
		number,
		{
			name: string;
			minutes: number;
		}
	>();

	for (const record of cachedRecords) {
		totalGameCount += record.payload.game_count;
		for (const game of record.payload.games) {
			const minutesValue = Number(game.playtime_forever ?? 0);
			const minutes = Number.isFinite(minutesValue) ? minutesValue : 0;
			const appidRaw = game.appid;
			const appid =
				typeof appidRaw === "number"
					? Math.trunc(appidRaw)
					: Number.parseInt(String(appidRaw), 10);
			if (!Number.isFinite(appid)) {
				continue;
			}
			uniqueAppIds.add(appid);
			if (minutes > 0) {
				const existing = gameMinutes.get(appid) ?? {
					name: (game.name ?? "").trim(),
					minutes: 0,
				};
				const updatedMinutes = existing.minutes + minutes;
				gameMinutes.set(appid, {
					name: existing.name || (game.name ?? "").trim(),
					minutes: updatedMinutes,
				});
				cumulativeMinutes += minutes;
			}
		}
	}

	let topGame: LeaderboardSummary["topGame"];
	for (const [appid, data] of gameMinutes.entries()) {
		if (!data.minutes) {
			continue;
		}
		const trimmedName = data.name.trim();
		if (!trimmedName) {
			continue;
		}
		if (!topGame || data.minutes > topGame.minutes) {
			topGame = {
				appid,
				name: trimmedName,
				minutes: data.minutes,
			};
		}
	}

	const playtimeCacheSize = await countPlaytimeCacheEntries();

	const metrics: LeaderboardMetrics = {
		byGameCount: [...filteredSummaries]
			.sort(compareByGameCount)
			.slice(0, MAX_ROWS),
		byTotalPlaytime: [...filteredSummaries]
			.sort(compareByTotalMinutes)
			.slice(0, MAX_ROWS),
		byAveragePlaytime: [...filteredSummaries]
			.sort(compareByAverageMinutes)
			.slice(0, MAX_ROWS),
	};

	const generatedAt = Math.floor(now / 1000);

	const snapshot: LeaderboardSnapshot = {
		metrics,
		generatedAt,
		playtimeCacheSize,
		summary: {
			totalMinutes: Math.round(cumulativeMinutes),
			uniqueGameCount: uniqueAppIds.size,
			topGame,
			averagePlaytimeMinutes:
				profileCount > 0 ? cumulativeMinutes / profileCount : 0,
			averageGameCount: profileCount > 0 ? totalGameCount / profileCount : 0,
		},
	};

	cachedSnapshot = snapshot;
	cachedSnapshotExpiry = now + LEADERBOARD_CACHE_TTL_MS;

	return snapshot;
}
