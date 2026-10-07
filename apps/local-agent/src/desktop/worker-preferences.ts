export type LocalWorkerPreferences = {
  enabled: boolean;
  maxConcurrency: number;
};

export const DEFAULT_LOCAL_WORKER_PREFERENCES: LocalWorkerPreferences = {
  enabled: true,
  maxConcurrency: 1,
};

export const LOCAL_WORKER_PREFERENCES_CHANGED = "humanthread:worker-preferences-changed";
export const LOCAL_WORKER_ACTIVITY_CHANGED = "humanthread:worker-activity-changed";

export function publishLocalWorkerPreferences(preferences: LocalWorkerPreferences): void {
  globalThis.dispatchEvent(new CustomEvent(LOCAL_WORKER_PREFERENCES_CHANGED, { detail: preferences }));
}

export function publishLocalWorkerActivity(activeRunCount: number): void {
  globalThis.dispatchEvent(new CustomEvent(LOCAL_WORKER_ACTIVITY_CHANGED, { detail: { activeRunCount } }));
}
