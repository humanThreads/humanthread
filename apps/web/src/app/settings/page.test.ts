import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: { userId: "user_owner", teamId: "team_1" },
      loginEmail: "alice@example.com",
      account: {
        name: "Alice",
        email: "alice@example.com",
        status: "active",
        avatarUrl: null,
        avatarUpdatedAt: null,
        isSiteAdmin: true,
        lastSeenAt: null,
      },
    },
  }),
}));

vi.mock("../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: {
      id: "user_owner",
      name: "Alice",
      email: "alice@example.com",
      avatarUrl: null,
      status: "active",
    },
    companies: [
      {
        id: "company_1",
        name: "HumanThread",
        logoUrl: null,
        role: "owner",
        canManage: true,
      },
    ],
    isSiteAdmin: true,
  }),
}));

vi.mock("../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_personal" },
  ]),
}));

import SettingsOverviewPage from "./page";

describe("settings overview page", () => {
  it("renders real personal, company and authorized platform destinations", async () => {
    const markup = renderToStaticMarkup(await SettingsOverviewPage());

    expect(markup).toContain("个人设置");
    expect(markup).toContain("HumanThread");
    expect(markup).toContain("owner");
    expect(markup).toContain("平台设置");
    expect(markup).not.toContain("通知偏好");
    expect(markup).not.toContain("SSO");
  });
});
