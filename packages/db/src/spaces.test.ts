import { describe, expect, it, vi } from "vitest";
import {
  assertCanReadSpace,
  assertCanWriteSpace,
  buildCompanySpaceId,
  buildPersonalSpaceId,
  listAccessibleSpaces,
  provisionCompanySpace,
  provisionPersonalSpace,
  type SpaceRow,
} from "./spaces";

describe("space service", () => {
  it("builds deterministic space ids", () => {
    expect(buildPersonalSpaceId("user_1")).toBe("space:personal:user_1");
    expect(buildCompanySpaceId("company_1")).toBe("space:company:company_1");
  });

  it("provisions personal and company spaces idempotently", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "space_1" });
    const db = { space: { upsert } };

    await provisionPersonalSpace({
      userId: "user_1",
      name: "Alice 的个人空间",
      db,
    });
    await provisionCompanySpace({ companyId: "company_1", name: "Acme", db });

    expect(upsert).toHaveBeenNthCalledWith(1, {
      where: { ownerUserId: "user_1" },
      update: { name: "Alice 的个人空间", status: "active" },
      create: {
        id: "space:personal:user_1",
        type: "personal",
        ownerUserId: "user_1",
        companyId: null,
        name: "Alice 的个人空间",
        status: "active",
      },
      select: { id: true },
    });
    expect(upsert).toHaveBeenNthCalledWith(2, {
      where: { companyId: "company_1" },
      update: { name: "Acme", status: "active" },
      create: {
        id: "space:company:company_1",
        type: "company",
        ownerUserId: null,
        companyId: "company_1",
        name: "Acme",
        status: "active",
      },
      select: { id: true },
    });
  });

  it("allows a personal owner to read and write", async () => {
    const db = createAccessDb({
      space: personalSpace("user_1"),
    });

    await expect(
      assertCanWriteSpace({ userId: "user_1", spaceId: "space_1", db }),
    ).resolves.toEqual({ spaceId: "space_1", role: "owner" });
  });

  it("allows an active company member to write company root resources", async () => {
    const db = createAccessDb({
      space: companySpace("company_1"),
      membership: { role: "member", status: "active" },
    });

    await expect(
      assertCanWriteSpace({ userId: "user_1", spaceId: "space_1", db }),
    ).resolves.toEqual({ spaceId: "space_1", role: "member" });
  });

  it("keeps company viewers read-only", async () => {
    const db = createAccessDb({
      space: companySpace("company_1"),
      membership: { role: "viewer", status: "active" },
    });

    await expect(
      assertCanReadSpace({ userId: "user_1", spaceId: "space_1", db }),
    ).resolves.toEqual({ spaceId: "space_1", role: "viewer" });
    await expect(
      assertCanWriteSpace({ userId: "user_1", spaceId: "space_1", db }),
    ).rejects.toThrow("Space write access denied");
  });

  it("rejects invalid or inactive spaces", async () => {
    await expect(
      assertCanReadSpace({
        userId: "user_1",
        spaceId: "space_1",
        db: createAccessDb({
          space: { ...personalSpace("user_1"), companyId: "company_1" },
        }),
      }),
    ).rejects.toThrow("Invalid space ownership");

    await expect(
      assertCanReadSpace({
        userId: "user_1",
        spaceId: "space_1",
        db: createAccessDb({
          space: { ...personalSpace("user_1"), status: "suspended" },
        }),
      }),
    ).rejects.toThrow("Space access denied");
  });

  it("lists the personal space and active company memberships", async () => {
    const findMany = vi.fn().mockResolvedValue([
      personalSpace("user_1", "My Space"),
      {
        ...companySpace("company_1", "Acme"),
        company: {
          members: [{ role: "admin", status: "active" }],
        },
      },
    ]);

    await expect(
      listAccessibleSpaces({ userId: "user_1", db: { space: { findMany } } }),
    ).resolves.toEqual([
      {
        id: "space_1",
        type: "personal",
        name: "My Space",
        role: "owner",
        ownerUserId: "user_1",
        companyId: null,
      },
      {
        id: "space_1",
        type: "company",
        name: "Acme",
        role: "admin",
        ownerUserId: null,
        companyId: "company_1",
      },
    ]);
  });
});

function personalSpace(ownerUserId: string, name = "Personal") {
  return {
    id: "space_1",
    type: "personal",
    ownerUserId,
    companyId: null,
    name,
    status: "active",
  };
}

function companySpace(companyId: string, name = "Company") {
  return {
    id: "space_1",
    type: "company",
    ownerUserId: null,
    companyId,
    name,
    status: "active",
  };
}

function createAccessDb(input: {
  space: SpaceRow;
  membership?: { role: string; status: string } | null;
}) {
  return {
    space: {
      findUnique: vi.fn().mockResolvedValue(input.space),
    },
    companyMember: {
      findFirst: vi.fn().mockResolvedValue(input.membership ?? null),
    },
  };
}
