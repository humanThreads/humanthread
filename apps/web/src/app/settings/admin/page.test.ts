import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: {
        userId: "user_admin",
        teamId: "team_1",
      },
      loginEmail: "alice@example.com",
      account: {
        name: "alice",
        email: "alice@example.com",
        status: "active",
        isSiteAdmin: true,
        avatarUrl: null,
        avatarUpdatedAt: null,
        lastSeenAt: null,
      },
    },
    cookieStore: {
      get: vi.fn().mockReturnValue(undefined),
    },
  }),
}));

vi.mock("../../../lib/workbench/workbench-site-settings", () => ({
  getWorkbenchSiteSettings: vi.fn().mockResolvedValue({
    siteBaseUrl: "http://localhost:3000",
    mcpUrl: "http://localhost:3000/api/mcp",
  }),
}));

vi.mock("@humanthread/db", () => ({
  listWorkerImageCatalog: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../lib/storage/storage-settings", () => ({
  getStorageSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_personal" },
  ]),
}));

vi.mock("../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: { id: "user_admin", name: "alice", email: "alice@example.com", avatarUrl: null, status: "active" },
    companies: [],
    isSiteAdmin: true,
  }),
}));

import * as pageModule from "./page";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSiteSettings } from "../../../lib/workbench/workbench-site-settings";

describe("Admin settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forces dynamic rendering", () => {
    expect(pageModule.dynamic).toBe("force-dynamic");
  });

  it("requires an authenticated site administrator and site settings", () => {
    expect(typeof requireWorkbenchSession).toBe("function");
    expect(typeof getWorkbenchSiteSettings).toBe("function");
  });

  it("renders the site domain configuration form", async () => {
    const markup = renderToStaticMarkup(await pageModule.default());

    expect(markup).toContain("平台设置");
    expect(markup).toContain("站点域名");
    expect(markup).toContain("http://localhost:3000");
    expect(markup).toContain('name="siteBaseUrl"');
    expect(markup).not.toContain("?site=");
  });

  it("renders only the selected settings tab", async () => {
    const storageMarkup = renderToStaticMarkup(await pageModule.default({ searchParams: Promise.resolve({ tab: "storage" }) }));
    const imageMarkup = renderToStaticMarkup(await pageModule.default({ searchParams: Promise.resolve({ tab: "worker-images" }) }));

    expect(storageMarkup).toContain("文件存储");
    expect(storageMarkup).not.toContain('name="siteBaseUrl"');
    expect(imageMarkup).toContain("平台 Worker 镜像目录");
    expect(imageMarkup).not.toContain('aria-label="本地存储路径"');
  });
});
