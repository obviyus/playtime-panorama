import { resolve } from "node:path";
import { getLeaderboardSnapshot } from "~/server/leaderboard";
import {
	getPlaytimePayload,
	normalizeSteamIdentifier,
	SteamIdentifierError,
	type SteamGame,
} from "~/server/steam";
const port = Number.parseInt(Bun.env.PORT ?? Bun.env.BUN_PORT ?? "3000", 10);
const developmentMode = Bun.env.NODE_ENV !== "production";
const publicDir = developmentMode
	? resolve(import.meta.dir, "../public")
	: resolve(import.meta.dir, "public");
const templatesDir = developmentMode
	? resolve(import.meta.dir, "../templates")
	: resolve(import.meta.dir, "templates");

if (!Bun.env.STEAM_API_KEY && !Bun.env.STEAM_API_KEYS) {
	console.warn("未配置 STEAM_API_KEY/STEAM_API_KEYS；查询时需要在网页中提供 Key。");
}

const jsonError = (message: string, status: number, code: string) =>
	Response.json({ error: message, code }, { status });

function errorResponse(error: unknown, identifier?: string) {
	if (error instanceof SteamIdentifierError) {
		return { identifier, error: error.message, code: error.code, status: error.status };
	}
	console.error("Steam 数据请求失败：", error instanceof Error ? error.message : error);
	return {
		identifier,
		error: "暂时无法从 Steam 获取数据，请检查网络后重试。",
		code: "STEAM_UNAVAILABLE",
		status: 502,
	};
}

function mergeGames(payloads: Array<{ games: SteamGame[] }>) {
	const map = new Map<number, SteamGame>();
	for (const payload of payloads) {
		for (const game of payload.games) {
			if (!Number.isInteger(game.appid) || game.appid <= 0) continue;
			const minutes = Math.max(0, Number(game.playtime_forever) || 0);
			const existing = map.get(game.appid);
			if (existing) {
				existing.playtime_forever += minutes;
				existing.rtime_last_played = Math.max(
					existing.rtime_last_played ?? 0,
					game.rtime_last_played ?? 0,
				);
			} else {
				map.set(game.appid, { ...game, playtime_forever: minutes });
			}
		}
	}
	return [...map.values()].sort((a, b) => b.playtime_forever - a.playtime_forever);
}

async function loadOne(identifier: string, apiKey?: string) {
	const steamID = await normalizeSteamIdentifier(identifier, apiKey);
	const payload = await getPlaytimePayload(steamID, apiKey);
	if (!payload.games.length) {
		throw new SteamIdentifierError(
			"没有找到已游玩的游戏。请确认个人资料、游戏详情和总游戏时间均为公开状态。",
			403,
			"NO_PUBLIC_GAMES",
		);
	}
	return { identifier, steamID, ...payload };
}

async function loadMany(identifiers: string[], apiKey?: string) {
	const successes: Awaited<ReturnType<typeof loadOne>>[] = [];
	const failures: Array<ReturnType<typeof errorResponse>> = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(3, identifiers.length) }, async () => {
		while (cursor < identifiers.length) {
			const index = cursor++;
			const identifier = identifiers[index];
			if (!identifier) continue;
			try {
				successes.push(await loadOne(identifier, apiKey));
			} catch (error) {
				failures.push(errorResponse(error, identifier));
			}
		}
	});
	await Promise.all(workers);

	if (!successes.length) {
		const first = failures[0];
		return Response.json(
			{
				error: first?.error ?? "所有账号均读取失败，请检查输入、隐私设置或 API Key。",
				code: first?.code ?? "ALL_PROFILES_FAILED",
				accounts: { successful: [], failed: failures },
			},
			{ status: first?.status ?? 502 },
		);
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
	});
}

function parseIdentifierList(input: unknown) {
	const raw = Array.isArray(input) ? input.join("\n") : String(input ?? "");
	const tokens = raw.split(/[\s,，;；]+/u).map((value) => value.trim()).filter(Boolean);
	const unique = new Map<string, string>();
	for (const token of tokens) {
		const normalized = token.replace(/^\/+|\/+$/g, "");
		if (normalized) unique.set(normalized.toLowerCase(), normalized);
	}
	return [...unique.values()];
}

async function playtimePost(req: Request) {
	let body: { identifiers?: unknown; apiKey?: unknown };
	try {
		body = (await req.json()) as { identifiers?: unknown; apiKey?: unknown };
	} catch {
		return jsonError("请求内容格式无效。", 400, "INVALID_JSON");
	}
	const identifiers = parseIdentifierList(body.identifiers);
	if (!identifiers.length) return jsonError("请输入至少一个 Steam 账号。", 400, "EMPTY_IDENTIFIER");
	if (identifiers.length > 10) return jsonError("一次最多合并 10 个 Steam 账号。", 400, "TOO_MANY_IDENTIFIERS");
	const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined;
	return loadMany(identifiers, apiKey);
}

const staticFile = (path: string, type: string) => {
	const file = Bun.file(resolve(publicDir, path));
	return new Response(file, { headers: { "Content-Type": type, "Cache-Control": developmentMode ? "no-cache" : "public, max-age=3600" } });
};
const htmlFile = (name: string) => new Response(Bun.file(resolve(templatesDir, name)), {
	headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
});

const server = Bun.serve({
	port: Number.isFinite(port) && port > 0 ? port : 3000,
	development: developmentMode ? { hmr: true, console: true } : false,
	routes: {
		"/": { GET: () => htmlFile("root.html") },
		"/guide": { GET: () => htmlFile("guide.html") },
		"/faq": { GET: () => htmlFile("faq.html") },
		"/leaderboard": { GET: () => htmlFile("leaderboard.html") },
		"/profile/:identifiers": { GET: () => htmlFile("profile.html") },
		"/assets/site.css": { GET: () => staticFile("assets/site.css", "text/css; charset=utf-8") },
		"/assets/site.js": { GET: () => staticFile("assets/site.js", "text/javascript; charset=utf-8") },
		"/assets/home.js": { GET: () => staticFile("assets/home.js", "text/javascript; charset=utf-8") },
		"/assets/profile.js": { GET: () => staticFile("assets/profile.js", "text/javascript; charset=utf-8") },
		"/assets/leaderboard.js": { GET: () => staticFile("assets/leaderboard.js", "text/javascript; charset=utf-8") },
		"/favicon.svg": { GET: () => staticFile("favicon.svg", "image/svg+xml") },
		"/site.webmanifest": { GET: () => staticFile("site.webmanifest", "application/manifest+json") },
		"/api/playtime": { POST: playtimePost },
		"/api/playtime/:identifier": {
			GET: async (req) => {
				const identifier = req.params.identifier ?? "";
				if (!identifier.trim()) return jsonError("请输入 Steam 账号。", 400, "EMPTY_IDENTIFIER");
				try {
					const result = await loadOne(identifier, req.headers.get("X-Steam-API-Key") ?? undefined);
					return Response.json(result, { headers: { "Cache-Control": "private, max-age=300" } });
				} catch (error) {
					const detail = errorResponse(error, identifier);
					return Response.json({ error: detail.error, code: detail.code }, { status: detail.status });
				}
			},
		},
		"/api/leaderboard": {
			GET: async () => {
				try {
					return Response.json(await getLeaderboardSnapshot(), { headers: { "Cache-Control": "no-store" } });
				} catch (error) {
					console.error("排行榜读取失败：", error instanceof Error ? error.message : error);
					return jsonError("排行榜暂时无法读取，请确认数据库可写后重试。", 500, "DATABASE_ERROR");
				}
			},
		},
		"/:steamID": { GET: () => htmlFile("profile.html") },
	},
	fetch() {
		return new Response("页面不存在", { status: 404 });
	},
});

console.log(`Steam 游玩时光全景图已启动：\nhttp://localhost:${server.port}`);
