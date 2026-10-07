import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  acknowledgeWorkerValidationChallenge: vi.fn(),
  authenticateWorkerPoolSession: vi.fn(),
}));

describe("POST /api/worker-pools/validation-challenges/:challengeId/acknowledge", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authenticateWorkerPoolSession, acknowledgeWorkerValidationChallenge } = await import("@humanthread/db");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValue({ workerPoolId: "a".repeat(32), sessionId: "b".repeat(32) } as never);
    vi.mocked(acknowledgeWorkerValidationChallenge).mockResolvedValue({ completed: true, sideEffect: false } as never);
  });

  it("通过短期会话确认 challenge，不产生业务执行结果", async () => {
    const { acknowledgeWorkerValidationChallenge } = await import("@humanthread/db");
    const response = await POST(new Request("http://localhost/api/worker-pools/validation-challenges/c/acknowledge", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32) }),
    }), { params: Promise.resolve({ challengeId: "c".repeat(32) }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result: { completed: true, sideEffect: false } });
    expect(acknowledgeWorkerValidationChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: "c".repeat(32), poolId: "a".repeat(32), sessionId: "b".repeat(32),
    }));
  });

  it("拒绝未认证的确认请求", async () => {
    const response = await POST(new Request("http://localhost/api/worker-pools/validation-challenges/c/acknowledge", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ poolId: "a".repeat(32) }),
    }), { params: Promise.resolve({ challengeId: "c".repeat(32) }) });
    expect(response.status).toBe(401);
  });
});
