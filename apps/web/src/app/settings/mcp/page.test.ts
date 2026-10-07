import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: { userId: "user_1", teamId: "team_1" },
      loginEmail: "alice@example.com",
      account: { name: "Alice", email: "alice@example.com", status: "active", avatarUrl: null, avatarUpdatedAt: null, isSiteAdmin: false },
    },
  }),
}));

vi.mock("../../../lib/workbench/workbench-settings", () => ({
  listWorkbenchMcpCredentials: vi.fn().mockResolvedValue([
    { id: "mcp_1", name: "Codex", status: "active", lastUsedAt: null, createdAt: new Date("2026-07-26T00:00:00.000Z"), revokedAt: null },
  ]),
}));

vi.mock("../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: { id: "user_1", name: "Alice", email: "alice@example.com", avatarUrl: null, status: "active" },
    companies: [],
    isSiteAdmin: false,
  }),
}));

vi.mock("../../../lib/workbench/workbench-site-settings", () => ({
  getWorkbenchSiteSettings: vi.fn().mockResolvedValue({ siteBaseUrl: "https://ht.example.com", mcpUrl: "https://ht.example.com/api/mcp" }),
}));

vi.mock("../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_personal" },
  ]),
}));
import { dynamic, MCP_CONFIG_SNIPPET_LINES } from "./page";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { listWorkbenchMcpCredentials } from "../../../lib/workbench/workbench-settings";
import { getWorkbenchSiteSettings } from "../../../lib/workbench/workbench-site-settings";
import McpSettingsPage from "./page";

describe("MCP settings page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the authenticated workbench session and MCP credential query", () => {
    expect(typeof requireWorkbenchSession).toBe("function");
    expect(typeof listWorkbenchMcpCredentials).toBe("function");
    expect(typeof getWorkbenchSiteSettings).toBe("function");
  });

  it("keeps MCP config snippet lines stable", () => {
    expect(MCP_CONFIG_SNIPPET_LINES).toEqual([
      "server: humanthread",
      "transport: http",
      "auth: bearer",
    ]);
  });

  it("keeps the MCP URL outside the static snippet lines", () => {
    expect(MCP_CONFIG_SNIPPET_LINES).not.toContain(
      "url: http://localhost:3000/api/mcp",
    );
  });

  it("states personal ownership and removes unrelated project navigation", async () => {
    const markup = renderToStaticMarkup(await McpSettingsPage());

    expect(markup).toContain("归当前个人账号所有");
    expect(markup).toContain("Codex");
    expect(markup).not.toContain("项目工作台");
  });
});
