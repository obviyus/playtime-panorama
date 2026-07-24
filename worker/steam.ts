import { cachePlaytimePayload, cacheVanityResolution, getCachedPlaytimePayload, getCachedVanityResolution } from "./database";
import type { CachedPlaytimePayload, Env, SteamOwnedGamesResponse, SteamResolveVanityResponse } from "./types";

const STEAM_API_BASE = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const STEAM_VANITY_API_BASE = "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/";
const STEAM_TIMEOUT_MS = 12_000;
const steamIdPattern = /^\d{17}$/;
const vanityPattern = /^[A-Za-z0-9_-]{2,64}$/;

export class SteamIdentifierError extends Error {
	constructor(message: string, public readonly status = 400, public readonly code = "INVALID_IDENTIFIER") {
		super(message);
		this.name = "SteamIdentifierError";
	}
}

function selectApiKey(env: Env, requestKey?: string): string {
	const userKey = requestKey?.trim();
	if (userKey) return userKey;
	const keys = (env.STEAM_API_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
	if (keys.length) return keys[crypto.getRandomValues(new Uint32Array(1))[0]! % keys.length]!;
	const fallback = env.STEAM_API_KEY?.trim();
	if (fallback) return fallback;
	throw new SteamIdentifierError("服务端尚未配置 Steam API Key，请在首页填写自己的 Key，或由站点管理员配置 Cloudflare Secret。", 503, "API_KEY_REQUIRED");
}

async function steamFetch(url: URL): Promise<Response> {
	try {
		return await fetch(url, { signal: AbortSignal.timeout(STEAM_TIMEOUT_MS) });
	} catch (error) {
		if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
			throw new SteamIdentifierError("Steam API 请求超时，请稍后重试。", 504, "STEAM_TIMEOUT");
		}
		throw new SteamIdentifierError("暂时无法连接 Steam API，请稍后重试。", 502, "STEAM_NETWORK_ERROR");
	}
}

function throwForSteamStatus(status: number): never {
	if (status === 401) throw new SteamIdentifierError("Steam API Key 无效，请检查后重试。", 401, "INVALID_API_KEY");
	if (status === 403) throw new SteamIdentifierError("Steam 拒绝访问；请检查 API Key 及账号的游戏详情隐私设置。", 403, "PROFILE_PRIVATE");
	if (status === 429) throw new SteamIdentifierError("Steam API 请求过于频繁，请稍后重试。", 429, "RATE_LIMITED");
	throw new SteamIdentifierError(`Steam API 返回错误（${status}），请稍后重试。`, 502, "STEAM_API_ERROR");
}

function extractProfileIdentifier(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	if (!/steamcommunity\.com/i.test(trimmed)) return trimmed.replace(/^\/+|\/+$/g, "");
	try {
		const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
		if (!/(^|\.)steamcommunity\.com$/i.test(url.hostname)) return "";
		const parts = url.pathname.split("/").filter(Boolean);
		if (["id", "profiles"].includes(parts[0]?.toLowerCase() ?? "") && parts[1]) return decodeURIComponent(parts[1]);
	} catch {
		return "";
	}
	return "";
}

export async function normalizeSteamIdentifier(env: Env, rawIdentifier: string, requestKey?: string): Promise<string> {
	const identifier = extractProfileIdentifier(rawIdentifier);
	if (!identifier || (!steamIdPattern.test(identifier) && !vanityPattern.test(identifier))) {
		throw new SteamIdentifierError("Steam 账号格式无效。请输入 SteamID64、自定义用户名或完整个人资料网址。", 400, "INVALID_IDENTIFIER");
	}
	if (steamIdPattern.test(identifier)) return identifier;
	const cached = await getCachedVanityResolution(env.DB, identifier);
	if (cached) return cached;

	const url = new URL(STEAM_VANITY_API_BASE);
	url.search = new URLSearchParams({ key: selectApiKey(env, requestKey), vanityurl: identifier }).toString();
	const response = await steamFetch(url);
	if (!response.ok) throwForSteamStatus(response.status);
	const payload = await response.json<SteamResolveVanityResponse>();
	if (payload.response?.success === 1 && payload.response.steamid) {
		await cacheVanityResolution(env.DB, identifier, payload.response.steamid);
		return payload.response.steamid;
	}
	if (payload.response?.success === 42) {
		throw new SteamIdentifierError("找不到该 Steam 自定义用户名，请检查拼写或改用 SteamID64。", 404, "PROFILE_NOT_FOUND");
	}
	throw new SteamIdentifierError("Steam 暂时无法解析该用户名，请稍后重试或改用 SteamID64。", 502, "VANITY_RESOLUTION_FAILED");
}

export async function getPlaytimePayload(env: Env, steamId: string, requestKey?: string): Promise<CachedPlaytimePayload> {
	const cached = await getCachedPlaytimePayload(env.DB, steamId);
	if (cached) return cached;

	const url = new URL(STEAM_API_BASE);
	url.search = new URLSearchParams({
		key: selectApiKey(env, requestKey), steamid: steamId,
		include_appinfo: "1", include_played_free_games: "1",
	}).toString();
	const response = await steamFetch(url);
	if (!response.ok) throwForSteamStatus(response.status);
	const data = await response.json<SteamOwnedGamesResponse>();
	const games = (data.response?.games ?? [])
		.filter((game) => Number.isInteger(game.appid) && game.appid > 0 && Number(game.playtime_forever) > 10)
		.map((game) => ({ ...game, playtime_forever: Math.max(0, Math.trunc(Number(game.playtime_forever) || 0)) }));
	const payload = { game_count: games.length, games };
	if (payload.game_count) await cachePlaytimePayload(env.DB, steamId, payload);
	return payload;
}
