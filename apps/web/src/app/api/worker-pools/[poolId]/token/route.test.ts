import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-auth", () => ({
  verifyPasswordHash: vi.fn(),
}));

vi.mock("@humanthread/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
  revealWorkerPoolToken: vi.fn(),
  rotateWorkerPoolToken: vi.fn(),
}));

const context = { params: Promise.resolve({ poolId: "a".repeat(32) }) };

function request(body: unknown) {
  return new Request("http://localhost/api/worker-pools/pool/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/worker-pools/:poolId/token", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveWorkbenchApiActor } = await import("@/lib/workbench/workbench-api-session");
    const { prisma, revealWorkerPoolToken, rotateWorkerPoolToken } = await import("@humanthread/db");
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user_1", status: "active", passwordHash: "hash" } as never);
    vi.mocked(revealWorkerPoolToken).mockResolvedValue({ bootstrapToken: "htwp_revealed" } as never);
    vi.mocked(rotateWorkerPoolToken).mockResolvedValue({ bootstrapToken: "htwp_rotated", tokenVersion: 2 } as never);
  });

  it("requires the signed-in user's current password before revealing a token", async () => {
    const { verifyPasswordHash } = await import("@/lib/workbench/workbench-auth");
    const { revealWorkerPoolToken } = await import("@humanthread/db");
    vi.mocked(verifyPasswordHash).mockReturnValue(true);

    const response = await POST(request({ action: "reveal", password: "correct-password" }), context);

    expect(response.status).toBe(200);
    expect(verifyPasswordHash).toHaveBeenCalledWith({ password: "correct-password", passwordHash: "hash" });
    expect(revealWorkerPoolToken).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "a".repeat(32), actorUserId: "user_1", reauthenticated: true,
      scope: { ownerType: "personal", ownerUserId: "user_1", companyId: null },
    }));
    await expect(response.json()).resolves.toEqual({ bootstrapToken: "htwp_revealed" });
  });

  it("rejects an incorrect password without revealing or rotating a token", async () => {
    const { verifyPasswordHash } = await import("@/lib/workbench/workbench-auth");
    const { revealWorkerPoolToken, rotateWorkerPoolToken } = await import("@humanthread/db");
    vi.mocked(verifyPasswordHash).mockReturnValue(false);

    const response = await POST(request({ action: "rotate", password: "wrong-password" }), context);

    expect(response.status).toBe(401);
    expect(revealWorkerPoolToken).not.toHaveBeenCalled();
    expect(rotateWorkerPoolToken).not.toHaveBeenCalled();
  });
});
