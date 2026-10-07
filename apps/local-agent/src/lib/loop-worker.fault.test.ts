import type { LoopAgentEvent, LoopAssignment } from "@humanthread/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createNativeLoopOutboxStore,
  type PersistentLoopOutboxStore,
} from "../desktop/loop-outbox-store";
import { flushAssignmentOutbox, runLoopAssignment, type LoopAssignmentApi } from "./loop-assignment-runner";
import { executeReservedEffect } from "./loop-effects";
import {
  calculateLoopOutboxRecordByteSize,
  type LoopOutboxRecord,
} from "./loop-outbox";
import type { AgentProviderAdapter, NormalizedRunEvent } from "./providers/provider-adapter";

const assignment: LoopAssignment = {
  id: "assignment_1",
  agentRunId: "agent_run_1",
  loopRunId: "loop_run_1",
  loopNodeRunId: "node_run_1",
  loopNodeAttemptId: "attempt_1",
  attemptNo: 1,
  leaseGeneration: 7,
  leaseExpiresAt: "2026-07-30T12:03:00.000Z",
  acceptedThroughSequence: 0,
  node: {
    key: "work",
    label: "Work",
    type: "agent_action",
    offlinePolicy: "online_required",
    executionTarget: "local",
    promptTemplate: "Complete the work",
    outputSchema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  graph: {
    schemaVersion: 1,
    inputSchema: {},
    outputSchema: {},
    limits: { maxStages: 3, maxRepeatCount: 1 },
    nodes: [
      { key: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
      {
        key: "work",
        label: "Work",
        type: "agent_action",
        offlinePolicy: "online_required",
        executionTarget: "local",
        promptTemplate: "Complete the work",
        outputSchema: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
      },
      { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
    ],
    edges: [
      { id: "start-work", source: "start", target: "work", kind: "normal", outcome: "success" },
      { id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" },
    ],
  },
  inputSnapshot: { task: "Complete the work" },
  policySnapshot: {},
  grantSnapshot: { permission: "workspace_full", networkTargets: [] },
  runtime: { agentProfileId: "profile_codex", provider: "codex", runtimeProfileId: "runtime_1", configurationVersion: 1 },
  workspace: { bindingId: "workspace_1", configurationVersion: 1, pathFingerprint: "hmac-sha256:abcdef" },
  prompt: "Complete the work",
  resultSchemaPath: ".humanthread/loop/results/attempt_1.schema.json",
};

function makeRecord(input: Omit<LoopOutboxRecord, "byteSize">): LoopOutboxRecord {
  return { ...input, byteSize: calculateLoopOutboxRecordByteSize(input) };
}

function createPersistentStore(): PersistentLoopOutboxStore {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key, value) => { values.set(key, value); },
    save: async () => undefined,
  };
}

async function openOutbox(store: PersistentLoopOutboxStore) {
  return createNativeLoopOutboxStore({
    deviceId: "device_1",
    openStore: async () => store,
  });
}

function createApi(overrides: Partial<LoopAssignmentApi> = {}): LoopAssignmentApi {
  return {
    claim: vi.fn().mockResolvedValue({ assignment: null, leaseGeneration: null, leaseExpiresAt: null }),
    heartbeat: vi.fn().mockResolvedValue({ leaseExpiresAt: "2026-07-30T12:04:00.000Z" }),
    events: vi.fn().mockResolvedValue({ acceptedThroughSequence: 99 }),
    checkpoint: vi.fn().mockResolvedValue({ checkpointed: true }),
    complete: vi.fn().mockResolvedValue({ completed: true }),
    ...overrides,
  };
}

function providerWith(events: NormalizedRunEvent[]): AgentProviderAdapter {
  const iterable = () => (async function* () {
    for (const event of events) yield event;
  })();
  return {
    capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
    executeStructured: vi.fn(iterable),
    start: vi.fn(iterable),
    resume: vi.fn(iterable),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Loop worker recovery faults", () => {
  it("replays an event after disconnect-before-ack without duplicating the platform fact", async () => {
    const store = createPersistentStore();
    const outbox = await openOutbox(store);
    const event: LoopAgentEvent = {
      eventId: "event:attempt_1:1",
      loopRunId: assignment.loopRunId,
      loopNodeRunId: assignment.loopNodeRunId,
      loopNodeAttemptId: assignment.loopNodeAttemptId,
      attemptNo: assignment.attemptNo,
      leaseGeneration: assignment.leaseGeneration,
      sequence: 1,
      eventType: "run.started",
      occurredAt: "2026-07-30T12:00:00.000Z",
      payloadSummary: { providerSessionId: "thread_1" },
      artifactRefs: [],
    };
    await outbox.enqueue(makeRecord({
      id: event.eventId,
      assignmentId: assignment.agentRunId,
      leaseGeneration: assignment.leaseGeneration,
      sequence: 3,
      priority: "activity",
      kind: "event",
      payload: event,
      createdAt: event.occurredAt,
    }));
    const committedEvents = new Set<string>();
    let disconnectBeforeAck = true;
    const events = vi.fn(async (input: Parameters<LoopAssignmentApi["events"]>[0]) => {
      input.events.forEach(({ eventId }) => committedEvents.add(eventId));
      if (disconnectBeforeAck) {
        disconnectBeforeAck = false;
        throw new TypeError("connection closed before response");
      }
      return { acceptedThroughSequence: 1 };
    });
    const api = createApi({ events });

    await expect(flushAssignmentOutbox(outbox, api)).resolves.toEqual({
      staleAssignmentIds: [],
      online: false,
    });
    expect(await outbox.list(100)).toHaveLength(1);

    const restartedOutbox = await openOutbox(store);
    await expect(flushAssignmentOutbox(restartedOutbox, api)).resolves.toEqual({
      staleAssignmentIds: [],
      online: true,
    });

    expect(events).toHaveBeenCalledTimes(2);
    expect(committedEvents).toEqual(new Set([event.eventId]));
    expect(await restartedOutbox.list(100)).toEqual([]);
  });

  it("flushes a terminal result after process restart without rerunning the Provider", async () => {
    const store = createPersistentStore();
    const outbox = await openOutbox(store);
    const provider = providerWith([{ type: "run.completed", result: { summary: "done" } }]);
    const offlineApi = createApi({
      complete: vi.fn().mockRejectedValue(new TypeError("network offline")),
    });

    await runLoopAssignment(assignment, {
      api: offlineApi,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "files", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: async () => "/work/project",
      writeResultSchema: async () => "/work/project/result.schema.json",
      startHeartbeat: () => () => undefined,
    });

    expect((await outbox.list(100)).map(({ kind }) => kind)).toEqual(["terminal_result"]);
    const committedCommands = new Set<string>();
    const complete = vi.fn(async (input: Parameters<LoopAssignmentApi["complete"]>[0]) => {
      committedCommands.add(input.commandId);
      return { completed: true };
    });
    const restartedOutbox = await openOutbox(store);

    await expect(flushAssignmentOutbox(restartedOutbox, createApi({ complete }))).resolves.toEqual({
      staleAssignmentIds: [],
      online: true,
    });

    expect(provider.start).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    expect(committedCommands).toEqual(new Set(["result:attempt_1"]));
    expect(await restartedOutbox.list(100)).toEqual([]);
  });

  it("discards an outbox record when its leased AgentRun no longer exists", async () => {
    const store = createPersistentStore();
    const outbox = await openOutbox(store);
    await outbox.enqueue(makeRecord({
      id: "result:missing_attempt",
      assignmentId: "agent_run_missing",
      leaseGeneration: 1,
      sequence: 1,
      priority: "critical",
      kind: "terminal_result",
      payload: {
        agentRunId: "agent_run_missing",
        leaseGeneration: 1,
        loopRunId: "loop_run_old",
        loopNodeRunId: "node_run_old",
        loopNodeAttemptId: "attempt_old",
        attemptNo: 1,
        result: { outcome: "failure", output: {}, artifactRefs: [], effectReceipts: [] },
      },
      createdAt: "2026-07-30T12:00:00.000Z",
    }));

    const api = createApi({
      complete: vi.fn().mockRejectedValue(Object.assign(new Error("AgentRun not found"), {
        code: "not_found",
        status: 404,
      })),
    });

    await expect(flushAssignmentOutbox(outbox, api)).resolves.toEqual({
      staleAssignmentIds: ["agent_run_missing"],
      online: true,
    });
    expect(await outbox.list(100)).toEqual([]);
  });

  it("persists reconciliation after disconnect-after-dispatch and never dispatches it again", async () => {
    const store = createPersistentStore();
    const outbox = await openOutbox(store);
    const dispatchedEffects = new Set<string>();
    const dispatch = vi.fn(async (request: Record<string, unknown>) => {
      dispatchedEffects.add(String(request.idempotencyKey));
      throw Object.assign(new Error("connection dropped after request write"), {
        dispatchState: "possibly_dispatched",
      });
    });
    const recordReceipt = vi.fn(async (receipt: {
      effectKey: string;
      status: "succeeded" | "failed" | "reconciliation_required";
      providerReceipt?: unknown;
    }) => {
      await outbox.enqueue(makeRecord({
        id: `effect-receipt:${receipt.effectKey}`,
        assignmentId: assignment.agentRunId,
        leaseGeneration: assignment.leaseGeneration,
        sequence: 4,
        priority: "critical",
        kind: "effect_receipt",
        payload: receipt,
        createdAt: "2026-07-30T12:00:00.000Z",
      }));
      return receipt;
    });
    const reservation = {
      effectKey: "effect:key_1",
      status: "prepared" as const,
      providerIdempotencyKey: "provider:key_1",
      execute: true,
      request: { to: "user@example.com" },
    };

    await expect(executeReservedEffect(reservation, { dispatch, recordReceipt }))
      .rejects.toMatchObject({ code: "reconciliation_required" });

    const restartedOutbox = await openOutbox(store);
    const durableReceipts = await restartedOutbox.list(100);
    expect(durableReceipts).toHaveLength(1);
    expect(durableReceipts[0]).toMatchObject({
      kind: "effect_receipt",
      payload: { effectKey: "effect:key_1", status: "reconciliation_required" },
    });

    await expect(executeReservedEffect({
      ...reservation,
      status: "reconciliation_required",
      execute: false,
    }, { dispatch, recordReceipt })).resolves.toMatchObject({
      status: "reconciliation_required",
      execute: false,
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatchedEffects).toEqual(new Set(["provider:key_1"]));
    expect(recordReceipt).toHaveBeenCalledOnce();
  });
});
