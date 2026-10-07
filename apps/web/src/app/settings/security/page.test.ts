import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: { userId: "user_owner", teamId: "team_1" },
      loginEmail: "alice@example.com",
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      account: {
        name: "Alice",
        email: "alice@example.com",
        status: "active",
        avatarUrl: null,
        avatarUpdatedAt: null,
        isSiteAdmin: false,
        lastSeenAt: null,
      },
    },
  }),
}));

vi.mock("../../../lib/workbench/web-session-store", () => ({
  listActiveWebSessions: vi.fn().mockResolvedValue([{
    id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    deviceName: "macOS",
    browserName: "Chrome",
    operatingSystem: "macOS",
    createdAt: new Date("2026-08-10T08:00:00.000Z"),
    lastSeenAt: new Date("2026-08-12T08:00:00.000Z"),
    expiresAt: new Date("2026-09-09T08:00:00.000Z"),
  }]),
}));

vi.mock("../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: {
      id: "user_owner",
      name: "Alice",
      email: "alice@example.com",
      avatarUrl: null,
      status: "active",
    },
    companies: [],
    isSiteAdmin: false,
  }),
}));

vi.mock("../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_personal" },
  ]),
}));

import SecuritySettingsPage from "./page";

describe("security settings page", () => {
  it("renders password editing as a dedicated personal route", async () => {
    const markup = renderToStaticMarkup(await SecuritySettingsPage());

    expect(markup).toContain("安全设置");
    expect(markup).toContain("当前密码");
    expect(markup).toContain("新密码");
    expect(markup).toContain("确认新密码");
    expect(markup).toContain("登录设备");
    expect(markup).toContain("当前设备");
  });
});
