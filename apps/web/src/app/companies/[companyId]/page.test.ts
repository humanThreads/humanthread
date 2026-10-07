import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { companyDetails } = vi.hoisted(() => ({
  companyDetails: vi.fn(),
}));

vi.mock("../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: { userId: "user_1", teamId: "team_1" },
      loginEmail: "alice@example.com",
      account: { name: "Alice", email: "alice@example.com", status: "active", avatarUrl: null, avatarUpdatedAt: null, isSiteAdmin: false },
    },
  }),
}));

vi.mock("../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: { id: "user_1", name: "Alice", email: "alice@example.com", avatarUrl: null, status: "active" },
    companies: [{ id: "company_1", name: "HumanThread", logoUrl: null, role: "member", canManage: false }],
    isSiteAdmin: false,
  }),
  getWorkbenchCompanySettingsDetails: companyDetails,
}));

vi.mock("../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_personal" },
  ]),
}));

import CompanyPage, { dynamic } from "./page";

function details(role: "owner" | "admin" | "member" | "viewer") {
  const canManage = role === "owner" || role === "admin";
  return {
    context: {
      company: { id: "company_1", name: "HumanThread", slug: "humanthread", logoUrl: null, status: "active" },
      membership: {
        role,
        canManageProfile: canManage,
        canManageMembers: canManage,
        canManageIntegrations: canManage,
        canTransferOwnership: role === "owner",
      },
    },
    profile: { description: "HumanThread 工作台", certificationLevel: "normal" },
    members: [],
    ...(canManage ? { integration: { emailHost: "smtp.example.com", emailPort: 465, emailUsername: "noreply@example.com", hasPassword: true } } : {}),
  };
}

describe("company management page", () => {
  beforeEach(() => {
    companyDetails.mockResolvedValue(details("member"));
  });

  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("renders a read-only company profile for an ordinary member", async () => {
    const markup = renderToStaticMarkup(await CompanyPage({ params: Promise.resolve({ companyId: "company_1" }) }));

    expect(markup).toContain("HumanThread");
    expect(markup).toContain("当前角色：member");
    expect(markup).toContain("HumanThread 工作台");
    expect(markup).toContain("只读");
    expect(markup).not.toContain("保存公司资料");
    expect(markup).not.toContain("邮箱服务器");
    expect(markup).not.toContain("smtp.example.com");
  });

  it("renders profile editing for an owner without rendering SMTP fields", async () => {
    companyDetails.mockResolvedValue(details("owner"));

    const markup = renderToStaticMarkup(await CompanyPage({ params: Promise.resolve({ companyId: "company_1" }) }));

    expect(markup).toContain('name="description"');
    expect(markup).toContain("上传 logo");
    expect(markup).toContain("/companies/company_1/integrations");
    expect(markup).not.toContain("邮箱服务器");
    expect(markup).not.toContain("SMTP 密码");
    expect(markup).not.toContain("smtp.example.com");
  });
});
