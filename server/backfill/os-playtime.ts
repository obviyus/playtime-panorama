import { listCachedPlaytimeRecords } from "~/server/database";
import { filterRecordsNeedingPlatformData } from "~/server/os-playtime";
import { getPlaytimePayload } from "~/server/steam";

type BackfillStateStatus =
	| "idle"
	| "running"
	| "completed"
	| "completed_with_errors"
	| "failed";

interface BackfillState {
	status: BackfillStateStatus;
	startedAt: number | null;
	finishedAt: number | null;
	totalProfiles: number;
	processedProfiles: number;
	refreshedProfiles: number;
	failedProfiles: number;
	errors: { steamId: string; message: string }[];
	lastError?: string;
	currentSteamId?: string;
}

interface StartOptions {
	apiKeyOverride?: string;
}

const MAX_TRACKED_ERRORS = 10;

const state: BackfillState = {
	status: "idle",
	startedAt: null,
	finishedAt: null,
	totalProfiles: 0,
	processedProfiles: 0,
	refreshedProfiles: 0,
	failedProfiles: 0,
	errors: [],
};

let jobPromise: Promise<void> | null = null;

function resetState() {
	state.status = "idle";
	state.startedAt = null;
	state.finishedAt = null;
	state.totalProfiles = 0;
	state.processedProfiles = 0;
	state.refreshedProfiles = 0;
	state.failedProfiles = 0;
	state.errors = [];
	delete state.lastError;
	delete state.currentSteamId;
}

async function runBackfill(options: StartOptions) {
	try {
		const cachedRecords = await listCachedPlaytimeRecords({
			includeExpired: true,
		});

		const targets = filterRecordsNeedingPlatformData(cachedRecords);
		state.totalProfiles = targets.length;

		if (!targets.length) {
			state.status = "completed";
			return;
		}

		for (const record of targets) {
			state.currentSteamId = record.steamId;

			try {
				await getPlaytimePayload(record.steamId, {
					forceRefresh: true,
					apiKeyOverride: options.apiKeyOverride,
				});

				state.refreshedProfiles += 1;
			} catch (error) {
				state.lastError =
					error instanceof Error ? error.message : String(error);
				state.failedProfiles += 1;
				state.errors.push({
					steamId: record.steamId,
					message: state.lastError,
				});
				if (state.errors.length > MAX_TRACKED_ERRORS) {
					state.errors.splice(0, state.errors.length - MAX_TRACKED_ERRORS);
				}
			}

			state.processedProfiles += 1;
		}

		state.status = state.errors.length ? "completed_with_errors" : "completed";
	} catch (error) {
		state.status = "failed";
		state.lastError = error instanceof Error ? error.message : String(error);
	} finally {
		state.finishedAt = Date.now();
		delete state.currentSteamId;
		jobPromise = null;
	}
}

export function startOsPlaytimeBackfill(options: StartOptions) {
	if (state.status === "running" && jobPromise) {
		return {
			started: false,
			reason: "A backfill job is already running.",
			status: getOsPlaytimeBackfillStatus(),
		};
	}

	resetState();
	state.status = "running";
	state.startedAt = Date.now();
	state.finishedAt = null;
	jobPromise = runBackfill(options);

	return {
		started: true,
		status: getOsPlaytimeBackfillStatus(),
	};
}

export function getOsPlaytimeBackfillStatus(): BackfillState {
	return { ...state, errors: [...state.errors] };
}

export function formatOsPlaytimeBackfillStatus(): string {
	const snapshot = getOsPlaytimeBackfillStatus();
	const lines: string[] = [];
	lines.push(`status: ${snapshot.status}`);
	if (snapshot.startedAt) {
		lines.push(`started_at: ${new Date(snapshot.startedAt).toISOString()}`);
	}
	if (snapshot.finishedAt) {
		lines.push(`finished_at: ${new Date(snapshot.finishedAt).toISOString()}`);
	}
	lines.push(
		`processed: ${snapshot.processedProfiles}/${snapshot.totalProfiles || 0}`,
	);
	lines.push(`refreshed: ${snapshot.refreshedProfiles}`);
	if (snapshot.failedProfiles) {
		lines.push(`failed: ${snapshot.failedProfiles}`);
	}
	if (snapshot.errors.length) {
		lines.push(`errors: ${snapshot.errors.length}`);
		lines.push(
			`last_error: ${snapshot.lastError ?? snapshot.errors.at(-1)?.message ?? "unknown"}`,
		);
	} else if (snapshot.lastError) {
		lines.push(`last_error: ${snapshot.lastError}`);
	}
	if (snapshot.currentSteamId) {
		lines.push(`current: ${snapshot.currentSteamId}`);
	}
	return lines.join("\n");
}
