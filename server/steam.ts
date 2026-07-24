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
const vanityPattern = /^[A-Za-z0-9_-]{2,64}$/;
const STEAM_TIMEOUT_MS = 12_000;

const steamApiKeyList: string[] = (() => {
	const csv = Bun.env.STEAM_API_KEYS;
	if (csv) {
		const keys = csv
			.split(",")
			.map((key) => key.trim())
			.filter(Boolean);
		if (keys.length > 0) {
			console.log(`已从 STEAM_API_KEYS 读取 ${keys.length} 个 Steam API Key`);
			return keys;
		}
	}

	const fallbackKey = Bun.env.STEAM_API_KEY?.trim();
	if (fallbackKey) {
		return [fallbackKey];
	}

	return [];
})();

const STEAM_RATE_LIMIT_PER_KEY = 300;
const STEAM_RATE_LIMIT_WINDOW_MS = 6 * 60 * 1000;
const steamApiKeyPoolSize = Math.max(1, steamApiKeyList.length);

const steamRequestLimiter = new Bottleneck({
	maxConcurrent: steamApiKeyPoolSize,
	reservoir: steamApiKeyPoolSize * STEAM_RATE_LIMIT_PER_KEY,
	reservoirRefreshAmount: steamApiKeyPoolSize * STEAM_RATE_LIMIT_PER_KEY,
	reservoirRefreshInterval: STEAM_RATE_LIMIT_WINDOW_MS,
});

function limitedSteamFetch(input: string, init?: RequestInit) {
	return steamRequestLimiter.schedule(async () => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), STEAM_TIMEOUT_MS);
		try {
			return await fetch(input, { ...init, signal: controller.signal });
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new SteamIdentifierError("Steam API 请求超时，请检查网络后重试。", 504, "STEAM_TIMEOUT");
			}
			throw new SteamIdentifierError("无法连接 Steam API，请检查网络或稍后重试。", 502, "STEAM_NETWORK_ERROR");
		} finally {
			clearTimeout(timer);
		}
	});
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
	code: string;

	constructor(message: string, status = 400, code = "INVALID_IDENTIFIER") {
		super(message);
		this.name = "SteamIdentifierError";
		this.status = status;
		this.code = code;
	}
}

function extractProfileIdentifier(raw: string) {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	if (!/steamcommunity\.com/i.test(trimmed)) return trimmed.replace(/^\/+|\/+$/g, "");
	try {
		const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
		const url = new URL(candidate);
		if (!/(^|\.)steamcommunity\.com$/i.test(url.hostname)) return "";
		const parts = url.pathname.split("/").filter(Boolean);
		if ((parts[0]?.toLowerCase() === "id" || parts[0]?.toLowerCase() === "profiles") && parts[1]) {
			return decodeURIComponent(parts[1]);
		}
	} catch {
		return "";
	}
	return "";
}

export async function normalizeSteamIdentifier(rawIdentifier: string, apiKeyOverride?: string) {
	const identifier = extractProfileIdentifier(rawIdentifier);
	if (!identifier) {
		throw new SteamIdentifierError(
			"Steam 账号格式无效。请输入 SteamID64、自定义用户名或完整个人资料网址。",
			400,
			"INVALID_IDENTIFIER",
		);
	}
	if (!steamIdPattern.test(identifier) && !vanityPattern.test(identifier)) {
		throw new SteamIdentifierError(
			"Steam 用户名格式无效；SteamID64 通常是 17 位数字。",
			400,
			"INVALID_IDENTIFIER",
		);
	}
	return getVanityResolution(identifier, apiKeyOverride);
}

export async function getVanityResolution(
	rawIdentifier: string,
	apiKeyOverride?: string,
) {
	const identifier = rawIdentifier.trim();

	if (!identifier) {
		throw new SteamIdentifierError("请输入 Steam 账号。", 400, "EMPTY_IDENTIFIER");
	}

	if (steamIdPattern.test(identifier)) {
		return identifier;
	}

	const cachedSteamID = await getCachedVanityResolution(identifier);
	if (cachedSteamID) {
		return cachedSteamID;
	}

	console.log(`未命中用户名缓存，正在解析：${identifier}`);
	let apiKey: string;
	try {
		apiKey = resolveSteamApiKey(apiKeyOverride);
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "STEAM_API_KEY or STEAM_API_KEYS must be configured";
		throw new SteamIdentifierError(
			"本地服务未配置 Steam API Key，请在首页填写自己的 Key，或设置 STEAM_API_KEY。",
			503,
			"API_KEY_REQUIRED",
		);
	}

	const requestUrl = buildVanityResolveUrl(identifier, apiKey);
	const response = await limitedSteamFetch(requestUrl);

	if (!response.ok) {
		if (response.status === 401 || response.status === 403) {
			throw new SteamIdentifierError("Steam API Key 无效或无权访问，请检查后重试。", 401, "INVALID_API_KEY");
		}
		if (response.status === 429) {
			throw new SteamIdentifierError("Steam API 请求过于频繁，请稍后再试。", 429, "RATE_LIMITED");
		}
		throw new SteamIdentifierError(`Steam API 返回错误（${response.status}），请稍后重试。`, 502, "STEAM_API_ERROR");
	}

	const payload = (await response.json()) as SteamResolveVanityResponse;
	const { success: successCode = 0, steamid } = payload.response ?? {};

	if (successCode === 1 && steamid) {
		await cacheVanityResolution(identifier, steamid);
		return steamid;
	}

	if (successCode === 42) {
		throw new SteamIdentifierError(
			"找不到该 Steam 自定义用户名，请检查拼写或改用 SteamID64。",
			404,
			"PROFILE_NOT_FOUND",
		);
	}

	throw new SteamIdentifierError(
		"Steam 暂时无法解析该用户名，请稍后重试或改用 SteamID64。",
		502,
		"VANITY_RESOLUTION_FAILED",
	);
}

async function fetchPlaytimeFromSteam(
	steamID: string,
	apiKeyOverride?: string,
): Promise<CachedPlaytimePayload> {
	let apiKey: string;
	try {
		apiKey = resolveSteamApiKey(apiKeyOverride);
	} catch {
		throw new SteamIdentifierError(
			"本地服务未配置 Steam API Key，请在首页填写自己的 Key，或设置 STEAM_API_KEY。",
			503,
			"API_KEY_REQUIRED",
		);
	}

	const requestUrl = buildSteamRequestUrl(steamID, apiKey);
	const steamResponse = await limitedSteamFetch(requestUrl);

	if (!steamResponse.ok) {
		if (steamResponse.status === 401 || steamResponse.status === 403) {
			throw new SteamIdentifierError("Steam API Key 无效，或该账号的游戏详情未公开。", steamResponse.status, steamResponse.status === 401 ? "INVALID_API_KEY" : "PROFILE_PRIVATE");
		}
		if (steamResponse.status === 429) {
			throw new SteamIdentifierError("Steam API 请求过于频繁，请稍后再试。", 429, "RATE_LIMITED");
		}
		throw new SteamIdentifierError(`Steam API 返回错误（${steamResponse.status}），请稍后重试。`, 502, "STEAM_API_ERROR");
	}

	const data = (await steamResponse.json()) as SteamOwnedGamesResponse;
	console.log(`SteamID ${steamID}：读取到 ${data.response?.game_count ?? 0} 款游戏`);

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

export async function getPlaytimePayload(
	steamID: string,
	apiKeyOverride?: string,
): Promise<CachedPlaytimePayload> {
	const cachedPayload = await getCachedPlaytimePayload(steamID);
	if (cachedPayload) {
		return cachedPayload;
	}

	console.log(`SteamID ${steamID} 未命中有效缓存，正在请求 Steam API`);

	return fetchPlaytimeFromSteam(steamID, apiKeyOverride);
}
