import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, companyContext } = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  companyContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({ session: { context: { userId: "user_1" } } }),
}));
vi.mock("../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchCompanySettingsContext: companyContext,
}));

import MemberSettingsPage, { dynamic } from "./page";

describe("Member settings page", () => {
  beforeEach(() => {
    redirect.mockClear();
    companyContext.mockClear();
    companyContext.mockResolvedValue({
      company: { id: "company_1", name: "HumanThread", slug: "humanthread", logoUrl: null, status: "active" },
      membership: { role: "member", canManageProfile: false, canManageMembers: false, canManageIntegrations: false, canTransferOwnership: false },
    });
  });

  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("redirects only after verifying the explicitly named company", async () => {
    await expect(MemberSettingsPage({ searchParams: Promise.resolve({ companyId: "company_1" }) }))
      .rejects.toThrow("NEXT_REDIRECT:/companies/company_1/members");

    expect(companyContext).toHaveBeenCalledWith({ userId: "user_1", companyId: "company_1" });
  });

  it("uses the company chooser when companyId is absent", async () => {
    await expect(MemberSettingsPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("NEXT_REDIRECT:/settings/companies?intent=members");
    expect(companyContext).not.toHaveBeenCalled();
  });

  it("uses the chooser when the explicit company is inaccessible", async () => {
    companyContext.mockResolvedValue(null);
    await expect(MemberSettingsPage({ searchParams: Promise.resolve({ companyId: "missing" }) }))
      .rejects.toThrow("NEXT_REDIRECT:/settings/companies?intent=members");
  });
});
