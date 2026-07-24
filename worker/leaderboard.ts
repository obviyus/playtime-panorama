import { getLeaderboardAggregates, listPlaytimeMetrics } from "./database";
import type { Env, PlaytimeMetricsRow } from "./types";

const MAX_ROWS = 25;

function toEntry(record: PlaytimeMetricsRow) {
	return {
		steamId: record.steamId,
		profileHref: `/${encodeURIComponent(record.steamId)}`,
		gameCount: record.gameCount,
		totalMinutes: record.totalMinutes,
		averageMinutes: record.averageMinutes,
		lastUpdated: record.fetchedAt,
		topGame: record.topGame,
	};
}

export async function getLeaderboardSnapshot(env: Env) {
	const [byGameCount, byTotalPlaytime, byAveragePlaytime, aggregates] = await Promise.all([
		listPlaytimeMetrics(env.DB, "game_count", MAX_ROWS),
		listPlaytimeMetrics(env.DB, "total_minutes", MAX_ROWS),
		listPlaytimeMetrics(env.DB, "average_minutes", MAX_ROWS),
		getLeaderboardAggregates(env.DB),
	]);
	return {
		generatedAt: Math.floor(Date.now() / 1000),
		metrics: {
			byGameCount: byGameCount.map(toEntry),
			byTotalPlaytime: byTotalPlaytime.map(toEntry),
			byAveragePlaytime: byAveragePlaytime.map(toEntry),
		},
		playtimeCacheSize: aggregates.playtimeCacheSize,
		summary: {
			totalMinutes: Math.round(aggregates.totalMinutes),
			uniqueGameCount: aggregates.uniqueGameCount,
			topGame: aggregates.topGame,
			averagePlaytimeMinutes: aggregates.profileCount ? aggregates.totalMinutes / aggregates.profileCount : 0,
			averageGameCount: aggregates.profileCount ? aggregates.totalGameCount / aggregates.profileCount : 0,
		},
	};
}
