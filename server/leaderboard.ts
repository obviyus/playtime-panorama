import {
	countPlaytimeCacheEntries,
	getAggregateTopGame,
	getLeaderboardAggregates,
	getUniqueTrackedGameCount,
	listPlaytimeMetricsByAverageMinutes,
	listPlaytimeMetricsByGameCount,
	listPlaytimeMetricsByTotalMinutes,
	type PlaytimeMetricsRow,
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

function toLeaderboardEntry(record: PlaytimeMetricsRow): LeaderboardEntry {
	return {
		steamId: record.steamId,
		profileHref: `/${encodeURIComponent(record.steamId)}`,
		gameCount: record.gameCount,
		totalMinutes: record.totalMinutes,
		averageMinutes: record.averageMinutes,
		lastUpdated: record.fetchedAt,
		topGame: record.topGame
			? {
				appid: record.topGame.appid,
				name: record.topGame.name,
				minutes: record.topGame.minutes,
			}
			: undefined,
	};
}

export async function getLeaderboardSnapshot(): Promise<LeaderboardSnapshot> {
	const now = Date.now();

	if (cachedSnapshot && cachedSnapshotExpiry > now) {
		return cachedSnapshot;
	}

	const [
		byGameCountRows,
		byTotalMinutesRows,
		byAverageMinutesRows,
		aggregates,
		uniqueGameCount,
		topGame,
		playtimeCacheSize,
	] = await Promise.all([
		listPlaytimeMetricsByGameCount(MAX_ROWS),
		listPlaytimeMetricsByTotalMinutes(MAX_ROWS),
		listPlaytimeMetricsByAverageMinutes(MAX_ROWS),
		getLeaderboardAggregates(),
		getUniqueTrackedGameCount(),
		getAggregateTopGame(),
		countPlaytimeCacheEntries(),
	]);

	const profileCount = aggregates.profileCount;
	const totalGameCount = aggregates.totalGameCount;
	const cumulativeMinutes = aggregates.totalMinutes;

	const metrics: LeaderboardMetrics = {
		byGameCount: byGameCountRows.map(toLeaderboardEntry),
		byTotalPlaytime: byTotalMinutesRows.map(toLeaderboardEntry),
		byAveragePlaytime: byAverageMinutesRows.map(toLeaderboardEntry),
	};

	const generatedAt = Math.floor(now / 1000);

	const snapshot: LeaderboardSnapshot = {
		metrics,
		generatedAt,
		playtimeCacheSize,
		summary: {
			totalMinutes: Math.round(cumulativeMinutes),
			uniqueGameCount,
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
