import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn(async () => ({ session: { context: { userId: "user_admin" }, account: null, loginEmail: "admin@example.com" } })),
}));
vi.mock("../../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn(async () => ({ user: { id: "user_admin", name: "Admin", email: null, avatarUrl: null, status: "active" }, companies: [], isSiteAdmin: false })),
  getWorkbenchCompanySettingsDetails: vi.fn(async () => ({
    context: {
      company: { id: "company_1", name: "HumanThread", slug: "humanthread", logoUrl: null, status: "active" },
      membership: { role: "admin", canManageProfile: true, canManageMembers: true, canManageIntegrations: true, canTransferOwnership: false },
    },
  })),
}));
vi.mock("../../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn(async () => [{ key: "company_1", label: "HumanThread", companyId: "company_1", ownerType: "company" }]),
}));
vi.mock("../../../../lib/workbench/workbench-space-filters", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../lib/workbench/workbench-space-filters")>(),
  getWorkbenchSelectedSpaceFilter: vi.fn(() => ({ key: "company_1", label: "HumanThread", companyId: "company_1", ownerType: "company" })),
}));
vi.mock("@humanthread/db", () => ({
  listWorkerImageCatalog: vi.fn(async () => [{
    id: "a".repeat(32),
    ownerType: "company",
    companyId: "company_1",
    name: "公司专属 Worker",
    repository: "registry.example.com/company-worker",
    status: "active",
    versions: [],
  }]),
}));

import CompanyWorkerImageSettingsPage from "./page";

describe("公司 Worker 镜像设置页", () => {
  beforeEach(() => vi.clearAllMocks());

  it("只读取并展示当前公司的镜像目录", async () => {
    const { listWorkerImageCatalog } = await import("@humanthread/db");
    const markup = renderToStaticMarkup(await CompanyWorkerImageSettingsPage({ params: Promise.resolve({ companyId: "company_1" }) }));

    expect(listWorkerImageCatalog).toHaveBeenCalledWith({ scope: { ownerType: "company", companyId: "company_1" } });
    expect(markup).toContain("公司专属 Worker");
    expect(markup).toContain("这些镜像仅对当前公司的项目可见");
  });
});
