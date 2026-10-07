import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { companyDetails } = vi.hoisted(() => ({ companyDetails: vi.fn() }));

vi.mock("../../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: { userId: "user_1", teamId: "team_1" },
      loginEmail: "alice@example.com",
      account: { name: "Alice", email: "alice@example.com", status: "active", avatarUrl: null, avatarUpdatedAt: null, isSiteAdmin: false },
    },
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
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "company_1", label: "HumanThread", companyId: "company_1", ownerType: "company", spaceId: "space_company" },
  ]),
}));

import CompanyMemberPage, { dynamic } from "./page";

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
    members: [{
      id: "company_1:user_member",
      role: "member",
      status: "active",
      user: { id: "user_member", name: "Member", email: "member@example.com", status: "active", lastSeenAt: new Date("2026-05-22T09:00:00.000Z") },
    }],
    ...(canManage ? { integration: { emailHost: null, emailPort: null, emailUsername: null, hasPassword: false } } : {}),
  };
}

describe("company member page", () => {
  beforeEach(() => companyDetails.mockResolvedValue(details("member")));

  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("lets ordinary members view the directory without management actions", async () => {
    const markup = renderToStaticMarkup(await CompanyMemberPage({ params: Promise.resolve({ companyId: "company_1" }) }));

    expect(markup).toContain("Member");
    expect(markup).toContain("当前角色：member");
    expect(markup).not.toContain("邀请成员");
    expect(markup).not.toContain("设置角色");
    expect(markup).not.toContain("移除成员");
    expect(markup).not.toContain("转移 owner");
  });

  it("lets admins manage members without offering owner transfer", async () => {
    companyDetails.mockResolvedValue(details("admin"));
    const markup = renderToStaticMarkup(await CompanyMemberPage({ params: Promise.resolve({ companyId: "company_1" }) }));

    expect(markup).toContain("邀请成员");
    expect(markup).toContain("设置角色");
    expect(markup).toContain("移除成员");
    expect(markup).not.toContain("转移 owner");
  });

  it("lets owners access every member workflow", async () => {
    companyDetails.mockResolvedValue(details("owner"));
    const markup = renderToStaticMarkup(await CompanyMemberPage({ params: Promise.resolve({ companyId: "company_1" }) }));

    expect(markup).toContain("邀请成员");
    expect(markup).toContain("转移 owner");
    expect(markup).toContain("1 / 10");
  });
});
