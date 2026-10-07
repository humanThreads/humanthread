import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@humanthread/db", () => ({
  authenticateWorkerPoolSession: mocks.authenticate,
  prisma: { liveSession: { findFirst: mocks.findFirst } },
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("https://0.0.0.0:3000/api/worker-pools/live-sessions/dddddddddddddddddddddddddddddddd", {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ sessionId: "d".repeat(32) }) };

describe("worker pool live session liveness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
      instanceId: "worker-1",
    });
    mocks.findFirst.mockResolvedValue({ id: "d".repeat(32) });
  });

  it("reports a session as active when the pool owns it", async () => {
    const response = await POST(request({ poolId: "a".repeat(32) }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toEqual({ active: true });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "d".repeat(32),
        targetWorkerPoolId: "a".repeat(32),
        status: { in: ["starting", "running", "detached"] },
      }),
    }));
  });

  it("fails with live_session_not_found once the session is gone or expired", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await POST(request({ poolId: "a".repeat(32) }), context);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.errorCode).toBe("live_session_not_found");
  });

  it("rejects a request without a pool session", async () => {
    const response = await POST(new Request(
      "https://0.0.0.0:3000/api/worker-pools/live-sessions/dddddddddddddddddddddddddddddddd",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ poolId: "a".repeat(32) }) },
    ), context);

    expect(response.status).toBe(401);
  });
});
