import Bottleneck from "bottleneck";
import type { CachedPlaytimePayload } from "~/server/database";
import {
	cachePlaytimePayload,
	cacheVanityResolution,
	getCachedPlaytimePayload,
	getCachedVanityResolution,
} from "~/server/database";

export interface SteamGame {
	appid: number;
	name?: string;
	playtime_forever: number;
	rtime_last_played?: number;
}

export interface SteamOwnedGamesResponse {
	response?: {
		game_count: number;
		games?: SteamGame[];
	};
}

export interface SteamResolveVanityResponse {
	response?: {
		success: number;
		steamid?: string;
		message?: string;
	};
}

const STEAM_API_BASE =
	"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const STEAM_VANITY_API_BASE =
	"https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/";
const steamIdPattern = /^\d{17}$/;

const steamApiKeyList: string[] = (() => {
	const csv = Bun.env.STEAM_API_KEYS;
	if (csv) {
		const keys = csv
			.split(",")
			.map((key) => key.trim())
			.filter(Boolean);
		if (keys.length > 0) {
			return keys;
		}
	}

	const fallbackKey = Bun.env.STEAM_API_KEY?.trim();
	if (fallbackKey) {
		return [fallbackKey];
	}

	return [];
})();

const STEAM_RATE_LIMIT_PER_KEY = 200;
const STEAM_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const steamApiKeyPoolSize = Math.max(1, steamApiKeyList.length);

const steamRequestLimiter = new Bottleneck({
	maxConcurrent: steamApiKeyPoolSize,
	reservoir: steamApiKeyPoolSize * STEAM_RATE_LIMIT_PER_KEY,
	reservoirRefreshAmount: steamApiKeyPoolSize * STEAM_RATE_LIMIT_PER_KEY,
	reservoirRefreshInterval: STEAM_RATE_LIMIT_WINDOW_MS,
});

function limitedSteamFetch(input: string, init?: RequestInit) {
	return steamRequestLimiter.schedule(() => fetch(input, init));
}

let steamApiKeyCursor = 0;

function resolveSteamApiKey(override?: string): string {
	const trimmedOverride = override?.trim();
	if (trimmedOverride) {
		return trimmedOverride;
	}

	if (steamApiKeyList.length === 0) {
		throw new Error("STEAM_API_KEY or STEAM_API_KEYS must be configured");
	}

	const key = steamApiKeyList[steamApiKeyCursor];
	if (key === undefined) {
		throw new Error("Steam API key rotation failed due to missing key");
	}
	steamApiKeyCursor = (steamApiKeyCursor + 1) % steamApiKeyList.length;
	return key;
}

function buildSteamRequestUrl(steamID: string, apiKey: string) {
	const params = new URLSearchParams({
		key: apiKey,
		steamid: steamID,
		include_appinfo: "1",
		include_played_free_games: "1",
	});

	return `${STEAM_API_BASE}?${params.toString()}`;
}

function buildVanityResolveUrl(identifier: string, apiKey: string) {
	const params = new URLSearchParams({
		key: apiKey,
		vanityurl: identifier,
	});

	return `${STEAM_VANITY_API_BASE}?${params.toString()}`;
}

export class SteamIdentifierError extends Error {
	status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "SteamIdentifierError";
		this.status = status;
	}
}

export async function getVanityResolution(rawIdentifier: string) {
	const identifier = rawIdentifier.trim();

	if (!identifier) {
		throw new SteamIdentifierError("Steam identifier is required.");
	}

	if (steamIdPattern.test(identifier)) {
		return identifier;
	}

	const cachedSteamID = await getCachedVanityResolution(identifier);
	if (cachedSteamID) {
		return cachedSteamID;
	}

	console.log(`No cached vanity resolution for "${identifier}", fetching...`);
	let apiKey: string;
	try {
		apiKey = resolveSteamApiKey();
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "STEAM_API_KEY or STEAM_API_KEYS must be configured";
		throw new SteamIdentifierError(message, 500);
	}

	const requestUrl = buildVanityResolveUrl(identifier, apiKey);
	const response = await limitedSteamFetch(requestUrl);

	if (!response.ok) {
		const errorBody = await response.text();
		throw new SteamIdentifierError(
			`Steam API error (${response.status}): ${errorBody.slice(0, 200)}`,
			502,
		);
	}

	const payload = (await response.json()) as SteamResolveVanityResponse;
	const { success: successCode = 0, steamid, message } = payload.response ?? {};

	if (successCode === 1 && steamid) {
		await cacheVanityResolution(identifier, steamid);
		return steamid;
	}

	if (successCode === 42) {
		throw new SteamIdentifierError(
			message ?? "No vanity URL match found.",
			404,
		);
	}

	throw new SteamIdentifierError(
		message ?? "Unable to resolve the vanity URL.",
		502,
	);
}

interface FetchPlaytimeOptions {
	apiKeyOverride?: string;
}

async function fetchPlaytimeFromSteam(
	steamID: string,
	options?: FetchPlaytimeOptions,
): Promise<CachedPlaytimePayload> {
	const apiKey = resolveSteamApiKey(options?.apiKeyOverride);

	const requestUrl = buildSteamRequestUrl(steamID, apiKey);
	const steamResponse = await limitedSteamFetch(requestUrl);

	if (!steamResponse.ok) {
		const errorBody = await steamResponse.text();
		throw new Error(
			`Steam API error (${steamResponse.status}): ${errorBody.slice(0, 200)}`,
		);
	}

	const data = (await steamResponse.json()) as SteamOwnedGamesResponse;
	console.log(
		`Found ${data.response?.game_count ?? 0} games for SteamID ${steamID}`,
	);

	const response = data.response ?? { game_count: 0, games: [] };
	const games =
		response.games?.filter((game) => game.playtime_forever > 10) ?? [];

	const payload: CachedPlaytimePayload = {
		game_count: games.length,
		games,
	};

	if (payload.game_count === 0) {
		return payload;
	}

	await cachePlaytimePayload(steamID, payload);

	return payload;
}

interface GetPlaytimePayloadOptions {
	forceRefresh?: boolean;
	apiKeyOverride?: string;
}

export async function getPlaytimePayload(
	steamID: string,
	options?: GetPlaytimePayloadOptions,
): Promise<CachedPlaytimePayload> {
	const forceRefresh = options?.forceRefresh ?? false;

	if (!forceRefresh) {
		const cachedPayload = await getCachedPlaytimePayload(steamID);
		if (cachedPayload) {
			return cachedPayload;
		}
	}

	if (!forceRefresh) {
		console.log(`No cached playtime payload for SteamID ${steamID}, fetching...`);
	} else {
		console.log(`Refreshing playtime payload for SteamID ${steamID}...`);
	}

	return fetchPlaytimeFromSteam(steamID, {
		apiKeyOverride: options?.apiKeyOverride,
	});
}
