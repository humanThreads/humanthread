import { createWorkbenchContextIdentity } from "@humanthread/workbench-client";
import { describe, expect, it } from "vitest";

import {
  buildSnapshotStorageKey,
  createMemorySnapshotStore,
} from "./offline-snapshot-store";

const contextA = createWorkbenchContextIdentity({
  deploymentUrl: "https://ht-a.example.com",
  sessionId: "desktop_session_1",
  spaceKey: "company:company_1",
});
const contextB = createWorkbenchContextIdentity({
  deploymentUrl: "https://ht-b.example.com",
  sessionId: "desktop_session_2",
  spaceKey: "personal",
});
const taskSummary = {
  ok: true as const,
  data: {
    collection: {
      listRows: [],
      boardGroups: [],
      calendar: { entries: [], unscheduled: [] },
      relationCounts: {},
      total: 0,
    },
  },
};

describe("memory offline snapshot store", () => {
  it("isolates snapshots by deployment, session and Space context", async () => {
    const snapshots = createMemorySnapshotStore({
      now: () => new Date("2026-07-27T08:00:00.000Z"),
    });

    await snapshots.write(contextA, "tasks", taskSummary);

    await expect(snapshots.read(contextA, "tasks")).resolves.toMatchObject({
      payload: taskSummary,
      writtenAt: "2026-07-27T08:00:00.000Z",
    });
    await expect(snapshots.read(contextB, "tasks")).resolves.toBeNull();
    expect(buildSnapshotStorageKey(contextA, "tasks"))
      .not.toBe(buildSnapshotStorageKey(contextB, "tasks"));
  });

  it("does not share snapshots with a new process store", async () => {
    const currentProcess = createMemorySnapshotStore();
    await currentProcess.write(contextA, "tasks", taskSummary);

    const restartedProcess = createMemorySnapshotStore();

    await expect(currentProcess.read(contextA, "tasks")).resolves.not.toBeNull();
    await expect(restartedProcess.read(contextA, "tasks")).resolves.toBeNull();
  });

  it("strips future response fields before caching the allowlisted DTO", async () => {
    const snapshots = createMemorySnapshotStore();

    await snapshots.write(contextA, "tasks", {
      ...taskSummary,
      futureEnvelopeField: "ignored",
      data: {
        ...taskSummary.data,
        futureDataField: "ignored",
        collection: {
          ...taskSummary.data.collection,
          futureCollectionField: "ignored",
        },
      },
    });

    await expect(snapshots.read(contextA, "tasks")).resolves.toMatchObject({
      payload: taskSummary,
    });
  });

  it("rejects document bodies because only tree metadata is allowlisted", async () => {
    const snapshots = createMemorySnapshotStore();

    await expect(snapshots.write(contextA, "documents", {
      ok: true,
      data: { body: "secret document content" },
    })).rejects.toThrow("Snapshot payload is not allowlisted");
  });

  it("removes expired snapshots instead of returning stale data", async () => {
    let now = new Date("2026-07-27T08:00:00.000Z");
    const snapshots = createMemorySnapshotStore({
      ttlMs: 60_000,
      now: () => now,
    });
    await snapshots.write(contextA, "tasks", taskSummary);

    now = new Date("2026-07-27T08:01:00.000Z");

    await expect(snapshots.read(contextA, "tasks")).resolves.toBeNull();
  });

  it("evicts the oldest snapshot when the process limit is reached", async () => {
    let now = new Date("2026-07-27T08:00:00.000Z");
    const first = createWorkbenchContextIdentity({
      deploymentUrl: "https://ht.example.com",
      sessionId: "desktop_session_1",
      spaceKey: "personal",
    });
    const second = createWorkbenchContextIdentity({
      deploymentUrl: "https://ht.example.com",
      sessionId: "desktop_session_2",
      spaceKey: "personal",
    });
    const snapshots = createMemorySnapshotStore({
      maxEntryBytes: 10_000,
      maxTotalBytes: 450,
      now: () => now,
    });
    await snapshots.write(first, "tasks", taskSummary);
    now = new Date("2026-07-27T08:01:00.000Z");
    await snapshots.write(second, "tasks", taskSummary);

    await expect(snapshots.read(first, "tasks")).resolves.toBeNull();
    await expect(snapshots.read(second, "tasks")).resolves.not.toBeNull();
  });
});
