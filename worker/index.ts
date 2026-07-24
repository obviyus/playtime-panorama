import { getLeaderboardSnapshot } from "./leaderboard";
import { getPlaytimePayload, normalizeSteamIdentifier, SteamIdentifierError } from "./steam";
import type { Env, SteamGame } from "./types";

const RESERVED_PATHS = new Set([
	"api", "assets", "guide", "faq", "leaderboard", "profile",
	"favicon.svg", "site.webmanifest", "robots.txt",
]);

const jsonHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const jsonError = (message: string, status: number, code: string) =>
	Response.json({ error: message, code }, { status, headers: jsonHeaders });

function errorDetail(error: unknown, identifier?: string) {
	if (error instanceof SteamIdentifierError) {
		return { identifier, error: error.message, code: error.code, status: error.status };
	}
	console.error("Steam 数据请求失败", error instanceof Error ? error.name : "UnknownError");
	return { identifier, error: "暂时无法从 Steam 获取数据，请稍后重试。", code: "STEAM_UNAVAILABLE", status: 502 };
}

function parseIdentifierList(input: unknown): string[] {
	const raw = Array.isArray(input) ? input.join("\n") : String(input ?? "");
	const unique = new Map<string, string>();
	for (const token of raw.split(/[\s,，;；]+/u)) {
		const normalized = token.trim().replace(/^\/+|\/+$/g, "");
		if (normalized) unique.set(normalized.toLowerCase(), normalized);
	}
	return [...unique.values()];
}

function mergeGames(payloads: Array<{ games: SteamGame[] }>): SteamGame[] {
	const games = new Map<number, SteamGame>();
	for (const payload of payloads) {
		for (const game of payload.games) {
			if (!Number.isInteger(game.appid) || game.appid <= 0) continue;
			const minutes = Math.max(0, Math.trunc(Number(game.playtime_forever) || 0));
			const existing = games.get(game.appid);
			if (existing) {
				existing.playtime_forever += minutes;
				existing.rtime_last_played = Math.max(existing.rtime_last_played ?? 0, game.rtime_last_played ?? 0);
				if (!existing.name && game.name) existing.name = game.name;
			} else {
				games.set(game.appid, { ...game, playtime_forever: minutes });
			}
		}
	}
	return [...games.values()].sort((a, b) => b.playtime_forever - a.playtime_forever);
}

async function loadOne(env: Env, identifier: string, requestKey?: string) {
	const steamID = await normalizeSteamIdentifier(env, identifier, requestKey);
	const payload = await getPlaytimePayload(env, steamID, requestKey);
	if (!payload.games.length) {
		throw new SteamIdentifierError("没有找到已游玩的游戏。请确认个人资料、游戏详情和总游戏时间均为公开状态。", 403, "NO_PUBLIC_GAMES");
	}
	return { identifier, steamID, ...payload };
}

async function loadMany(env: Env, identifiers: string[], requestKey?: string): Promise<Response> {
	const successes: Awaited<ReturnType<typeof loadOne>>[] = [];
	const failures: Array<ReturnType<typeof errorDetail>> = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(3, identifiers.length) }, async () => {
		while (cursor < identifiers.length) {
			const identifier = identifiers[cursor++];
			if (!identifier) continue;
			try {
				successes.push(await loadOne(env, identifier, requestKey));
			} catch (error) {
				failures.push(errorDetail(error, identifier));
			}
		}
	});
	await Promise.all(workers);

	if (!successes.length) {
		const first = failures[0];
		return Response.json({
			error: first?.error ?? "所有账号均读取失败，请检查输入、隐私设置或 API Key。",
			code: first?.code ?? "ALL_PROFILES_FAILED",
			accounts: { successful: [], failed: failures },
		}, { status: first?.status ?? 502, headers: jsonHeaders });
	}

	const games = mergeGames(successes);
	return Response.json({
		game_count: games.length,
		games,
		merged: identifiers.length > 1,
		requestedCount: identifiers.length,
		accounts: {
			successful: successes.map(({ identifier, steamID }) => ({ identifier, steamID })),
			failed: failures,
		},
	}, { headers: { ...jsonHeaders, "Cache-Control": "private, max-age=300" } });
}

function validateIdentifiers(identifiers: string[]): Response | null {
	if (!identifiers.length) return jsonError("请输入至少一个 Steam 账号。", 400, "EMPTY_IDENTIFIER");
	if (identifiers.length > 10) return jsonError("一次最多合并 10 个 Steam 账号。", 400, "TOO_MANY_IDENTIFIERS");
	return null;
}

async function playtimePost(request: Request, env: Env): Promise<Response> {
	let body: { identifiers?: unknown };
	try {
		body = await request.json<{ identifiers?: unknown }>();
	} catch {
		return jsonError("请求内容格式无效。", 400, "INVALID_JSON");
	}
	const identifiers = parseIdentifierList(body.identifiers);
	return validateIdentifiers(identifiers) ?? loadMany(env, identifiers, request.headers.get("X-Steam-API-Key") ?? undefined);
}

function assetRequest(request: Request, pathname: string): Request {
	const url = new URL(request.url);
	url.pathname = pathname;
	url.search = "";
	return new Request(url, request);
}

async function serveAsset(request: Request, env: Env, pathname: string): Promise<Response> {
	const response = await env.ASSETS.fetch(assetRequest(request, pathname));
	const headers = new Headers(response.headers);
	if (pathname.endsWith(".html")) headers.set("Cache-Control", "no-cache");
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function leaderboardResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const cache = caches.default;
	const cached = await cache.match(request);
	if (cached) return cached;
	try {
		const response = Response.json(await getLeaderboardSnapshot(env), {
			headers: { "Cache-Control": "public, max-age=0, s-maxage=300", "X-Content-Type-Options": "nosniff" },
		});
		ctx.waitUntil(cache.put(request, response.clone()));
		return response;
	} catch (error) {
		console.error("排行榜读取失败", error instanceof Error ? error.name : "UnknownError");
		return jsonError("排行榜暂时无法读取，请确认本地 D1 已初始化。", 500, "DATABASE_ERROR");
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;
		const method = request.method.toUpperCase();

		if (url.searchParams.has("api_key")) return jsonError("不支持通过 URL 传递 API Key。", 400, "API_KEY_IN_URL");

		if (pathname === "/api/playtime" && method === "POST") return playtimePost(request, env);
		if (pathname.startsWith("/api/playtime/") && method === "GET") {
			let identifier = "";
			try { identifier = decodeURIComponent(pathname.slice("/api/playtime/".length)); } catch { /* validated below */ }
			const identifiers = parseIdentifierList(identifier);
			return validateIdentifiers(identifiers) ?? loadMany(env, identifiers, request.headers.get("X-Steam-API-Key") ?? undefined);
		}
		if (pathname === "/api/leaderboard" && method === "GET") return leaderboardResponse(request, env, ctx);
		if (pathname.startsWith("/api/")) return jsonError("API 路径不存在。", 404, "NOT_FOUND");

		if (method !== "GET" && method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
		if (pathname === "/") return serveAsset(request, env, "/index.html");
		if (pathname === "/guide" || pathname === "/guide/") return serveAsset(request, env, "/guide/index.html");
		if (pathname === "/faq" || pathname === "/faq/") return serveAsset(request, env, "/faq/index.html");
		if (pathname === "/leaderboard" || pathname === "/leaderboard/") return serveAsset(request, env, "/leaderboard/index.html");
		if (pathname.startsWith("/profile/") && pathname.length > "/profile/".length) return serveAsset(request, env, "/profile.html");

		const segments = pathname.split("/").filter(Boolean);
		if (segments.length === 1 && !RESERVED_PATHS.has(segments[0]!.toLowerCase())) {
			return serveAsset(request, env, "/profile.html");
		}
		return env.ASSETS.fetch(request);
	},
};
