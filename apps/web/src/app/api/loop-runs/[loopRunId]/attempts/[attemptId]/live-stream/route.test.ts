import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  readAttemptLiveStream: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.actor,
}));

vi.mock("@/lib/live-session/loop-attempt-live-stream", () => ({
  readLoopAttemptLiveStream: mocks.readAttemptLiveStream,
}));

import { GET } from "./route";

describe("GET /api/loop-runs/[loopRunId]/attempts/[attemptId]/live-stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ userId: "user_1" });
  });

  it("returns the attempt phase and viewer session for the owner", async () => {
    mocks.readAttemptLiveStream.mockResolvedValue({
      mode: "phase_and_tui",
      session: { id: "a".repeat(32) },
      phase: { phase: "git.fetch", status: "running" },
    });

    const response = await GET(new Request("http://localhost/api/loop-runs/loop_run_1/attempts/attempt_1/live-stream"), {
      params: Promise.resolve({ loopRunId: "loop_run_1", attemptId: "attempt_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { mode: "phase_and_tui", phase: { phase: "git.fetch" } },
    });
    expect(mocks.readAttemptLiveStream).toHaveBeenCalledWith({
      userId: "user_1",
      loopRunId: "loop_run_1",
      attemptId: "attempt_1",
    });
  });

  it("returns a stable unavailable code without leaking session existence", async () => {
    mocks.readAttemptLiveStream.mockResolvedValue({ unavailableCode: "live_stream_owner_unavailable" });

    const response = await GET(new Request("http://localhost/api/loop-runs/loop_run_1/attempts/attempt_1/live-stream"), {
      params: Promise.resolve({ loopRunId: "loop_run_1", attemptId: "attempt_1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errorCode: "live_stream_owner_unavailable",
    });
  });

  it("decodes an encoded attempt id before resolving the live session", async () => {
    mocks.readAttemptLiveStream.mockResolvedValue({ unavailableCode: "live_stream_not_available" });

    await GET(new Request("http://localhost/api/loop-runs/loop_run_1/attempts/live-stream"), {
      params: Promise.resolve({
        loopRunId: "loop_run%3A37ceaa86",
        attemptId: "loop_attempt%3Ad4cb9b94",
      }),
    });

    expect(mocks.readAttemptLiveStream).toHaveBeenCalledWith({
      userId: "user_1",
      loopRunId: "loop_run:37ceaa86",
      attemptId: "loop_attempt:d4cb9b94",
    });
  });

  it("rejects an unauthenticated request before reading a session", async () => {
    mocks.actor.mockRejectedValue(Object.assign(new Error("unauthorized"), { code: "unauthorized" }));

    const response = await GET(new Request("http://localhost/api/loop-runs/loop_run_1/attempts/attempt_1/live-stream"), {
      params: Promise.resolve({ loopRunId: "loop_run_1", attemptId: "attempt_1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.readAttemptLiveStream).not.toHaveBeenCalled();
  });
});
