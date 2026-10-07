import { describe, expect, it, vi } from "vitest";

import {
  acknowledgeLoopNotificationProjection,
  createLoopNotificationIntent,
  deriveLoopNotificationLevel,
  listLoopNotificationIntents,
  markLoopNotificationIntentRead,
} from "./loop-notifications";

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const outbox = new Map<string, Record<string, unknown>>();
  const tx = {
    notificationIntent: {
      findUnique: vi.fn(async ({ where }: { where: { dedupeKey: string } }) => rows.get(where.dedupeKey) ?? null),
      findMany: vi.fn(async () => Array.from(rows.values())),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        const row = data[0]!;
        const key = String(row.dedupeKey);
        if (rows.has(key)) return { count: 0 };
        rows.set(key, row);
        return { count: 1 };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; recipientUserId: string }; data: Record<string, unknown> }) => {
        const entry = Array.from(rows.entries()).find(([, row]) => row.id === where.id && row.recipientUserId === where.recipientUserId);
        if (!entry) return { count: 0 };
        rows.set(entry[0], { ...entry[1], ...data });
        return { count: 1 };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; recipientUserId: string } }) =>
        Array.from(rows.values()).find((row) => row.id === where.id && row.recipientUserId === where.recipientUserId) ?? null),
    },
    outboxMessage: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) outbox.set(String(row.id), row);
        return { count: data.length };
      }),
    },
  };
  return {
    tx,
    db: {
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx),
      notificationIntent: tx.notificationIntent,
    },
    rows,
    outbox,
  };
}

const baseInput = {
  projectId: "project_1",
  loopRunId: "run_1",
  loopNodeRunId: "node_approval_1",
  recipientUserId: "user_1",
  eventType: "loop.approval.required",
  title: "等待人工审批",
  description: `请审批运行，令牌 sk-${"x".repeat(32)}`,
  templateData: {
    authorization: "Bearer secret-access-token",
    summary: "仅保留可投递摘要",
  },
  approvalId: "approval_1",
  occurredAt: new Date("2026-07-31T08:02:00.000Z"),
  bindingNotificationPolicy: {
    channelsByLevel: { action_required: ["in_app", "desktop", "email"] },
  },
  userPreferences: { channels: { email: false } },
} as const;

describe("Loop notification intents", () => {
  it.each([
    "workflow_requirement_pending",
    "workflow_mention",
    "workflow_approval_pending",
  ])("classifies %s as action required", (eventType) => {
    expect(deriveLoopNotificationLevel(eventType)).toBe("action_required");
  });

  it("classifies a decided workflow interaction as important", () => {
    expect(deriveLoopNotificationLevel("workflow_interaction_decided")).toBe("important");
  });

  it("idempotently records query-backed channel availability before acknowledging delivery", async () => {
    const row = {
      id: "loop-notification:notice_1",
      status: "pending",
      deliveryState: null,
      channels: ["in_app", "desktop"],
    };
    const updateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, data);
      return { count: 1 };
    });
    const findUnique = vi.fn(async () => row);
    const projectedAt = new Date("2026-08-01T08:00:00.000Z");

    const first = await acknowledgeLoopNotificationProjection({
      notificationId: row.id,
      projectedAt,
    }, { db: { notificationIntent: { findUnique, updateMany } } } as never);
    const replay = await acknowledgeLoopNotificationProjection({
      notificationId: row.id,
      projectedAt,
    }, { db: { notificationIntent: { findUnique, updateMany } } } as never);

    expect(first).toEqual({
      notificationId: row.id,
      status: "available",
      deliveryState: {
        in_app: { status: "available", projectedAt: projectedAt.toISOString() },
        desktop: { status: "available", projectedAt: projectedAt.toISOString() },
      },
    });
    expect(replay).toEqual(first);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge channels without a configured delivery connector", async () => {
    const row = {
      id: "loop-notification:notice_external",
      status: "pending",
      deliveryState: null,
      channels: ["in_app", "email"],
    };
    const updateMany = vi.fn();

    await expect(acknowledgeLoopNotificationProjection({
      notificationId: row.id,
    }, {
      db: {
        notificationIntent: {
          findUnique: vi.fn(async () => row),
          updateMany,
        },
      },
    } as never)).rejects.toThrow("email connector is not configured");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("creates and enqueues one credential-free action-required intent for repeated delivery", async () => {
    const dependencies = fixture();

    const first = await createLoopNotificationIntent(baseInput, dependencies as never);
    const duplicate = await createLoopNotificationIntent(baseInput, dependencies as never);

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      level: "action_required",
      channels: ["in_app", "desktop"],
      approvalId: "approval_1",
    });
    expect(first.description).toContain("[REDACTED]");
    expect(first.description).not.toContain("sk-");
    expect(first.description).toBe("请审批运行，令牌 [REDACTED]");
    expect(first.description.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(first.templateData)).not.toContain("secret-access-token");
    expect(JSON.stringify(Array.from(dependencies.outbox.values()))).not.toContain("secret-access-token");
    expect(dependencies.tx.notificationIntent.createMany).toHaveBeenCalledOnce();
    expect(dependencies.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
    expect(Array.from(dependencies.rows.keys())[0]).toMatch(/^[a-f0-9]{32}$/u);
  });

  it("aggregates the same recipient, Run, node, and event family only within its time window", async () => {
    const dependencies = fixture();

    const first = await createLoopNotificationIntent(baseInput, dependencies as never);
    const nextWindow = await createLoopNotificationIntent({
      ...baseInput,
      occurredAt: new Date("2026-07-31T08:08:00.000Z"),
    }, dependencies as never);

    expect(nextWindow.id).not.toBe(first.id);
    expect(dependencies.tx.notificationIntent.createMany).toHaveBeenCalledTimes(2);
    expect(dependencies.tx.outboxMessage.createMany).toHaveBeenCalledTimes(2);
  });

  it("deduplicates configuration action requests by blocking configuration version across time windows", async () => {
    const dependencies = fixture();
    const dedupeKey = "loop-configuration:node_approval_1:workspace_missing:binding:3|workspace:0";
    const first = await createLoopNotificationIntent({
      ...baseInput,
      eventType: "loop.configuration.required",
      dedupeKey,
    }, dependencies as never);
    const repeatedLater = await createLoopNotificationIntent({
      ...baseInput,
      eventType: "loop.configuration.required",
      occurredAt: new Date("2026-07-31T09:08:00.000Z"),
      dedupeKey,
    }, dependencies as never);

    expect(repeatedLater.id).toBe(first.id);
    expect(first.level).toBe("action_required");
    expect(Array.from(dependencies.rows.keys())[0]).toBe("1562a6d88c22239e0a647a1da3a29db4");
    expect(dependencies.tx.notificationIntent.createMany).toHaveBeenCalledOnce();
    expect(dependencies.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
  });

  it("stores an overlong explicit dedupe key as a 32-character MD5 while preserving idempotency", async () => {
    const dependencies = fixture();
    const dedupeKey = `loop-configuration:${"n".repeat(96)}:profile_not_allowed:configuration:${"d".repeat(64)}`;
    expect(dedupeKey.length).toBeGreaterThan(191);

    const first = await createLoopNotificationIntent({
      ...baseInput,
      eventType: "loop.configuration.required",
      dedupeKey,
    }, dependencies as never);
    const duplicate = await createLoopNotificationIntent({
      ...baseInput,
      eventType: "loop.configuration.required",
      occurredAt: new Date("2026-07-31T09:08:00.000Z"),
      dedupeKey,
    }, dependencies as never);

    const storedDedupeKey = Array.from(dependencies.rows.keys())[0];
    expect(storedDedupeKey).toMatch(/^[a-f0-9]{32}$/u);
    expect(storedDedupeKey).toHaveLength(32);
    expect(duplicate.id).toBe(first.id);
    expect(dependencies.tx.notificationIntent.createMany).toHaveBeenCalledOnce();
    expect(dependencies.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
  });

  it("maps all required event families to durable notification levels", () => {
    expect(deriveLoopNotificationLevel("loop.input.required")).toBe("action_required");
    expect(deriveLoopNotificationLevel("loop.reconciliation.required")).toBe("action_required");
    expect(deriveLoopNotificationLevel("loop.grant.revoked")).toBe("critical");
    expect(deriveLoopNotificationLevel("loop.run.failed")).toBe("critical");
    expect(deriveLoopNotificationLevel("loop.run.exhausted")).toBe("critical");
    expect(deriveLoopNotificationLevel("loop.reconciliation.timed_out")).toBe("critical");
    expect(deriveLoopNotificationLevel("loop.run.completed")).toBe("important");
    expect(deriveLoopNotificationLevel("loop.run.cancelled")).toBe("important");
    expect(deriveLoopNotificationLevel("loop.artifact.important")).toBe("important");
    expect(deriveLoopNotificationLevel("loop.knowledge.published")).toBe("important");
    expect(deriveLoopNotificationLevel("loop.node.retrying")).toBe("activity");
    expect(deriveLoopNotificationLevel("loop.gate.passed")).toBe("activity");
    expect(deriveLoopNotificationLevel("loop.rework.automatic")).toBe("activity");
  });

  it("lists scoped intents and marks only the recipient's intent read", async () => {
    const dependencies = fixture();
    const created = await createLoopNotificationIntent(baseInput, dependencies as never);

    const listed = await listLoopNotificationIntents({
      recipientUserId: "user_1",
      projectIds: ["project_1"],
      limit: 20,
    }, dependencies as never);
    const read = await markLoopNotificationIntentRead({
      notificationId: created.id,
      recipientUserId: "user_1",
      readAt: new Date("2026-07-31T08:10:00.000Z"),
    }, dependencies as never);

    expect(listed).toHaveLength(1);
    expect(read).toMatchObject({ id: created.id, readAt: new Date("2026-07-31T08:10:00.000Z") });
    await expect(markLoopNotificationIntentRead({
      notificationId: created.id,
      recipientUserId: "user_other",
    }, dependencies as never)).rejects.toThrow("Loop notification not found");
  });
});
