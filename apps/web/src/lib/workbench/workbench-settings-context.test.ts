import { describe, expect, it, vi } from "vitest";
import {
  getWorkbenchCompanySettingsDetails,
  getWorkbenchCompanySettingsContext,
  getWorkbenchSettingsContext,
} from "./workbench-settings-context";

describe("workbench settings context", () => {
  it("projects the current user and derives company management capability", async () => {
    const userFindUnique = vi.fn().mockResolvedValue({
      id: "user_1",
      name: "Alice",
      email: "alice@example.com",
      avatarUrl: "/avatars/user_1.png",
      status: "active",
      isSiteAdmin: true,
    });
    const companyMemberFindMany = vi.fn().mockResolvedValue([
      {
        role: "owner",
        company: {
          id: "company_1",
          name: "HumanThread",
          logoUrl: null,
        },
      },
      {
        role: "member",
        company: {
          id: "company_2",
          name: "Delivery Lab",
          logoUrl: "/logos/delivery.png",
        },
      },
    ]);

    const context = await getWorkbenchSettingsContext({
      userId: "user_1",
      db: {
        user: { findUnique: userFindUnique },
        companyMember: { findMany: companyMemberFindMany },
      },
    });

    expect(context).toEqual({
      user: {
        id: "user_1",
        name: "Alice",
        email: "alice@example.com",
        avatarUrl: "/avatars/user_1.png",
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
        {
          id: "company_2",
          name: "Delivery Lab",
          logoUrl: "/logos/delivery.png",
          role: "member",
          canManage: false,
        },
      ],
      isSiteAdmin: true,
    });
  });

  it("derives read-only member capabilities without exposing company secrets", async () => {
    const companyMemberFindFirst = vi.fn().mockResolvedValue({
      role: "member",
      company: {
        id: "company_1",
        name: "HumanThread",
        slug: "humanthread",
        logoUrl: null,
        status: "active",
        emailPassword: "must-not-leak",
      },
    });

    const context = await getWorkbenchCompanySettingsContext({
      userId: "user_1",
      companyId: "company_1",
      db: {
        companyMember: { findFirst: companyMemberFindFirst },
      },
    });

    expect(context).toEqual({
      company: {
        id: "company_1",
        name: "HumanThread",
        slug: "humanthread",
        logoUrl: null,
        status: "active",
      },
      membership: {
        role: "member",
        canManageProfile: false,
        canManageMembers: false,
        canManageIntegrations: false,
        canTransferOwnership: false,
      },
    });
    expect(JSON.stringify(context)).not.toContain("must-not-leak");
    expect(companyMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_1",
          companyId: "company_1",
          status: "active",
        },
      }),
    );
  });

  it("returns null for an inaccessible company without selecting a fallback", async () => {
    const companyMemberFindFirst = vi.fn().mockResolvedValue(null);

    await expect(
      getWorkbenchCompanySettingsContext({
        userId: "user_1",
        companyId: "missing_company",
        db: {
          companyMember: { findFirst: companyMemberFindFirst },
        },
      }),
    ).resolves.toBeNull();

    expect(companyMemberFindFirst).toHaveBeenCalledTimes(1);
  });

  it("exposes SMTP presence only to company managers and never returns the password", async () => {
    const details = await getWorkbenchCompanySettingsDetails({
      userId: "user_owner",
      companyId: "company_1",
      db: {
        companyMember: {
          findFirst: vi.fn().mockResolvedValue({
            role: "owner",
            company: { id: "company_1", name: "HumanThread", slug: "humanthread", logoUrl: null, status: "active" },
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        company: {
          findUnique: vi.fn().mockResolvedValue({
            description: "HumanThread 工作台",
            certificationLevel: "normal",
            emailHost: "smtp.example.com",
            emailPort: 465,
            emailUsername: "noreply@example.com",
            emailPassword: "stored-secret",
          }),
        },
      },
    });

    expect(details?.integration).toEqual({
      emailHost: "smtp.example.com",
      emailPort: 465,
      emailUsername: "noreply@example.com",
      hasPassword: true,
    });
    expect(JSON.stringify(details)).not.toContain("stored-secret");
  });

  it("does not select or return integration fields for an ordinary member", async () => {
    const companyFindUnique = vi.fn().mockResolvedValue({
      description: "只读资料",
      certificationLevel: "normal",
    });

    const details = await getWorkbenchCompanySettingsDetails({
      userId: "user_member",
      companyId: "company_1",
      db: {
        companyMember: {
          findFirst: vi.fn().mockResolvedValue({
            role: "member",
            company: { id: "company_1", name: "HumanThread", slug: "humanthread", logoUrl: null, status: "active" },
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        company: { findUnique: companyFindUnique },
      },
    });

    expect(details?.integration).toBeUndefined();
    expect(companyFindUnique).toHaveBeenCalledWith({
      where: { id: "company_1" },
      select: {
        description: true,
        certificationLevel: true,
      },
    });
  });
});
