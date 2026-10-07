import { describe, expect, it, vi } from "vitest";
import { derivedPersistenceId } from "@humanthread/db";

import {
  ensureLoopAttemptLiveSession,
  resolveLoopLiveSessionOwner,
  type LoopLiveSessionDependencies,
} from "./loop-live-session";

const now = new Date("2026-09-30T04:00:00.000Z");
const attemptId = "loop_attempt_owner_1";
const leaseGeneration = 3;
const sessionId = derivedPersistenceId(["loop-live-session", attemptId, String(leaseGeneration)]);

function attemptRecord(overrides: {
  createdByUserId?: string | null;
  assigneeUserId?: string | null;
  createdById?: string;
} = {}) {
  return {
    id: attemptId,
    attempt: 1,
    loopNodeRunId: "node_run_1",
    loopNodeRun: {
      loopRunId: "loop_run_1",
      loopRun: {
        id: "loop_run_1",
        projectId: "project_1",
        taskId: "task_1",
        bindingSnapshot: overrides.createdByUserId === undefined
          ? { createdByUserId: "user_binding" }
          : { createdByUserId: overrides.createdByUserId },
        task: {
          id: "task_1",
          spaceId: "space_1",
          projectId: "project_1",
          assigneeUserId: overrides.assigneeUserId === undefined ? "user_assignee" : overrides.assigneeUserId,
          createdById: overrides.createdById ?? "user_creator",
        },
      },
    },
  };
}

function dependencies(overrides: Partial<LoopLiveSessionDependencies> = {}): LoopLiveSessionDependencies {
  return {
    loadAttempt: vi.fn().mockResolvedValue(attemptRecord()),
    loadProjectSpaceId: vi.fn().mockResolvedValue("space_1"),
    findSession: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockImplementation(async (record) => ({
      ...record,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })),
    updateSession: vi.fn().mockResolvedValue(null),
    createId: (parts) => derivedPersistenceId(parts),
    createTicket: vi.fn().mockReturnValue({
      token: "lst1.execution.ticket",
      expiresAt: new Date(now.getTime() + 60_000),
    }),
    now: () => now,
    ...overrides,
  } as LoopLiveSessionDependencies;
}

describe("resolveLoopLiveSessionOwner", () => {
  it("prefers the run binding creator over the task assignee and creator", () => {
    expect(resolveLoopLiveSessionOwner(attemptRecord())).toBe("user_binding");
  });

  it("falls back to the task assignee when the run has no binding creator", () => {
    expect(resolveLoopLiveSessionOwner(attemptRecord({ createdByUserId: null }))).toBe("user_assignee");
  });

  it("falls back to the task creator when there is no binding creator or assignee", () => {
    expect(resolveLoopLiveSessionOwner(attemptRecord({
      createdByUserId: null,
      assigneeUserId: null,
    }))).toBe("user_creator");
  });

  it("returns null when no owner can be resolved", () => {
    expect(resolveLoopLiveSessionOwner({
      id: "attempt_1",
      attempt: 1,
      loopNodeRunId: "node_run_1",
      loopNodeRun: {
        loopRunId: "loop_run_1",
        loopRun: {
          id: "loop_run_1",
          projectId: null,
          taskId: null,
          bindingSnapshot: { createdByUserId: "   " },
          task: null,
        },
      },
    })).toBeNull();
  });
});

describe("ensureLoopAttemptLiveSession", () => {
  it("creates one attempt-bound phase and TUI session with the resolved owner", async () => {
    const deps = dependencies();

    const result = await ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps);

    expect("session" in result).toBe(true);
    if (!("session" in result)) throw new Error("expected session");
    expect(result.session).toMatchObject({
      id: sessionId,
      kind: "worker",
      surface: "web",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "loop",
      status: "starting",
      businessRun: { type: "loop_run", id: "loop_run_1" },
      loopAttempt: {
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: attemptId,
        attemptNo: 1,
        leaseGeneration,
      },
    });
    expect(result.session.target).toEqual({
      type: "worker_pool",
      workerPoolId: "a".repeat(32),
      displayName: "Linux Worker Pool",
    });
    expect(result.executionTicket.token).toBe("lst1.execution.ticket");
    expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({
      id: sessionId,
      ownerUserId: "user_binding",
      autoCreated: true,
      streamMode: "phase_and_tui",
      loopNodeAttemptId: attemptId,
      leaseGeneration,
    }));
  });

  it("does not leak prompt, command or credential fields in the session view", async () => {
    const deps = dependencies();
    const result = await ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps);
    if (!("session" in result)) throw new Error("expected session");

    expect(Object.keys(result.session).sort()).toEqual([
      "businessRun",
      "controlState",
      "createdAt",
      "executionPolicy",
      "id",
      "journal",
      "kind",
      "loopAttempt",
      "projectId",
      "spaceId",
      "status",
      "surface",
      "target",
      "targetDisplayName",
      "taskId",
      "updatedAt",
    ]);
  });

  it("reuses the existing attempt session on a repeated claim", async () => {
    const deps = dependencies();
    await ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps);
    const created = vi.mocked(deps.createSession).mock.calls[0]![0];
    vi.mocked(deps.findSession).mockResolvedValue({ ...created, status: "running" });

    const second = await ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps);

    if (!("session" in second)) throw new Error("expected session");
    expect(second.session.id).toBe(sessionId);
    expect(second.session.status).toBe("running");
    expect(deps.createSession).toHaveBeenCalledOnce();
  });

  it("creates a different session for a new lease generation", async () => {
    const deps = dependencies();
    await ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps);
    await ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration: leaseGeneration + 1,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps);

    const ids = vi.mocked(deps.createSession).mock.calls.map(([record]) => record.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("returns a stable unavailable code when no owner can be resolved", async () => {
    const deps = dependencies({
      loadAttempt: vi.fn().mockResolvedValue(attemptRecord({
        createdByUserId: null,
        assigneeUserId: null,
        createdById: "   ",
      })),
    });

    await expect(ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps)).resolves.toEqual({ unavailableCode: "live_stream_owner_unavailable" });
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  it("returns a session conflict without throwing when the attempt identity is stale", async () => {
    const deps = dependencies({
      loadAttempt: vi.fn().mockResolvedValue(null),
    });

    await expect(ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps)).resolves.toEqual({ unavailableCode: "live_stream_session_conflict" });
  });

  it("reports a conflict when the deterministic session id belongs to another attempt", async () => {
    const deps = dependencies({
      findSession: vi.fn().mockResolvedValue({ id: sessionId, loopNodeAttemptId: "other_attempt" }),
    });

    await expect(ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps)).resolves.toEqual({ unavailableCode: "live_stream_session_conflict" });
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  it("resolves the project space for a Loop run that has no task", async () => {
    const attempt = attemptRecord();
    const withoutTask = {
      ...attempt,
      loopNodeRun: {
        ...attempt.loopNodeRun,
        loopRun: {
          ...attempt.loopNodeRun.loopRun,
          taskId: null,
          task: null,
        },
      },
    };
    const deps = dependencies({
      loadAttempt: vi.fn().mockResolvedValue(withoutTask),
      loadProjectSpaceId: vi.fn().mockResolvedValue("space_from_project"),
    });

    const result = await ensureLoopAttemptLiveSession({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: attemptId,
      attemptNo: 1,
      leaseGeneration,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now,
    }, deps);

    if (!("session" in result)) throw new Error("expected session");
    expect(result.session.spaceId).toBe("space_from_project");
    expect(result.session.taskId).toBeNull();
  });
});
