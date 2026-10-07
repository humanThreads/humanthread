import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { companyDetails } = vi.hoisted(() => ({ companyDetails: vi.fn() }));

vi.mock("../../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: { context: { userId: "user_1", teamId: "team_1" }, loginEmail: "alice@example.com", account: { name: "Alice", email: "alice@example.com", status: "active", avatarUrl: null, avatarUpdatedAt: null, isSiteAdmin: false } },
  }),
}));

vi.mock("../../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: { id: "user_1", name: "Alice", email: "alice@example.com", avatarUrl: null, status: "active" },
    companies: [{ id: "company_1", name: "HumanThread", logoUrl: null, role: "owner", canManage: true }],
    isSiteAdmin: false,
  }),
  getWorkbenchCompanySettingsDetails: companyDetails,
}));

vi.mock("../../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([{ key: "company_1", label: "HumanThread", companyId: "company_1", ownerType: "company", spaceId: "space_company" }]),
}));

import CompanyIntegrationsPage from "./page";

function managerDetails() {
  return {
    context: {
      company: { id: "company_1", name: "HumanThread", slug: "humanthread", logoUrl: null, status: "active" },
      membership: { role: "owner", canManageProfile: true, canManageMembers: true, canManageIntegrations: true, canTransferOwnership: true },
    },
    profile: { description: null, certificationLevel: "normal" },
    members: [],
    integration: { emailHost: "smtp.example.com", emailPort: 465, emailUsername: "noreply@example.com", hasPassword: true, emailPassword: "stored-secret" },
  };
}

describe("company integrations page", () => {
  beforeEach(() => companyDetails.mockResolvedValue(managerDetails()));

  it("renders manager SMTP settings without exposing a stored password", async () => {
    const markup = renderToStaticMarkup(await CompanyIntegrationsPage({ params: Promise.resolve({ companyId: "company_1" }) }));

    expect(markup).toContain("邮件集成");
    expect(markup).toContain("smtp.example.com");
    expect(markup).toContain("留空保留现有密码");
    expect(markup).not.toContain("stored-secret");
  });

  it("does not render integration controls for an ordinary member", async () => {
    const { integration, ...details } = managerDetails();
    expect(integration).toBeDefined();
    companyDetails.mockResolvedValue({
      ...details,
      context: {
        ...details.context,
        membership: { role: "member", canManageProfile: false, canManageMembers: false, canManageIntegrations: false, canTransferOwnership: false },
      },
    });

    const markup = renderToStaticMarkup(await CompanyIntegrationsPage({ params: Promise.resolve({ companyId: "company_1" }) }));
    expect(markup).toContain("无权管理公司集成");
    expect(markup).not.toContain("服务器地址");
  });
});
