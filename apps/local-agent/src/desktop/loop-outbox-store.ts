import { getNativeBridge } from "../lib/native-bridge";

import {
  calculateLoopOutboxRecordByteSize,
  calculateOutboxCapacity,
  LOOP_OUTBOX_LIMITS,
  type LoopOutbox,
  type LoopOutboxRecord,
} from "../lib/loop-outbox";

const OUTBOX_STATE_KEY = "loop-outbox:v1";
const OUTBOX_SCHEMA_VERSION = 1;
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "credential",
  "password",
  "secret",
  "token",
]);

type PersistedLoopOutbox = {
  schemaVersion: number;
  records: LoopOutboxRecord[];
};

export interface PersistentLoopOutboxStore {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

function containsSensitiveMaterial(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsSensitiveMaterial(item, seen));
  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
    return SENSITIVE_KEYS.has(normalizedKey)
      || normalizedKey.endsWith("token")
      || containsSensitiveMaterial(nested, seen);
  });
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || ancestors.has(value)) return false;
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, nextAncestors));
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every((nested) => isJsonValue(nested, nextAncestors));
}

function isLoopOutboxRecord(value: unknown): value is LoopOutboxRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LoopOutboxRecord>;
  const parsedCreatedAt = typeof record.createdAt === "string"
    ? Date.parse(record.createdAt)
    : Number.NaN;
  return typeof record.id === "string" && record.id.length > 0
    && typeof record.assignmentId === "string" && record.assignmentId.length > 0
    && Number.isInteger(record.leaseGeneration) && (record.leaseGeneration ?? 0) > 0
    && Number.isInteger(record.sequence) && (record.sequence ?? 0) >= 0
    && (record.priority === "activity" || record.priority === "critical")
    && ["event", "checkpoint", "terminal_result", "effect_receipt", "route_decision", "offline_stage_result"].includes(record.kind ?? "")
    && typeof record.byteSize === "number" && Number.isInteger(record.byteSize) && record.byteSize > 0
    && Number.isFinite(parsedCreatedAt)
    && "payload" in record
    && isJsonValue(record.payload)
    && !containsSensitiveMaterial(record.payload)
    && record.byteSize === calculateLoopOutboxRecordByteSize({
      id: record.id,
      assignmentId: record.assignmentId,
      leaseGeneration: record.leaseGeneration,
      sequence: record.sequence,
      priority: record.priority,
      kind: record.kind,
      payload: record.payload,
      createdAt: record.createdAt,
    } as Omit<LoopOutboxRecord, "byteSize">);
}

function parsePersistedState(value: unknown): LoopOutboxRecord[] {
  if (!value || typeof value !== "object") return [];
  const state = value as Partial<PersistedLoopOutbox>;
  if (
    state.schemaVersion !== OUTBOX_SCHEMA_VERSION
    || !Array.isArray(state.records)
    || !state.records.every(isLoopOutboxRecord)
  ) return [];
  const ids = new Set<string>();
  const sequences = new Set<string>();
  let bytes = 0;
  for (const record of state.records) {
    const sequenceKey = `${record.assignmentId}\0${record.leaseGeneration}\0${record.sequence}`;
    if (ids.has(record.id) || sequences.has(sequenceKey)) return [];
    ids.add(record.id);
    sequences.add(sequenceKey);
    bytes += record.byteSize;
    if (bytes > LOOP_OUTBOX_LIMITS.maxBytes) return [];
  }
  return [...state.records];
}

function compareRecords(left: LoopOutboxRecord, right: LoopOutboxRecord): number {
  return left.assignmentId.localeCompare(right.assignmentId)
    || left.sequence - right.sequence
    || left.id.localeCompare(right.id);
}

export function buildLoopOutboxStorePath(deviceId: string): string {
  const normalized = deviceId.trim();
  if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9_-]+$/u.test(normalized)) {
    throw new Error("Invalid local Agent device ID");
  }
  return `loop-outbox-${normalized}.json`;
}

export async function createNativeLoopOutboxStore(input: {
  deviceId: string;
  openStore?: (path: string) => Promise<PersistentLoopOutboxStore>;
}): Promise<LoopOutbox> {
  const openStore = input.openStore ?? (async (path) => {
    const bridge = getNativeBridge();
    if (!bridge) {
      throw new Error("Loop 离线队列存储仅在桌面客户端中可用。");
    }
    return bridge.loadStore(path);
  });
  const persistentStore = await openStore(buildLoopOutboxStorePath(input.deviceId));
  let records = parsePersistedState(await persistentStore.get(OUTBOX_STATE_KEY));
  let mutationQueue = Promise.resolve();

  async function persist(nextRecords: LoopOutboxRecord[]): Promise<void> {
    await persistentStore.set(OUTBOX_STATE_KEY, {
      schemaVersion: OUTBOX_SCHEMA_VERSION,
      records: nextRecords,
    } satisfies PersistedLoopOutbox);
    await persistentStore.save();
    records = nextRecords;
  }

  function mutate(action: () => Promise<void>): Promise<void> {
    const result = mutationQueue.then(action);
    mutationQueue = result.catch(() => undefined);
    return result;
  }

  return {
    async enqueue(record) {
      return mutate(async () => {
        if (containsSensitiveMaterial(record.payload)) {
          throw Object.assign(new Error("Loop outbox record is not safe to persist"), {
            code: "credential_persistence_denied",
          });
        }
        if (!isLoopOutboxRecord(record)) {
          throw Object.assign(new Error("Loop outbox record is not safe to persist"), {
            code: "invalid_outbox_record",
          });
        }
        const duplicate = records.find((candidate) => candidate.id === record.id);
        if (duplicate) {
          if (JSON.stringify(duplicate) === JSON.stringify(record)) return;
          throw Object.assign(new Error("Loop outbox record ID conflicts with existing content"), {
            code: "outbox_record_conflict",
          });
        }
        const bytes = records.reduce((total, candidate) => total + candidate.byteSize, 0);
        const capacity = calculateOutboxCapacity({
          records: records.length,
          bytes,
          incomingBytes: record.byteSize,
        });
        const critical = record.kind === "terminal_result"
          || record.kind === "effect_receipt"
          || record.kind === "route_decision"
          || record.kind === "offline_stage_result";
        if (critical ? !capacity.canAppendCritical : !capacity.canClaim) {
          throw Object.assign(new Error("Loop outbox capacity is exhausted"), {
            code: "outbox_capacity_exhausted",
            reason: capacity.reason,
          });
        }
        await persist([...records, record]);
      });
    },
    async list(limit) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
        throw new Error("Loop outbox list limit is invalid");
      }
      return [...records].sort(compareRecords).slice(0, limit);
    },
    async pendingAssignmentIds() {
      return [...new Set(records.map(({ assignmentId }) => assignmentId))].sort();
    },
    async acknowledge(ids) {
      return mutate(async () => {
        const acknowledged = new Set(ids);
        const retained = records.filter((record) => !acknowledged.has(record.id));
        if (retained.length === records.length) return;
        await persist(retained);
      });
    },
    async capacity(incomingBytes = 0) {
      return calculateOutboxCapacity({
        records: records.length,
        bytes: records.reduce((total, record) => total + record.byteSize, 0),
        incomingBytes,
      });
    },
  };
}
