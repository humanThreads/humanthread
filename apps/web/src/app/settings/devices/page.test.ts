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

vi.mock("../../../lib/workbench/workbench-overview", () => ({
  getWorkbenchOverview: vi.fn().mockResolvedValue({ devices: [] }),
}));

vi.mock("../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: { id: "user_1", name: "Alice", email: "alice@example.com", avatarUrl: null, status: "active" },
    companies: [],
    isSiteAdmin: false,
  }),
}));

vi.mock("../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_personal" },
  ]),
}));
import { dynamic, SETTINGS_DEVICES_ACTIONS } from "./page";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchOverview } from "../../../lib/workbench/workbench-overview";
import DeviceSettingsPage from "./page";

describe("Device settings page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the authenticated workbench session and overview query", () => {
    expect(typeof requireWorkbenchSession).toBe("function");
    expect(typeof getWorkbenchOverview).toBe("function");
  });

  it("keeps device actions stable", () => {
    expect(SETTINGS_DEVICES_ACTIONS).toEqual([
      "授权设备",
      "撤销授权",
    ]);
  });

  it("renders Agent devices as settings owned by the current personal account", async () => {
    const markup = renderToStaticMarkup(await DeviceSettingsPage());

    expect(markup).toContain("归当前个人账号所有");
    expect(markup).toContain("Agent 设备");
    expect(markup).toContain('href="/settings/devices"');
  });
});
