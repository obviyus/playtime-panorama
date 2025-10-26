import type { SteamGame } from "~/server/steam";
import {
	listCachedPlaytimeRecords,
	type CachedPlaytimeRecord,
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

export interface LeaderboardSnapshot {
	generatedAt: number;
	metrics: LeaderboardMetrics;
}

const MAX_ROWS = 25;

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
	const cachedRecords = await listCachedPlaytimeRecords();
	const summaries = cachedRecords.map(summarizeRecord);

	const filteredSummaries = limitEntries(summaries);

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

	return {
		metrics,
		generatedAt: Math.floor(Date.now() / 1000),
	};
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function formatMinutes(minutes: number): string {
	const roundedMinutes = Math.round(minutes);
	const hours = Math.floor(roundedMinutes / 60);
	const remainder = roundedMinutes % 60;

	if (hours && remainder) {
		return `${hours}h ${remainder}m`;
	}

	if (hours) {
		return `${hours}h`;
	}

	return `${roundedMinutes}m`;
}

function formatTimestamp(seconds: number): string {
	const date = new Date(seconds * 1000);
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hours = String(date.getUTCHours()).padStart(2, "0");
	const minutes = String(date.getUTCMinutes()).padStart(2, "0");

	return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

interface MetricDefinition {
	id: "games" | "time" | "average";
	label: string;
	description: string;
	entries: LeaderboardEntry[];
}

function renderLeaderboardTable(entries: LeaderboardEntry[]) {
	if (!entries.length) {
		return `
			<div class="empty-state">
				<p>No cached profiles yet.</p>
				<p><a href="/">Run a profile</a> to populate the leaderboard.</p>
			</div>
		`;
	}

	return `
		<div class="table-wrapper">
			<table class="leaderboard-table">
				<thead>
					<tr>
						<th scope="col">#</th>
						<th scope="col">SteamID</th>
						<th scope="col">Games</th>
						<th scope="col">Total</th>
						<th scope="col">Avg / game</th>
						<th scope="col">Top title</th>
						<th scope="col">Cached</th>
					</tr>
				</thead>
				<tbody>
					${entries
						.map((entry, index) => {
							const rank = index + 1;
							const formattedTotal = formatMinutes(entry.totalMinutes);
							const formattedAverage = formatMinutes(entry.averageMinutes);
							const topGame =
								entry.topGame && entry.topGame.minutes > 0
									? `${escapeHtml(entry.topGame.name)} (${formatMinutes(entry.topGame.minutes)})`
									: "—";

							return `
								<tr>
									<td class="cell-rank">${rank}</td>
									<td class="cell-id"><a href="${entry.profileHref}">${escapeHtml(entry.steamId)}</a></td>
									<td>${entry.gameCount.toLocaleString()}</td>
									<td>${formattedTotal}</td>
									<td>${formattedAverage}</td>
									<td>${topGame}</td>
									<td class="cell-updated">${formatTimestamp(entry.lastUpdated)}</td>
								</tr>
							`;
						})
						.join("")}
				</tbody>
			</table>
		</div>
	`;
}

export function renderLeaderboardHtml(snapshot: LeaderboardSnapshot): string {
	const metricDefinitions: MetricDefinition[] = [
		{
			id: "games",
			label: "Most Games",
			description: "Players with the largest cached libraries.",
			entries: snapshot.metrics.byGameCount,
		},
		{
			id: "time",
			label: "Most Playtime",
			description: "Total minutes played across cached titles.",
			entries: snapshot.metrics.byTotalPlaytime,
		},
		{
			id: "average",
			label: "Highest Avg",
			description: "Average minutes per cached game.",
			entries: snapshot.metrics.byAveragePlaytime,
		},
	];

	const firstTab = metricDefinitions[0]?.id ?? "games";

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Leaderboard • Playtime Panorama</title>
	<style>
		:root {
			color-scheme: dark;
			font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			background-color: #0a0a0a;
			color: #f2f2f2;
		}

		body {
			margin: 0;
			min-height: 100vh;
			display: flex;
			flex-direction: column;
			background: #080808;
		}

		header {
			padding: 2rem clamp(1.25rem, 4vw, 2.5rem) 1rem;
			display: flex;
			flex-direction: column;
			gap: 0.8rem;
		}

		header h1 {
			margin: 0;
			font-size: clamp(1.6rem, 2.4vw, 2.1rem);
			letter-spacing: -0.02em;
		}

		header p {
			margin: 0;
			max-width: 46rem;
			color: #bdbdbd;
			line-height: 1.5;
			font-size: 0.95rem;
		}

		.tab-bar {
			display: flex;
			gap: 0.5rem;
			margin-top: 0.2rem;
		}

		.tab {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: 0.38rem 1rem;
			border-radius: 0.6rem;
			border: 1px solid transparent;
			background: rgba(255, 255, 255, 0.05);
			color: #d9d9d9;
			font: inherit;
			font-weight: 600;
			cursor: pointer;
			transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
			font-size: 0.95rem;
		}

		.tab:hover {
			background: rgba(255, 255, 255, 0.1);
		}

		.tab.active {
			background-color: #f5f5f5;
			color: #101010;
			border-color: rgba(255, 255, 255, 0.35);
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
		}

		main {
			flex: 1;
			padding: 0 clamp(1.25rem, 4vw, 2.5rem) 2.5rem;
			display: grid;
			gap: 1.75rem;
		}

		.tab-panel {
			display: none;
			border-radius: 1rem;
			border: 1px solid rgba(255, 255, 255, 0.06);
			background: rgba(18, 18, 18, 0.75);
			box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
			padding: 1.5rem;
		}

		.tab-panel.active {
			display: block;
		}

		.tab-panel h2 {
			margin: 0;
			font-size: 1.1rem;
			letter-spacing: -0.01em;
		}

		.tab-panel p {
			margin: 0.35rem 0 0.9rem;
			color: #9a9a9a;
			line-height: 1.45;
			font-size: 0.9rem;
		}

		.table-wrapper {
			overflow-x: auto;
		}

		.leaderboard-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 0.92rem;
			color: #e3e3e3;
			min-width: 640px;
		}

		.leaderboard-table th {
			text-align: left;
			font-size: 0.74rem;
			text-transform: uppercase;
			letter-spacing: 0.09em;
			color: #8b8b8b;
			font-weight: 600;
			padding: 0.35rem 0.6rem;
			border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		}

		.leaderboard-table td {
			padding: 0.45rem 0.6rem;
			border-bottom: 1px solid rgba(255, 255, 255, 0.06);
			vertical-align: middle;
		}

		.leaderboard-table tbody tr:last-child td {
			border-bottom: none;
		}

		.leaderboard-table tbody tr:hover td {
			background: rgba(255, 255, 255, 0.05);
		}

		.cell-rank {
			font-variant-numeric: tabular-nums;
			font-weight: 600;
			color: #b4b4b4;
			width: 2.2rem;
		}

		.cell-id a {
			color: inherit;
			text-decoration: none;
			font-weight: 600;
			letter-spacing: -0.01em;
		}

		.cell-id a:hover {
			text-decoration: underline;
		}

		.cell-updated {
			font-size: 0.82rem;
			color: #8e8e8e;
			white-space: nowrap;
		}

		.empty-state {
			text-align: center;
			padding: 1.75rem 1.2rem;
			border-radius: 0.75rem;
			border: 1px dashed rgba(255, 255, 255, 0.15);
			background: rgba(255, 255, 255, 0.02);
			display: grid;
			gap: 0.4rem;
		}

		.empty-state p {
			margin: 0;
			color: #b5b5b5;
		}

		.empty-state a {
			color: #f5f5f5;
			font-weight: 600;
			text-decoration: none;
		}

		.empty-state a:hover {
			text-decoration: underline;
		}

		footer {
			padding: 0 0 1.75rem;
			display: flex;
			justify-content: center;
			gap: 0.5rem;
			color: #808080;
			font-size: 0.8rem;
		}

		footer a {
			color: inherit;
			text-decoration: none;
			font-weight: 500;
		}

		footer a:hover {
			color: #f2f2f2;
		}

		@media (max-width: 720px) {
			.leaderboard-table {
				min-width: 520px;
			}
		}

		@media (max-width: 560px) {
			.tab-panel {
				padding: 1.25rem;
			}

			header {
				padding: 1.75rem 1.25rem 0.9rem;
			}

			main {
				padding: 0 1.25rem 2rem;
			}
		}
	</style>
</head>
<body>
	<header>
		<h1>Leaderboards</h1>
		<p>Browse cached Steam profiles to see who hoards the most games or racks up the most minutes. Data refreshes whenever someone loads a profile and sticks around for 24 hours.</p>
		<div class="tab-bar">
			${metricDefinitions
				.map(
					(metric) =>
						`<button class="tab${
							metric.id === firstTab ? " active" : ""
						}" type="button" data-tab="${metric.id}">${metric.label}</button>`,
				)
				.join("")}
		</div>
	</header>
	<main>
		${metricDefinitions
			.map(
				(metric) => `
					<section class="tab-panel${
						metric.id === firstTab ? " active" : ""
					}" data-tab-panel="${metric.id}">
						<h2>${metric.label}</h2>
						<p>${metric.description}</p>
						${renderLeaderboardTable(metric.entries)}
					</section>
				`,
			)
			.join("")}
	</main>
	<footer>
		<span>Generated: ${formatTimestamp(snapshot.generatedAt)}</span>
		<span>•</span>
		<a href="/">Back to panorama builder</a>
	</footer>
	<script>
		const tabs = document.querySelectorAll('.tab');
		const panels = document.querySelectorAll('.tab-panel');

		const activateTab = (id) => {
			tabs.forEach(tab => {
				tab.classList.toggle('active', tab.dataset.tab === id);
			});

			panels.forEach(panel => {
				panel.classList.toggle('active', panel.dataset.tabPanel === id);
			});
		};

		tabs.forEach(tab => {
			tab.addEventListener('click', () => {
				const targetId = tab.dataset.tab;
				if (targetId) {
					activateTab(targetId);
				}
			});
		});
	</script>
</body>
</html>`;
}
