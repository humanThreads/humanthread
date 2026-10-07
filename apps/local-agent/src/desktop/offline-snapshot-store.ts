import {
  desktopAgentsResponseSchema,
  desktopDashboardResponseSchema,
  desktopDocumentTreeResponseSchema,
  desktopNotificationsResponseSchema,
  desktopProjectCollectionResponseSchema,
  desktopTaskCollectionResponseSchema,
  parseForwardCompatibleResponse,
  type WorkbenchContextIdentity,
} from "@humanthread/workbench-client";
import type { ZodType } from "zod";

const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRY_BYTES = 256 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024;

export type SnapshotDomain =
  | "dashboard"
  | "tasks"
  | "projects"
  | "documents"
  | "agents"
  | "notifications";

interface SnapshotEnvelope {
  schemaVersion: number;
  contextKey: string;
  domain: SnapshotDomain;
  writtenAt: string;
  expiresAt: string;
  payload: unknown;
}

interface SnapshotIndexEntry {
  key: string;
  bytes: number;
  writtenAt: string;
  expiresAt: string;
}

export interface MemorySnapshotRecord {
  payload: unknown;
  writtenAt: string;
  expiresAt: string;
}

export interface MemorySnapshotStore {
  write(context: WorkbenchContextIdentity, domain: SnapshotDomain, payload: unknown): Promise<void>;
  read(context: WorkbenchContextIdentity, domain: SnapshotDomain): Promise<MemorySnapshotRecord | null>;
  delete(context: WorkbenchContextIdentity, domain: SnapshotDomain): Promise<void>;
  prune(): Promise<void>;
}

const SNAPSHOT_SCHEMAS: Record<SnapshotDomain, ZodType> = {
  dashboard: desktopDashboardResponseSchema,
  tasks: desktopTaskCollectionResponseSchema,
  projects: desktopProjectCollectionResponseSchema,
  documents: desktopDocumentTreeResponseSchema,
  agents: desktopAgentsResponseSchema,
  notifications: desktopNotificationsResponseSchema,
};

function contextKey(context: WorkbenchContextIdentity): string {
  return JSON.stringify([context.deploymentKey, context.sessionId, context.spaceKey]);
}

export function buildSnapshotStorageKey(
  context: WorkbenchContextIdentity,
  domain: SnapshotDomain,
): string {
  return [
    "snapshot:v1",
    encodeURIComponent(context.deploymentKey),
    encodeURIComponent(context.sessionId),
    encodeURIComponent(context.spaceKey),
    domain,
  ].join(":");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isEnvelope(value: unknown): value is SnapshotEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Partial<SnapshotEnvelope>;
  const writtenAt = typeof envelope.writtenAt === "string"
    ? Date.parse(envelope.writtenAt)
    : Number.NaN;
  const expiresAt = typeof envelope.expiresAt === "string"
    ? Date.parse(envelope.expiresAt)
    : Number.NaN;
  return envelope.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    typeof envelope.contextKey === "string" &&
    typeof envelope.domain === "string" &&
    envelope.domain in SNAPSHOT_SCHEMAS &&
    Number.isFinite(writtenAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt > writtenAt &&
    "payload" in envelope;
}

export function createMemorySnapshotStore(input: {
  now?: () => Date;
  ttlMs?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
} = {}): MemorySnapshotStore {
  const now = input.now ?? (() => new Date());
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntryBytes = input.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

  const records = new Map<string, string>();
  let index: SnapshotIndexEntry[] = [];

  function removeRecord(key: string) {
    records.delete(key);
  }

  function loadIndex(): SnapshotIndexEntry[] {
    return [...index];
  }

  function saveIndex(next: SnapshotIndexEntry[]) {
    index = [...next];
  }

  function removeFromIndex(key: string) {
    saveIndex(index.filter((entry) => entry.key !== key));
  }

  const snapshots: MemorySnapshotStore = {
    async write(context, domain, payload) {
      let parsedPayload: unknown;
      try {
        parsedPayload = parseForwardCompatibleResponse(SNAPSHOT_SCHEMAS[domain], payload);
      } catch {
        throw new Error("Snapshot payload is not allowlisted");
      }
      const writtenAt = now();
      const envelope: SnapshotEnvelope = {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        contextKey: contextKey(context),
        domain,
        writtenAt: writtenAt.toISOString(),
        expiresAt: new Date(writtenAt.getTime() + ttlMs).toISOString(),
        payload: parsedPayload,
      };
      const serialized = JSON.stringify(envelope);
      const bytes = byteLength(serialized);
      if (bytes > maxEntryBytes) throw new Error("Snapshot payload exceeds the per-domain limit");
      await snapshots.prune();
      const key = buildSnapshotStorageKey(context, domain);
      const nextIndex = loadIndex().filter((entry) => entry.key !== key);
      let totalBytes = nextIndex.reduce((total, entry) => total + entry.bytes, 0);
      while (nextIndex.length > 0 && totalBytes + bytes > maxTotalBytes) {
        const oldest = nextIndex.shift();
        if (!oldest) break;
        totalBytes -= oldest.bytes;
        removeRecord(oldest.key);
      }
      if (totalBytes + bytes > maxTotalBytes) {
        throw new Error("Snapshot payload exceeds the total storage limit");
      }
      records.set(key, serialized);
      saveIndex([...nextIndex, {
        key,
        bytes,
        writtenAt: envelope.writtenAt,
        expiresAt: envelope.expiresAt,
      }]);
    },
    async read(context, domain) {
      const key = buildSnapshotStorageKey(context, domain);
      const serialized = records.get(key) ?? null;
      if (!serialized) return null;
      try {
        const envelope: unknown = JSON.parse(serialized);
        if (
          !isEnvelope(envelope) ||
          envelope.contextKey !== contextKey(context) ||
          envelope.domain !== domain ||
          new Date(envelope.expiresAt).getTime() <= now().getTime()
        ) {
          throw new Error("Snapshot envelope is invalid");
        }
        const parsedPayload = parseForwardCompatibleResponse(
          SNAPSHOT_SCHEMAS[domain],
          envelope.payload,
        );
        return {
          payload: parsedPayload,
          writtenAt: envelope.writtenAt,
          expiresAt: envelope.expiresAt,
        };
      } catch {
        removeRecord(key);
        removeFromIndex(key);
        return null;
      }
    },
    async delete(context, domain) {
      const key = buildSnapshotStorageKey(context, domain);
      removeRecord(key);
      removeFromIndex(key);
    },
    async prune() {
      const current = now().getTime();
      const currentIndex = loadIndex();
      const retained: SnapshotIndexEntry[] = [];
      for (const entry of currentIndex) {
        if (new Date(entry.expiresAt).getTime() <= current) {
          removeRecord(entry.key);
        } else {
          retained.push(entry);
        }
      }
      if (retained.length !== currentIndex.length) {
        saveIndex(retained);
      }
    },
  };
  return snapshots;
}
