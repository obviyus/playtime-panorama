export interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
	STEAM_API_KEY?: string;
	STEAM_API_KEYS?: string;
}

export interface SteamGame {
	appid: number;
	name?: string;
	playtime_forever: number;
	rtime_last_played?: number;
}

export interface CachedPlaytimePayload {
	game_count: number;
	games: SteamGame[];
}

export interface PlaytimeMetricsRow {
	steamId: string;
	fetchedAt: number;
	gameCount: number;
	totalMinutes: number;
	averageMinutes: number;
	topGame?: {
		appid: number;
		name: string;
		minutes: number;
	};
}

export interface SteamOwnedGamesResponse {
	response?: {
		game_count?: number;
		games?: SteamGame[];
	};
}

export interface SteamResolveVanityResponse {
	response?: {
		success?: number;
		steamid?: string;
		message?: string;
	};
}
