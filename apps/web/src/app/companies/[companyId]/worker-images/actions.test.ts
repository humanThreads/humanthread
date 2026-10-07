import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn(async () => ({ session: { context: { userId: "user_company_admin" } } })),
}));
vi.mock("../../../../lib/orchestration/worker-resource-scope", () => ({
  resolveWorkerManagementScope: vi.fn(async () => ({
    scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
    companyRole: "admin",
  })),
}));
vi.mock("@humanthread/db", () => ({
  createWorkerImageSource: vi.fn(async () => ({ id: "a".repeat(32) })),
  createWorkerImageVersion: vi.fn(async () => ({ id: "b".repeat(32) })),
  setWorkerImageVersionStatus: vi.fn(async () => ({ id: "b".repeat(32), status: "disabled" })),
}));

import { updateCompanyWorkerImageCatalogAction } from "./actions";

describe("公司 Worker 镜像目录动作", () => {
  beforeEach(() => vi.clearAllMocks());

  it("仅以当前公司作用域创建镜像来源", async () => {
    const { createWorkerImageSource } = await import("@humanthread/db");
    const { resolveWorkerManagementScope } = await import("../../../../lib/orchestration/worker-resource-scope");

    await expect(updateCompanyWorkerImageCatalogAction("company_1", {
      kind: "source",
      name: "公司专属 Worker",
      repository: "registry.example.com/company-worker",
    })).resolves.toEqual({ ok: true });

    expect(resolveWorkerManagementScope).toHaveBeenCalledWith({ userId: "user_company_admin", companyId: "company_1" });
    expect(createWorkerImageSource).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_company_admin",
      scope: expect.objectContaining({ ownerType: "company", companyId: "company_1" }),
      name: "公司专属 Worker",
    }));
  });

  it("只以当前公司作用域启用或禁用镜像版本", async () => {
    const { setWorkerImageVersionStatus } = await import("@humanthread/db");

    await expect(updateCompanyWorkerImageCatalogAction("company_1", {
      kind: "version-status",
      versionId: "b".repeat(32),
      status: "disabled",
    })).resolves.toEqual({ ok: true });

    expect(setWorkerImageVersionStatus).toHaveBeenCalledWith(expect.objectContaining({
      versionId: "b".repeat(32),
      status: "disabled",
      scope: { ownerType: "company", companyId: "company_1" },
    }));
  });
});
