import { describe, expect, it, vi } from "vitest";

import {
  acknowledgeWorkerValidationChallenge,
  claimWorkerValidationChallenge,
  createOrReuseWorkerValidationChallenge,
  type WorkerValidationChallengeDependencies,
} from "./worker-validation-challenges";

const NOW = new Date("2026-09-17T10:00:00.000Z");
const PROJECT_ID = "project_1";
const POOL_ID = "a".repeat(32);
const SESSION_ID = "b".repeat(32);

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const tx = {
    workerValidationChallenge: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].find((row) => (
        Object.entries(where).every(([key, value]) => {
          if (key === "expiresAt") return row.expiresAt instanceof Date && (value as { gt: Date }).gt < row.expiresAt;
          return row[key] === value;
        })
      )) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.set(String(data.id), { ...data }); return data; }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = rows.get(String(where.id));
        if (!row || !Object.entries(where).every(([key, value]) => row[key] === value)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
  return {
    rows,
    tx,
    dependencies: {
      db: { $transaction: async (callback: (inner: typeof tx) => Promise<unknown>) => callback(tx) },
      createId: () => "c".repeat(32),
    } satisfies WorkerValidationChallengeDependencies,
  };
}

describe("Worker validation challenge repository", () => {
  it("只创建独立 challenge，不创建 Task、LoopRun 或 AgentRun", async () => {
    const state = fixture();

    const challenge = await createOrReuseWorkerValidationChallenge({
      projectId: PROJECT_ID,
      poolId: POOL_ID,
      sessionId: SESSION_ID,
      environmentConfigurationVersion: 7,
      now: NOW,
      expiresAt: new Date("2026-09-17T10:05:00.000Z"),
    }, state.dependencies);

    expect(challenge).toMatchObject({
      id: "c".repeat(32), projectId: PROJECT_ID, poolId: POOL_ID, sessionId: SESSION_ID,
      environmentConfigurationVersion: 7, status: "pending",
    });
    expect(challenge.id).toMatch(/^[a-f0-9]{32}$/u);
    expect(Object.keys(state.tx)).toEqual(["workerValidationChallenge"]);
    expect(JSON.stringify(state.rows)).not.toContain("agentRunId");
    expect(JSON.stringify(state.rows)).not.toContain("loopRunId");
    expect(JSON.stringify(state.rows)).not.toContain("taskId");
  });

  it("只允许目标活跃会话领取，并且确认后记录为完成", async () => {
    const state = fixture();
    await createOrReuseWorkerValidationChallenge({
      projectId: PROJECT_ID, poolId: POOL_ID, sessionId: SESSION_ID, environmentConfigurationVersion: 7,
      now: NOW, expiresAt: new Date("2026-09-17T10:05:00.000Z"),
    }, state.dependencies);

    await expect(claimWorkerValidationChallenge({ poolId: POOL_ID, sessionId: "d".repeat(32), now: NOW }, state.dependencies)).resolves.toBeNull();
    const claimed = await claimWorkerValidationChallenge({ poolId: POOL_ID, sessionId: SESSION_ID, now: NOW }, state.dependencies);
    expect(claimed).toMatchObject({ id: "c".repeat(32), kind: "worker_validation", sideEffect: false });

    await expect(acknowledgeWorkerValidationChallenge({
      challengeId: "c".repeat(32), poolId: POOL_ID, sessionId: SESSION_ID, now: new Date("2026-09-17T10:01:00.000Z"),
    }, state.dependencies)).resolves.toMatchObject({ completed: true, sideEffect: false });
    expect(state.rows.get("c".repeat(32))).toMatchObject({ status: "completed", acknowledgedAt: new Date("2026-09-17T10:01:00.000Z") });
  });

  it("不会领取已过期 challenge", async () => {
    const state = fixture();
    await createOrReuseWorkerValidationChallenge({
      projectId: PROJECT_ID, poolId: POOL_ID, sessionId: SESSION_ID, environmentConfigurationVersion: 7,
      now: NOW, expiresAt: new Date("2026-09-17T10:01:00.000Z"),
    }, state.dependencies);
    await expect(claimWorkerValidationChallenge({ poolId: POOL_ID, sessionId: SESSION_ID, now: new Date("2026-09-17T10:02:00.000Z") }, state.dependencies)).resolves.toBeNull();
  });
});
