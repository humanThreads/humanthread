import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { transaction } = vi.hoisted(() => ({
  transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
}));

vi.mock("@humanthread/db", () => ({
  deactivateAgentWorker: vi.fn().mockResolvedValue({ invalidated: 2 }),
  prisma: { $transaction: transaction },
}));

vi.mock("../route-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../route-helpers")>();
  return {
    ...actual,
    authenticateLoopAssignmentRequest: vi.fn().mockResolvedValue({
      userId: "user_1",
      teamId: "team_1",
      deviceId: "device_1",
    }),
  };
});

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/loop-assignments/worker-state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/loop-assignments/worker-state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authenticates the device and deactivates its canonical Worker transactionally", async () => {
    const { deactivateAgentWorker } = await import("@humanthread/db");
    const { authenticateLoopAssignmentRequest } = await import("../route-helpers");
    const response = await POST(request({
      userId: "user_1",
      deviceId: "device_1",
      workerId: "local-worker:device_1",
      enabled: false,
    }));

    expect(response.status).toBe(200);
    expect(authenticateLoopAssignmentRequest).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({
      userId: "user_1",
      deviceId: "device_1",
    }));
    expect(transaction).toHaveBeenCalledOnce();
    expect(deactivateAgentWorker).toHaveBeenCalledWith(expect.objectContaining({
      tx: {},
      workerId: "local-worker:device_1",
      deviceId: "device_1",
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { status: "offline", invalidated: 2 },
    });
  });

  it("rejects another device Worker before opening a transaction", async () => {
    const response = await POST(request({
      userId: "user_1",
      deviceId: "device_1",
      workerId: "local-worker:device_2",
      enabled: false,
    }));

    expect(response.status).toBe(409);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed enable requests before authentication", async () => {
    const { authenticateLoopAssignmentRequest } = await import("../route-helpers");
    const response = await POST(request({
      userId: "user_1",
      deviceId: "device_1",
      workerId: "local-worker:device_1",
      enabled: true,
    }));

    expect(response.status).toBe(400);
    expect(authenticateLoopAssignmentRequest).not.toHaveBeenCalled();
  });
});
