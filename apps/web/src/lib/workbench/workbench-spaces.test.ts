import { describe, expect, it, vi } from "vitest";
import {
  listWorkbenchSpaces,
  selectWorkbenchRootDocumentSpaceId,
} from "./workbench-spaces";

describe("workbench spaces", () => {
  it("lists the personal space before company spaces sorted by name", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "space:company:company_z",
        type: "company",
        ownerUserId: null,
        companyId: "company_z",
        name: "Zeta",
        status: "active",
        company: {
          members: [{ role: "viewer", status: "active" }],
        },
      },
      {
        id: "space:personal:user_1",
        type: "personal",
        ownerUserId: "user_1",
        companyId: null,
        name: "我的空间",
        status: "active",
        company: null,
      },
      {
        id: "space:company:company_a",
        type: "company",
        ownerUserId: null,
        companyId: "company_a",
        name: "Alpha",
        status: "active",
        company: {
          members: [{ role: "member", status: "active" }],
        },
      },
    ]);

    await expect(
      listWorkbenchSpaces({
        userId: "user_1",
        db: { space: { findMany } },
      }),
    ).resolves.toEqual([
      {
        id: "space:personal:user_1",
        type: "personal",
        name: "我的空间",
        role: "owner",
        companyId: null,
        ownerUserId: "user_1",
      },
      {
        id: "space:company:company_a",
        type: "company",
        name: "Alpha",
        role: "member",
        companyId: "company_a",
        ownerUserId: null,
      },
      {
        id: "space:company:company_z",
        type: "company",
        name: "Zeta",
        role: "viewer",
        companyId: "company_z",
        ownerUserId: null,
      },
    ]);
  });

  it("maps personal and company filters to their real space ids", () => {
    const spaces = [
      {
        id: "space:personal:user_1",
        type: "personal" as const,
        name: "Personal",
        role: "owner" as const,
        ownerUserId: "user_1",
        companyId: null,
      },
      {
        id: "space:company:company_1",
        type: "company" as const,
        name: "Acme",
        role: "member" as const,
        ownerUserId: null,
        companyId: "company_1",
      },
    ];

    expect(
      selectWorkbenchRootDocumentSpaceId(spaces, {
        key: "personal",
        label: "个人空间",
        companyId: null,
        ownerType: "personal",
      }),
    ).toBe("space:personal:user_1");
    expect(
      selectWorkbenchRootDocumentSpaceId(spaces, {
        key: "company_1",
        label: "Acme",
        companyId: "company_1",
        ownerType: "company",
      }),
    ).toBe("space:company:company_1");
    expect(
      selectWorkbenchRootDocumentSpaceId(spaces, {
        key: "all",
        label: "全部",
        companyId: null,
        ownerType: null,
      }),
    ).toBeUndefined();
  });
});
