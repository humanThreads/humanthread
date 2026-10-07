import { describe, expect, it, vi } from "vitest";
import {
  buildWorkbenchCompanyFiltersCacheTag,
  getWorkbenchCompanyFilters,
} from "./workbench-companies";

describe("getWorkbenchCompanyFilters", () => {
  it("returns all, personal and active company filters for a user", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "space_personal", type: "personal", name: "个人空间", status: "active",
        ownerUserId: "user_1", companyId: null, company: null,
      },
      {
        id: "space_company", type: "company", name: "Alpha", status: "active",
        ownerUserId: null, companyId: "company_1",
        company: { members: [{ role: "member", status: "active" }] },
      },
    ]);

    const result = await getWorkbenchCompanyFilters({
      userId: "user_1",
      db: {
        space: {
          findMany,
        },
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "active", OR: expect.any(Array) }),
    }));
    expect(result).toEqual([
      {
        key: "all",
        label: "全部",
        companyId: null,
        ownerType: null,
        spaceId: null,
        role: null,
      },
      {
        key: "personal",
        label: "个人空间",
        companyId: null,
        ownerType: "personal",
        spaceId: "space_personal",
        role: "owner",
      },
      {
        key: "company_1",
        label: "Alpha",
        companyId: "company_1",
        ownerType: "company",
        spaceId: "space_company",
        role: "member",
      },
    ]);
  });

  it("builds a stable cache tag for a user's workbench company filters", () => {
    expect(buildWorkbenchCompanyFiltersCacheTag("user_1")).toBe(
      "workbench:company-filters:user_1",
    );
  });
});
