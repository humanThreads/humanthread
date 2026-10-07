export type ActivityLogTone = "neutral" | "success" | "warning" | "error";

export interface ActivityLogEntry {
  id: string;
  title: string;
  detail: string;
  tone: ActivityLogTone;
  createdAt: string;
}

const DEFAULT_MAX_ACTIVITY_ENTRIES = 6;

export function appendActivityLogEntry(
  entries: ActivityLogEntry[],
  entry: ActivityLogEntry,
  maxEntries = DEFAULT_MAX_ACTIVITY_ENTRIES,
): ActivityLogEntry[] {
  const limit =
    Number.isFinite(maxEntries) && maxEntries > 0
      ? Math.floor(maxEntries)
      : DEFAULT_MAX_ACTIVITY_ENTRIES;

  return [entry, ...entries].slice(0, limit);
}
