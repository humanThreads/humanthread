import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCanReadProject: vi.fn(),
  loopNodeAttemptFindFirst: vi.fn(),
  liveSessionFindFirst: vi.fn(),
}));

vi.mock("../../../../../packages/db/src/index", () => ({
  assertCanReadProject: mocks.assertCanReadProject,
  prisma: {
    loopNodeAttempt: { findFirst: mocks.loopNodeAttemptFindFirst },
    liveSession: { findFirst: mocks.liveSessionFindFirst },
  },
}));

import { readLoopAttemptLiveStream } from "./loop-attempt-live-stream";

const attemptId = "loop_attempt:d4cb9b94e1ec1b817a0238c738fda4e004029ba0838f88768feaa4bbc18af6a7";
const loopRunId = "loop_run:37ceaa86ce91424608df37488ebbbeb78cbb73fd19f8f9376255638b54abf05e";
const sessionId = "ca7da3e6444bdf5a517c426cd2512e10";
const now = new Date("2026-10-03T14:20:00.000Z");

/**
 * The Loop page used to send the human-facing attempt number (1, 2, 3 …) as
 * the attempt identifier. The persisted attempt key never equals that number,
 * so the panel reported "no live session" while the session was healthy. These
 * tests pin the resolution to the persisted primary key.
 */
function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: attemptId,
    status: "running",
    loopNodeRun: {
      loopRun: {
        id: loopRunId,
        projectId: "project_1",
        taskId: "task_1",
        bindingSnapshot: { createdByUserId: "user_1" },
        task: { assigneeUserId: "user_1", createdById: "user_1" },
      },
    },
    ...overrides,
  };
}

function sessionRow() {
  return {
    id: sessionId,
    kind: "worker",
    surface: "web",
    spaceId: "space_1",
    projectId: "project_1",
    taskId: "task_1",
    executionPolicy: "loop",
    targetType: "worker_pool",
    targetDeviceId: null,
    targetWorkerPoolId: "84b4eb2ca9891afebfb4c8f8b250a2ac",
    targetDisplayName: "default-pool",
    businessRunType: "loop_run",
    businessRunId: loopRunId,
    status: "running",
    controlState: "detached",
    journalStatus: "ready",
    journalRetentionDays: 7,
    firstSequence: 0,
    lastSequence: 0,
    loopNodeRunId: "loop-node:1",
    loopNodeAttemptId: attemptId,
    leaseGeneration: 1,
    streamMode: "phase_and_tui",
    createdAt: new Date("2026-10-03T14:16:46.525Z"),
    updatedAt: new Date("2026-10-03T14:16:46.677Z"),
  };
}

describe("readLoopAttemptLiveStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanReadProject.mockResolvedValue({ projectId: "project_1", role: "viewer" });
  });

  it("resolves the attempt by its persisted primary key", async () => {
    mocks.loopNodeAttemptFindFirst
      .mockResolvedValueOnce(attemptRow())
      .mockResolvedValueOnce({
        attempt: 1,
        executionPhase: "git.fetch",
        executionPhaseStatus: "running",
        executionPhaseStartedAt: new Date("2026-10-03T14:16:50.000Z"),
        executionPhaseFinishedAt: null,
        executionPhaseCode: null,
        executionPhaseSummary: "正在同步远端引用",
        executionPhaseUpdatedAt: new Date("2026-10-03T14:16:50.000Z"),
      });
    mocks.liveSessionFindFirst.mockResolvedValue(sessionRow());

    const result = await readLoopAttemptLiveStream({ userId: "user_1", loopRunId, attemptId, now });

    expect(mocks.loopNodeAttemptFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: attemptId, loopNodeRun: { loopRunId } },
    }));
    expect("unavailableCode" in result).toBe(false);
    expect(result).toMatchObject({
      mode: "phase_and_tui",
      session: { id: sessionId },
      phase: { name: "git.fetch", status: "running" },
    });
  });

  it("returns live_stream_not_available when the given key is an attempt number instead of the primary key", async () => {
    mocks.loopNodeAttemptFindFirst.mockResolvedValue(null);

    await expect(readLoopAttemptLiveStream({ userId: "user_1", loopRunId, attemptId: "1", now }))
      .resolves.toEqual({ unavailableCode: "live_stream_not_available" });
    expect(mocks.liveSessionFindFirst).not.toHaveBeenCalled();
  });

  it("reports a finished attempt without exposing its session", async () => {
    mocks.loopNodeAttemptFindFirst.mockResolvedValue(attemptRow({ status: "succeeded" }));

    await expect(readLoopAttemptLiveStream({ userId: "user_1", loopRunId, attemptId, now }))
      .resolves.toEqual({ unavailableCode: "live_stream_attempt_finished" });
    expect(mocks.liveSessionFindFirst).not.toHaveBeenCalled();
  });
});
