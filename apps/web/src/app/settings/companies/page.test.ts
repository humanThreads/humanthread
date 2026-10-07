import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: { userId: "user_owner", teamId: "team_1" },
      loginEmail: "alice@example.com",
      account: { name: "Alice", email: "alice@example.com", status: "active", avatarUrl: null, avatarUpdatedAt: null, isSiteAdmin: false },
    },
  }),
}));

vi.mock("../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: { id: "user_owner", name: "Alice", email: "alice@example.com", avatarUrl: null, status: "active" },
    companies: [
      { id: "company_2", name: "Beta", logoUrl: null, role: "owner", canManage: true },
      { id: "company_3", name: "Delivery Lab", logoUrl: null, role: "member", canManage: false },
    ],
    isSiteAdmin: false,
  }),
}));

vi.mock("../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_personal" },
  ]),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import CompanySettingsPage, { dynamic } from "./page";

describe("Company settings page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("lists every company with its role and an explicit management route", async () => {
    const markup = renderToStaticMarkup(await CompanySettingsPage({}));

    expect(markup).toContain("Beta");
    expect(markup).toContain("owner");
    expect(markup).toContain("Delivery Lab");
    expect(markup).toContain("member");
    expect(markup).toContain("/companies/company_2");
    expect(markup).toContain("/companies/company_3");
    expect(markup).not.toContain("公司认证");
    expect(markup).not.toContain("成员上限");
  });

  it("uses an explicit member route when opened as a company chooser", async () => {
    const markup = renderToStaticMarkup(
      await CompanySettingsPage({ searchParams: Promise.resolve({ intent: "members" }) }),
    );

    expect(markup).toContain("/companies/company_2/members");
    expect(markup).toContain("/companies/company_3/members");
    expect(markup).not.toContain("当前公司");
  });
});
