import { describe, expect, it, vi } from "vitest";
import {
  buildWorkbenchAccountSettingsCacheTag,
  changeWorkbenchPassword,
  createWorkbenchCompany,
  getWorkbenchAccountSettings,
  getWorkbenchCompanyMembers,
  getWorkbenchCompanyMemberships,
  inviteWorkbenchCompanyMember,
  listWorkbenchMcpCredentials,
  removeWorkbenchCompanyMember,
  revokeWorkbenchMcpCredential,
  transferWorkbenchCompanyOwnership,
  updateWorkbenchCompanyMailSettings,
  updateWorkbenchCompanyMemberRole,
  updateWorkbenchCompanyProfile,
  updateWorkbenchAccountProfile,
} from "./workbench-settings";
import { buildCompanyMembershipId } from "../../../../../packages/db/src/bounded-id";
import { createPasswordHash, verifyPasswordHash } from "./workbench-auth";

describe("workbench settings queries", () => {
  it("builds deterministic 32-character company membership IDs", () => {
    const companyId = "c".repeat(64);
    const userId = "u".repeat(64);

    expect(buildCompanyMembershipId(companyId, userId)).toMatch(/^[a-f0-9]{32}$/u);
    expect(buildCompanyMembershipId(companyId, userId)).toBe(
      buildCompanyMembershipId(companyId, userId),
    );
    expect(buildCompanyMembershipId(companyId, `${userId.slice(0, -1)}v`)).not.toBe(
      buildCompanyMembershipId(companyId, userId),
    );
  });
  it("builds a stable cache tag for account settings", () => {
    expect(buildWorkbenchAccountSettingsCacheTag("user_owner")).toBe(
      "workbench:account:user_owner",
    );
  });

  it("loads current account settings", async () => {
    const avatarUpdatedAt = new Date("2026-05-22T08:00:00.000Z");
    const findUnique = vi.fn().mockResolvedValue({
      id: "user_owner",
      name: "Alice",
      email: "alice@example.com",
      status: "active",
      lastSeenAt: new Date("2026-05-21T01:00:00.000Z"),
      avatarUrl: "/uploads/avatars/user_owner/avatar.png",
      avatarUpdatedAt,
    });

    const result = await getWorkbenchAccountSettings({
      userId: "user_owner",
      db: { user: { findUnique } },
    });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user_owner" },
        select: expect.objectContaining({
          avatarUrl: true,
          avatarUpdatedAt: true,
        }),
      }),
    );
    expect(result).toMatchObject({
      email: "alice@example.com",
      avatarUrl: "/uploads/avatars/user_owner/avatar.png",
      avatarUpdatedAt,
    });
  });

  it("loads active company memberships", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "company_1:user_owner",
        role: "owner",
        status: "active",
        createdAt: new Date("2026-05-20T00:00:00.000Z"),
        updatedAt: new Date("2026-05-21T00:00:00.000Z"),
        company: {
          id: "company_1",
          name: "HumanThread",
          slug: "humanthread",
          status: "active",
        },
      },
    ]);

    const result = await getWorkbenchCompanyMemberships({
      userId: "user_owner",
      db: { companyMember: { findMany } },
    });
    const membership = result[0];

    expect(membership).toBeDefined();
    expect(membership!.company.name).toBe("HumanThread");
    expect(membership!.role).toBe("owner");
  });

  it("loads members for the first accessible company when no company id is selected", async () => {
    const companyMemberFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          company: {
            id: "company_1",
            name: "HumanThread",
            slug: "humanthread",
            status: "active",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "company_1:user_owner",
          role: "owner",
          status: "active",
          updatedAt: new Date("2026-05-21T00:00:00.000Z"),
          user: {
            id: "user_owner",
            name: "Alice",
            email: "alice@example.com",
            status: "active",
            lastSeenAt: null,
          },
        },
      ]);

    const result = await getWorkbenchCompanyMembers({
      userId: "user_owner",
      db: { companyMember: { findMany: companyMemberFindMany } },
    });
    const member = result.members[0];

    expect(result.company?.id).toBe("company_1");
    expect(member).toBeDefined();
    expect(member!.user.name).toBe("Alice");
  });

  it("creates a company and assigns the creator as owner", async () => {
    const companyCreate = vi.fn().mockResolvedValue({
      id: "company_123",
      name: "HumanThread",
      slug: "humanthread-12345678",
      status: "active",
    });
    const companyMemberCreate = vi.fn().mockResolvedValue({
      id: "company_123:user_owner",
      role: "owner",
      status: "active",
    });
    const spaceCreate = vi.fn().mockResolvedValue({
      id: "space:company:company_123",
    });
    const transaction = vi.fn().mockImplementation(async (callback) =>
      callback({
        company: {
          create: companyCreate,
        },
        companyMember: {
          create: companyMemberCreate,
        },
        space: {
          create: spaceCreate,
        },
      }),
    );

    const result = await createWorkbenchCompany({
      userId: "user_owner",
      name: "  HumanThread  ",
      now: new Date("2026-05-22T00:00:00.000Z"),
      db: {
        $transaction: transaction,
      },
    });

    expect(companyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: expect.stringMatching(/^company_/),
          name: "HumanThread",
          slug: expect.stringMatching(/^humanthread-/),
          status: "active",
        }),
      }),
    );
    expect(companyMemberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "owner",
          status: "active",
          userId: "user_owner",
        }),
      }),
    );
    expect(spaceCreate).toHaveBeenCalledWith({
      data: {
        id: "space:company:company_123",
        type: "company",
        ownerUserId: null,
        companyId: "company_123",
        name: "HumanThread",
        status: "active",
      },
      select: { id: true },
    });
    expect(result.company.name).toBe("HumanThread");
    expect(result.membership.id).toBe("company_123:user_owner");
    expect(result.membership.role).toBe("owner");
    expect(result.membership.status).toBe("active");
  });

  it("lists MCP credentials for the current user without exposing token hashes", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "mcp_1",
        name: "Codex",
        status: "active",
        lastUsedAt: null,
        createdAt: new Date("2026-05-21T00:00:00.000Z"),
        revokedAt: null,
      },
    ]);

    const result = await listWorkbenchMcpCredentials({
      userId: "user_owner",
      db: { mcpCredential: { findMany } },
    });

    expect(result[0]).toEqual({
      id: "mcp_1",
      name: "Codex",
      status: "active",
      lastUsedAt: null,
      createdAt: new Date("2026-05-21T00:00:00.000Z"),
      revokedAt: null,
    });
  });

  it("changes the current user's password after verifying the existing password", async () => {
    const oldHash = createPasswordHash("old-password", {
      salt: "salt_old",
      iterations: 1,
    });
    const update = vi.fn().mockResolvedValue({ id: "user_owner" });
    const findUnique = vi.fn().mockResolvedValue({
      id: "user_owner",
      passwordHash: oldHash,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = vi.fn(async (callback) => callback({
      user: { update },
      webSession: { updateMany },
    }));

    await expect(changeWorkbenchPassword({
      userId: "user_owner",
      currentSessionId: "a".repeat(32),
      currentPassword: "old-password",
      newPassword: "new-password",
      confirmPassword: "new-password",
      db: {
        user: {
          findUnique,
        },
        $transaction: transaction,
      },
    })).resolves.toEqual({ otherSessionsRevoked: 2 });

    const nextHash = update.mock.calls[0]?.[0]?.data?.passwordHash;
    expect(nextHash).toBeTruthy();
    expect(verifyPasswordHash({ password: "new-password", passwordHash: nextHash }))
      .toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user_owner",
        id: { not: "a".repeat(32) },
        status: "active",
        revokedAt: null,
      },
      data: expect.objectContaining({
        status: "revoked",
        revokedReason: "password_changed",
        revokedAt: expect.any(Date),
      }),
    });
  });

  it("updates only the authenticated user's normalized profile name", async () => {
    const update = vi.fn().mockResolvedValue({ id: "user_owner", name: "Alice" });

    await updateWorkbenchAccountProfile({
      userId: "user_owner",
      name: "  Alice  ",
      db: { user: { update } },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "user_owner" },
      data: { name: "Alice" },
    });
  });

  it("updates company profile fields for an accessible owner", async () => {
    const companyMemberFindFirst = vi.fn().mockResolvedValue({ role: "owner" });
    const companyUpdate = vi.fn().mockResolvedValue({
      id: "company_1",
      name: "HumanThread",
      description: "新的简介",
    });

    await updateWorkbenchCompanyProfile({
      userId: "user_owner",
      companyId: "company_1",
      description: " 新的简介 ",
      logoUrl: " /brand/logo.svg ",
      certificationLevel: "normal",
      db: {
        companyMember: {
          findFirst: companyMemberFindFirst,
        },
        company: {
          update: companyUpdate,
        },
      },
    });

    expect(companyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "company_1" },
        data: expect.objectContaining({
          description: "新的简介",
          logoUrl: "/brand/logo.svg",
          certificationLevel: "normal",
        }),
      }),
    );
    expect(companyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          emailHost: expect.anything(),
          emailPort: expect.anything(),
          emailUsername: expect.anything(),
          emailPassword: expect.anything(),
        }),
      }),
    );
  });

  it("updates SMTP settings separately and keeps the stored password when blank", async () => {
    const companyMemberFindFirst = vi.fn().mockResolvedValue({ role: "owner" });
    const companyUpdate = vi.fn().mockResolvedValue({
      id: "company_1",
    });

    await updateWorkbenchCompanyMailSettings({
      userId: "user_owner",
      companyId: "company_1",
      emailHost: "smtp.example.com",
      emailPort: "465",
      emailUsername: "noreply@example.com",
      emailPassword: "",
      db: {
        companyMember: {
          findFirst: companyMemberFindFirst,
        },
        company: {
          update: companyUpdate,
        },
      },
    });

    expect(companyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "company_1" },
        data: expect.objectContaining({
          emailHost: "smtp.example.com",
          emailPort: 465,
          emailUsername: "noreply@example.com",
        }),
      }),
    );
    expect(companyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ emailPassword: expect.anything() }),
      }),
    );
  });

  it("revokes only an active MCP credential owned by the current user", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const now = new Date("2026-07-26T08:00:00.000Z");

    await revokeWorkbenchMcpCredential({
      userId: "user_owner",
      credentialId: "mcp_1",
      now,
      db: { mcpCredential: { updateMany } },
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "mcp_1",
        userId: "user_owner",
        status: "active",
      },
      data: {
        status: "revoked",
        revokedAt: now,
      },
    });
  });

  it("rejects an MCP revoke when the credential is not owned and active", async () => {
    await expect(
      revokeWorkbenchMcpCredential({
        userId: "user_owner",
        credentialId: "mcp_other",
        db: {
          mcpCredential: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
        },
      }),
    ).rejects.toThrow("MCP credential not found");
  });

  it("invites, changes role and removes company members through real mutations", async () => {
    const inviteFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce({ id: "user_invited", email: "new@example.com" })
      .mockResolvedValueOnce({ company: { certificationLevel: "normal" } });
    const count = vi.fn().mockResolvedValue(1);
    const upsert = vi.fn().mockResolvedValue({ id: "company_1:user_invited" });
    const update = vi.fn().mockResolvedValue({ id: "company_1:user_invited" });

    await inviteWorkbenchCompanyMember({
      userId: "user_owner",
      companyId: "company_1",
      email: " new@example.com ",
      role: "member",
      db: {
        companyMember: {
          findFirst: inviteFindFirst,
          count,
          upsert,
        },
        user: {
          findFirst: inviteFindFirst,
        },
      },
    });

    await updateWorkbenchCompanyMemberRole({
      userId: "user_owner",
      companyId: "company_1",
      memberId: "company_1:user_invited",
      role: "admin",
      db: {
        companyMember: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ role: "owner" })
            .mockResolvedValueOnce({
              id: "company_1:user_invited",
              role: "member",
              status: "active",
            }),
          count,
          update,
        },
      },
    });

    await removeWorkbenchCompanyMember({
      userId: "user_owner",
      companyId: "company_1",
      memberId: "company_1:user_invited",
      db: {
        companyMember: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ role: "owner" })
            .mockResolvedValueOnce({
              id: "company_1:user_invited",
              role: "admin",
              status: "active",
            }),
          count,
          update,
        },
      },
    });

    expect(upsert).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ id: expect.stringMatching(/^[a-f0-9]{32}$/u) }),
    }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: "admin" },
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "removed" },
      }),
    );
  });

  it("supports the viewer company role", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce({ id: "user_viewer", email: "viewer@example.com" })
      .mockResolvedValueOnce({ role: "owner" });
    const upsert = vi.fn().mockResolvedValue({ id: "company_1:user_viewer" });

    await inviteWorkbenchCompanyMember({
      userId: "user_owner",
      companyId: "company_1",
      email: "viewer@example.com",
      role: "viewer",
      db: {
        companyMember: {
          findFirst,
          count: vi.fn().mockResolvedValue(1),
          upsert,
        },
        user: { findFirst },
      },
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: "viewer" }),
        update: expect.objectContaining({ role: "viewer" }),
      }),
    );
  });

  it("creates a pending invitation when the email has no account", async () => {
    const invitationUpsert = vi.fn().mockResolvedValue({ id: "invite_1" });

    await expect(
      inviteWorkbenchCompanyMember({
        userId: "user_owner",
        companyId: "company_1",
        email: "future@example.com",
        role: "member",
        now: new Date("2026-07-18T00:00:00.000Z"),
        db: {
          companyMember: {
            findFirst: vi
              .fn()
              .mockResolvedValueOnce({ role: "owner" })
              .mockResolvedValueOnce({ company: { certificationLevel: "normal" } }),
            count: vi.fn().mockResolvedValue(1),
            upsert: vi.fn(),
          },
          companyInvitation: { upsert: invitationUpsert },
          user: { findFirst: vi.fn().mockResolvedValue(null) },
        },
      }),
    ).resolves.toMatchObject({ status: "invited" });

    expect(invitationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_email: {
            companyId: "company_1",
            email: "future@example.com",
          },
        },
        create: expect.objectContaining({
          role: "member",
          status: "pending",
          invitedById: "user_owner",
          expiresAt: new Date("2026-07-25T00:00:00.000Z"),
        }),
      }),
    );
  });

  it("transfers ownership atomically and demotes the current owner", async () => {
    const update = vi.fn().mockResolvedValue({ id: "member" });
    const transaction = vi.fn(async (callback) =>
      callback({
        companyMember: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ id: "company_1:user_owner", role: "owner" })
            .mockResolvedValueOnce({
              id: "company_1:user_admin",
              role: "admin",
              status: "active",
            }),
          update,
        },
      }),
    );

    await transferWorkbenchCompanyOwnership({
      userId: "user_owner",
      companyId: "company_1",
      targetMemberId: "company_1:user_admin",
      db: { $transaction: transaction },
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "company_1:user_admin" },
      data: { role: "owner" },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "company_1:user_owner" },
      data: { role: "admin" },
    });
  });

  it("rejects demoting the final active owner", async () => {
    const transaction = vi.fn(async (callback) =>
      callback({
        companyMember: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ role: "owner" })
            .mockResolvedValueOnce({ id: "member_owner", role: "owner", status: "active" }),
          count: vi.fn().mockResolvedValue(1),
          update: vi.fn(),
        },
      }),
    );

    await expect(
      updateWorkbenchCompanyMemberRole({
        userId: "user_owner",
        companyId: "company_1",
        memberId: "member_owner",
        role: "admin",
        db: { $transaction: transaction },
      }),
    ).rejects.toThrow("Company must keep at least one active owner");
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rejects granting owner through the generic role mutation", async () => {
    await expect(
      updateWorkbenchCompanyMemberRole({
        userId: "user_owner",
        companyId: "company_1",
        memberId: "company_1:user_admin",
        role: "owner",
        db: {
          companyMember: {
            findFirst: vi.fn(),
            count: vi.fn(),
            update: vi.fn(),
          },
        },
      }),
    ).rejects.toThrow("Use company ownership transfer");
  });

  it("rejects removing the final active owner", async () => {
    const transaction = vi.fn(async (callback) =>
      callback({
        companyMember: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ role: "owner" })
            .mockResolvedValueOnce({ id: "member_owner", role: "owner", status: "active" }),
          count: vi.fn().mockResolvedValue(1),
          update: vi.fn(),
        },
      }),
    );

    await expect(
      removeWorkbenchCompanyMember({
        userId: "user_admin",
        companyId: "company_1",
        memberId: "member_owner",
        db: { $transaction: transaction },
      }),
    ).rejects.toThrow("Company must keep at least one active owner");
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rejects removing the current user for both legacy and MD5 membership IDs", async () => {
    const update = vi.fn();
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ role: "admin" })
      .mockResolvedValueOnce({
        id: "company_1:user_admin",
        userId: "user_admin",
        role: "admin",
        status: "active",
      });

    await expect(removeWorkbenchCompanyMember({
      userId: "user_admin",
      companyId: "company_1",
      memberId: "company_1:user_admin",
      db: { companyMember: { findFirst, count: vi.fn(), update } },
    })).rejects.toThrow("Cannot remove yourself from company management");
    expect(update).not.toHaveBeenCalled();
  });
});
