export const DOCUMENT_WORKSPACE_MODE_VALUES = ["edit", "view"] as const;
export type DocumentWorkspaceMode = (typeof DOCUMENT_WORKSPACE_MODE_VALUES)[number];

export interface DocumentWorkspaceSnapshot {
  expandedDirectoryIds: string[];
  mode: DocumentWorkspaceMode;
}

export const getDocumentWorkspaceStorageKey = (scopeKey: string) =>
  `humanthread:document-workspace:web:${scopeKey}`;

export const getDocumentWorkspaceNavigationStorageKey = (scopeKey: string) =>
  `${getDocumentWorkspaceStorageKey(scopeKey)}:navigation`;

type StringStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export type DocumentWorkspaceSnapshotStorage = StringStorage | Map<string, string>;

function getValue(storage: DocumentWorkspaceSnapshotStorage, key: string) {
  return storage instanceof Map ? storage.get(key) ?? null : storage.getItem(key);
}

function setValue(storage: DocumentWorkspaceSnapshotStorage, key: string, value: string) {
  if (storage instanceof Map) storage.set(key, value);
  else storage.setItem(key, value);
}

function removeValue(storage: DocumentWorkspaceSnapshotStorage, key: string) {
  if (storage instanceof Map) storage.delete(key);
  else storage.removeItem(key);
}

export function readDocumentWorkspaceSnapshot(
  scopeKey: string,
  storage: DocumentWorkspaceSnapshotStorage,
  shouldRestore: boolean,
): DocumentWorkspaceSnapshot | null {
  if (!shouldRestore) return null;
  const raw = getValue(storage, getDocumentWorkspaceStorageKey(scopeKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DocumentWorkspaceSnapshot>;
    if (!Array.isArray(parsed.expandedDirectoryIds) || parsed.expandedDirectoryIds.some((id) => typeof id !== "string")) return null;
    if (!DOCUMENT_WORKSPACE_MODE_VALUES.includes(parsed.mode as DocumentWorkspaceMode)) return null;
    return { expandedDirectoryIds: parsed.expandedDirectoryIds, mode: parsed.mode as DocumentWorkspaceMode };
  } catch {
    return null;
  }
}

export function writeDocumentWorkspaceSnapshot(
  scopeKey: string,
  snapshot: Partial<DocumentWorkspaceSnapshot>,
  storage: DocumentWorkspaceSnapshotStorage = window.sessionStorage,
) {
  const key = getDocumentWorkspaceStorageKey(scopeKey);
  const current = readDocumentWorkspaceSnapshot(scopeKey, storage, true) ?? { expandedDirectoryIds: [], mode: "view" as const };
  const next = {
    expandedDirectoryIds: snapshot.expandedDirectoryIds ?? current.expandedDirectoryIds,
    mode: snapshot.mode ?? current.mode,
  };
  setValue(storage, key, JSON.stringify(next));
}

export function clearDocumentWorkspaceSnapshot(scopeKey: string, storage: DocumentWorkspaceSnapshotStorage = window.sessionStorage) {
  removeValue(storage, getDocumentWorkspaceStorageKey(scopeKey));
}

interface DocumentWorkspaceNavigation {
  targetPathname: string;
  sourceScopeKey?: string;
}

export function writeDocumentWorkspaceNavigation(
  scopeKey: string,
  targetPathname: string,
  storage: DocumentWorkspaceSnapshotStorage = window.sessionStorage,
) {
  setValue(storage, getDocumentWorkspaceNavigationStorageKey(scopeKey), JSON.stringify({
    targetPathname,
    sourceScopeKey: scopeKey,
  } satisfies DocumentWorkspaceNavigation));
}

export function clearDocumentWorkspaceNavigation(
  scopeKey: string,
  storage: DocumentWorkspaceSnapshotStorage = window.sessionStorage,
) {
  removeValue(storage, getDocumentWorkspaceNavigationStorageKey(scopeKey));
}

function readDocumentWorkspaceNavigation(scopeKey: string, storage: DocumentWorkspaceSnapshotStorage) {
  const raw = getValue(storage, getDocumentWorkspaceNavigationStorageKey(scopeKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DocumentWorkspaceNavigation;
    if (typeof parsed.targetPathname !== "string") {
      clearDocumentWorkspaceNavigation(scopeKey, storage);
      return null;
    }
    return parsed;
  } catch {
    clearDocumentWorkspaceNavigation(scopeKey, storage);
    return null;
  }
}

export function shouldRestoreDocumentWorkspaceNavigation(
  scopeKey: string,
  currentPathname: string,
  storage: DocumentWorkspaceSnapshotStorage,
) {
  const navigation = readDocumentWorkspaceNavigation(scopeKey, storage);
  if (!navigation) return false;
  if (navigation.targetPathname !== currentPathname) {
    clearDocumentWorkspaceNavigation(scopeKey, storage);
    return false;
  }
  return true;
}

export function hasPendingDocumentWorkspaceNavigation(
  sourceScopeKey: string,
  storage: DocumentWorkspaceSnapshotStorage = window.sessionStorage,
) {
  if (readDocumentWorkspaceNavigation(sourceScopeKey, storage)) return true;
  const prefix = "humanthread:document-workspace:web:";
  if (storage instanceof Map) {
    for (const key of storage.keys()) {
      if (!key.startsWith(prefix) || !key.endsWith(":navigation")) continue;
      const targetScopeKey = key.slice(prefix.length, -":navigation".length);
      if (readDocumentWorkspaceNavigation(targetScopeKey, storage)?.sourceScopeKey === sourceScopeKey) return true;
    }
    return false;
  }
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix) || !key.endsWith(":navigation")) continue;
    const targetScopeKey = key.slice(prefix.length, -":navigation".length);
    if (readDocumentWorkspaceNavigation(targetScopeKey, storage)?.sourceScopeKey === sourceScopeKey) return true;
  }
  return false;
}

export function handoffDocumentWorkspaceNavigation(
  sourceScopeKey: string,
  targetScopeKey: string,
  targetPathname: string,
  storage: DocumentWorkspaceSnapshotStorage = window.sessionStorage,
) {
  const snapshot = readDocumentWorkspaceSnapshot(sourceScopeKey, storage, true);
  if (snapshot) writeDocumentWorkspaceSnapshot(targetScopeKey, snapshot, storage);
  else clearDocumentWorkspaceSnapshot(targetScopeKey, storage);
  setValue(storage, getDocumentWorkspaceNavigationStorageKey(targetScopeKey), JSON.stringify({
    targetPathname,
    sourceScopeKey,
  } satisfies DocumentWorkspaceNavigation));
}

export function clearDocumentWorkspaceSnapshots(scopePrefix: string, storage: DocumentWorkspaceSnapshotStorage = window.sessionStorage) {
  const prefix = getDocumentWorkspaceStorageKey(scopePrefix);
  if (storage instanceof Map) {
    for (const key of storage.keys()) if (key.startsWith(prefix)) storage.delete(key);
    return;
  }
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) storage.removeItem(key);
  }
}

export function shouldRestoreDocumentWorkspace(navigationType: string, initialPathname: string, currentPathname: string) {
  return navigationType === "reload" && initialPathname === currentPathname;
}

export function getDocumentWorkspaceNavigationType() {
  if (typeof window === "undefined") return "navigate";
  const entry = window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type ?? "navigate";
}

let initialNavigationLocation: string | null = null;

function getDocumentWorkspaceNavigationLocation() {
  return `${window.location.pathname}${window.location.search}`;
}

export function shouldRestoreCurrentDocumentWorkspace(scopeKey?: string) {
  if (typeof window === "undefined") return false;
  initialNavigationLocation ??= getDocumentWorkspaceNavigationLocation();
  return shouldRestoreDocumentWorkspace(
    getDocumentWorkspaceNavigationType(),
    initialNavigationLocation,
    getDocumentWorkspaceNavigationLocation(),
  ) || (scopeKey
    ? shouldRestoreDocumentWorkspaceNavigation(scopeKey, window.location.pathname, window.sessionStorage)
    : false);
}
