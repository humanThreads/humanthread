import { describe, expect, it, vi } from "vitest";
import {
  calculateLoopOutboxRecordByteSize,
  type LoopOutboxRecord,
} from "../lib/loop-outbox";
import {
  buildLoopOutboxStorePath,
  createNativeLoopOutboxStore,
  type PersistentLoopOutboxStore,
} from "./loop-outbox-store";

class FakePersistentStore implements PersistentLoopOutboxStore {
  readonly save = vi.fn().mockResolvedValue(undefined);

  constructor(private readonly values: Map<string, unknown>) {}

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

class FailingPersistentStore extends FakePersistentStore {
  override readonly save = vi.fn().mockRejectedValue(new Error("disk unavailable"));
}

function createRecord(overrides: Partial<Omit<LoopOutboxRecord, "byteSize">> = {}): LoopOutboxRecord {
  const input = {
    id: "result_1",
    assignmentId: "assignment_b",
    leaseGeneration: 2,
    sequence: 2,
    priority: "critical" as const,
    kind: "terminal_result" as const,
    payload: { status: "completed" },
    createdAt: "2026-07-30T08:00:00.000Z",
    ...overrides,
  };
  return { ...input, byteSize: calculateLoopOutboxRecordByteSize(input) };
}

describe("native Loop outbox store", () => {
  it("keeps terminal results across restart and removes only acknowledged records", async () => {
    const values = new Map<string, unknown>();
    const firstStore = new FakePersistentStore(values);
    const terminalResult = createRecord();
    const event = createRecord({
      id: "event_1",
      sequence: 1,
      priority: "activity",
      kind: "event",
    });
    const first = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => firstStore,
    });
    await first.enqueue(terminalResult);
    await first.enqueue(event);

    const restarted = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    });
    expect(await restarted.list(100)).toEqual([event, terminalResult]);

    await restarted.acknowledge([terminalResult.id]);

    expect(await restarted.list(100)).toEqual([event]);
    expect(firstStore.save).toHaveBeenCalledTimes(2);
  });

  it("uses one persistent Store namespace per authenticated device", async () => {
    const openedPaths: string[] = [];
    const stores = new Map<string, Map<string, unknown>>();
    const openStore = async (path: string) => {
      openedPaths.push(path);
      const values = stores.get(path) ?? new Map<string, unknown>();
      stores.set(path, values);
      return new FakePersistentStore(values);
    };
    const first = await createNativeLoopOutboxStore({ deviceId: "device_1", openStore });
    const second = await createNativeLoopOutboxStore({ deviceId: "device_2", openStore });
    await first.enqueue(createRecord());

    expect(await second.list(100)).toEqual([]);
    expect(openedPaths).toEqual([
      buildLoopOutboxStorePath("device_1"),
      buildLoopOutboxStorePath("device_2"),
    ]);
  });

  it("lists records by assignment and then sequence", async () => {
    const store = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(new Map()),
    });
    const records = [
      createRecord({ id: "b2", assignmentId: "assignment_b", sequence: 2 }),
      createRecord({ id: "a2", assignmentId: "assignment_a", sequence: 2 }),
      createRecord({ id: "a1", assignmentId: "assignment_a", sequence: 1 }),
    ];
    for (const record of records) await store.enqueue(record);

    expect((await store.list(100)).map((record) => record.id)).toEqual(["a1", "a2", "b2"]);
  });

  it("persists route records but rejects a continuation token in an offline record", async () => {
    const persistentStore = new FakePersistentStore(new Map());
    const store = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => persistentStore,
    });
    const route = createRecord({
      id: "route_1",
      kind: "route_decision",
      payload: { routeDecision: { decisionId: "decision_1", nextNodeId: "develop" } },
    });
    await store.enqueue(route);

    await expect(store.enqueue(createRecord({
      id: "offline_1",
      kind: "offline_stage_result",
      payload: { grant: { token: "must-not-persist" } },
    }))).rejects.toMatchObject({ code: "credential_persistence_denied" });
    expect(await store.list(100)).toEqual([route]);
  });

  it.each(["accessToken", "apiToken", "deviceToken", "refresh_token", "cookie", "password"])(
    "rejects credential-shaped payload key %s before persistence",
    async (key) => {
    const persistentStore = new FakePersistentStore(new Map());
    const store = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => persistentStore,
    });
      const unsafe = createRecord({ payload: { [key]: "raw-secret" } });

      await expect(store.enqueue(unsafe)).rejects.toMatchObject({
        code: "credential_persistence_denied",
      });
      expect(persistentStore.save).not.toHaveBeenCalled();
    },
  );

  it("rejects non-JSON payloads with a stable record error", async () => {
    const persistentStore = new FakePersistentStore(new Map());
    const store = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => persistentStore,
    });
    const unsafe = { ...createRecord(), payload: { value: 1n } };

    await expect(store.enqueue(unsafe)).rejects.toMatchObject({
      code: "invalid_outbox_record",
    });
    expect(persistentStore.save).not.toHaveBeenCalled();
  });

  it("does not publish an enqueued record in memory when persistence fails", async () => {
    const store = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => new FailingPersistentStore(new Map()),
    });

    await expect(store.enqueue(createRecord())).rejects.toThrow("disk unavailable");

    expect(await store.list(100)).toEqual([]);
  });

  it("retains acknowledged records in memory when persistence fails", async () => {
    const values = new Map<string, unknown>();
    const initial = new FakePersistentStore(values);
    const terminalResult = createRecord();
    const first = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => initial,
    });
    await first.enqueue(terminalResult);
    const restarted = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => new FailingPersistentStore(values),
    });

    await expect(restarted.acknowledge([terminalResult.id])).rejects.toThrow("disk unavailable");

    expect(await restarted.list(100)).toEqual([terminalResult]);
  });

  it("ignores a persisted snapshot with duplicate record identities", async () => {
    const duplicate = createRecord();
    const values = new Map<string, unknown>([["loop-outbox:v1", {
      schemaVersion: 1,
      records: [duplicate, duplicate],
    }]]);

    const store = await createNativeLoopOutboxStore({
      deviceId: "device_1",
      openStore: async () => new FakePersistentStore(values),
    });

    expect(await store.list(100)).toEqual([]);
  });

});
