import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));
vi.mock("@humanthread/db", () => ({
  revokeWorkerPool: vi.fn(),
}));
vi.mock("@/lib/orchestration/worker-resource-scope", () => ({
  resolveWorkerManagementScope: vi.fn(),
}));

describe("DELETE /api/worker-pools/:poolId", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveWorkbenchApiActor } = await import("@/lib/workbench/workbench-api-session");
    const { resolveWorkerManagementScope } = await import("@/lib/orchestration/worker-resource-scope");
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_owner" } as never);
    vi.mocked(resolveWorkerManagementScope).mockResolvedValue({
      scope: { ownerType: "personal", ownerUserId: "user_owner", companyId: null },
    } as never);
  });

  it("revokes a pool in the actor's resolved scope", async () => {
    const { revokeWorkerPool } = await import("@humanthread/db");
    const response = await DELETE(new Request("http://localhost/api/worker-pools/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), {
      params: Promise.resolve({ poolId: "a".repeat(32) }),
    });

    expect(response.status).toBe(200);
    expect(revokeWorkerPool).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "a".repeat(32), actorUserId: "user_owner",
      scope: { ownerType: "personal", ownerUserId: "user_owner", companyId: null },
    }));
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
