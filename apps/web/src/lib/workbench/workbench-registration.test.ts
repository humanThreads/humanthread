import { describe, expect, it, vi } from "vitest";
import {
  createWorkbenchRegistrationVerification,
  hashRegistrationVerificationCode,
  registerWorkbenchUser,
} from "./workbench-registration";

describe("registerWorkbenchUser", () => {
  it("creates an active user with a personal project and database Web session", async () => {
    const cookieStore = {
      set: vi.fn(),
    };
    const now = new Date("2026-05-20T10:20:00.000Z");
    const findFirst = vi.fn().mockResolvedValue(null);
    const createSession = vi.fn().mockResolvedValue({
      token: "raw-session-token",
      session: { id: "a".repeat(32) },
    });
    const spaceCreate = vi.fn().mockResolvedValue({
      id: "space:personal:user_1",
    });
    const projectCreate = vi.fn().mockResolvedValue({
      id: "project_user_1_personal",
    });
    const transaction = vi.fn(async (callback) =>
      callback({
        user: {
          create: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "alice@example.com",
            name: "Alice",
          }),
        },
        space: {
          create: spaceCreate,
        },
        project: {
          create: projectCreate,
        },
        projectMember: {
          create: vi.fn().mockResolvedValue({
            id: "project_user_1_personal:user_1",
          }),
        },
      }),
    );

    const result = await registerWorkbenchUser({
      name: " Alice ",
      email: " Alice@Example.com ",
      password: " correct-password ",
      verificationCode: "123456",
      cookieStore,
      request: new Request("http://localhost:3000/register"),
      now,
      createSession,
      db: {
        user: {
          findFirst,
        },
        registrationEmailVerification: {
          findFirst: vi.fn().mockResolvedValue({
            id: "reg_verify_1",
            email: "alice@example.com",
            codeHash: hashRegistrationVerificationCode("123456"),
            attempts: 0,
            expiresAt: new Date("2026-05-20T10:30:00.000Z"),
            consumedAt: null,
          }),
          update: vi.fn(),
        },
        $transaction: transaction,
      },
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        email: "alice@example.com",
      },
      select: {
        id: true,
      },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(spaceCreate).toHaveBeenCalledWith({
      data: {
        id: "space:personal:user_1",
        type: "personal",
        ownerUserId: "user_1",
        companyId: null,
        name: "Alice 的个人空间",
        status: "active",
      },
      select: { id: true },
    });
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          spaceId: "space:personal:user_1",
          ownerType: "personal",
          ownerUserId: "user_1",
        }),
      }),
    );
    expect(createSession).toHaveBeenCalledWith({
      userId: "user_1",
      request: expect.any(Request),
    });
    expect(cookieStore.set).toHaveBeenCalledWith(
      "ht_web_session",
      "raw-session-token",
      expect.objectContaining({ httpOnly: true, maxAge: 60 * 60 * 24 * 30 }),
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      "ht_workbench_login_email",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
    expect(result).toEqual({
      email: "alice@example.com",
      name: "Alice",
      userId: "user_1",
      personalProjectId: "project_user_1_personal",
      companyId: null,
      companySpaceId: null,
    });
  });

  it("creates a company, owner membership, and company space in the registration transaction", async () => {
    const companyCreate = vi.fn().mockResolvedValue({
      id: "company_20260520102000_abcdef12",
      name: "Acme",
    });
    const companyMemberCreate = vi.fn().mockResolvedValue({
      id: "company_20260520102000_abcdef12:user_1",
    });
    const spaceCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: "space:personal:user_1" })
      .mockResolvedValueOnce({ id: "space:company:company_1" });
    const transaction = vi.fn(async (callback) =>
      callback({
        user: {
          create: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "alice@example.com",
            name: "Alice",
          }),
        },
        space: { create: spaceCreate },
        project: {
          create: vi.fn().mockResolvedValue({ id: "proj_20260520102000_alice_abcdef12" }),
        },
        projectMember: { create: vi.fn().mockResolvedValue({ id: "pm_1" }) },
        company: { create: companyCreate },
        companyMember: { create: companyMemberCreate },
      }),
    );

    const result = await registerWorkbenchUser({
      accountType: "company",
      companyName: " Acme ",
      name: "Alice",
      email: "alice@example.com",
      password: "correct-password",
      verificationCode: "123456",
      cookieStore: { set: vi.fn() },
      now: new Date("2026-05-20T10:20:00.000Z"),
      request: new Request("http://localhost:3000/register"),
      createSession: vi.fn().mockResolvedValue({ token: "session", session: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }),
      db: {
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        registrationEmailVerification: {
          findFirst: vi.fn().mockResolvedValue({
            id: "reg_verify_1",
            email: "alice@example.com",
            codeHash: hashRegistrationVerificationCode("123456"),
            attempts: 0,
            expiresAt: new Date("2026-05-20T10:30:00.000Z"),
            consumedAt: null,
          }),
          update: vi.fn(),
        },
        $transaction: transaction,
      },
    });

    expect(companyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Acme", status: "active" }),
      }),
    );
    expect(companyMemberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user_1",
          role: "owner",
          status: "active",
        }),
      }),
    );
    expect(spaceCreate).toHaveBeenLastCalledWith({
      data: {
        id: expect.stringMatching(/^space:company:/),
        type: "company",
        ownerUserId: null,
        companyId: expect.stringMatching(/^company_/),
        name: "Acme",
        status: "active",
      },
      select: { id: true },
    });
    expect(result).toMatchObject({
      companyId: expect.stringMatching(/^company_/),
      companySpaceId: expect.stringMatching(/^space:company:/),
    });
  });

  it("requires a company name for company registration", async () => {
    await expect(
      registerWorkbenchUser({
        accountType: "company",
        companyName: " ",
        name: "Alice",
        email: "alice@example.com",
        password: "correct-password",
        verificationCode: "123456",
        request: new Request("http://localhost:3000/register"),
        cookieStore: { set: vi.fn() },
        db: {
          user: { findFirst: vi.fn() },
          registrationEmailVerification: { findFirst: vi.fn(), update: vi.fn() },
          $transaction: vi.fn(),
        },
      }),
    ).rejects.toThrow("Company name is required");
  });

  it("accepts pending company invitations for the verified registration email", async () => {
    const companyMemberUpsert = vi.fn().mockResolvedValue({ id: "company_1:user_new" });
    const invitationUpdate = vi.fn().mockResolvedValue({ id: "invite_1" });

    await registerWorkbenchUser({
      name: "Alice",
      email: "alice@example.com",
      password: "correct-password",
      verificationCode: "123456",
      cookieStore: { set: vi.fn() },
      now: new Date("2026-05-20T10:20:00.000Z"),
      request: new Request("http://localhost:3000/register"),
      createSession: vi.fn().mockResolvedValue({ token: "session", session: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }),
      db: {
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        companyInvitation: {
          findMany: vi.fn().mockResolvedValue([
            { id: "invite_1", companyId: "company_1", role: "member" },
          ]),
        },
        registrationEmailVerification: {
          findFirst: vi.fn().mockResolvedValue({
            id: "reg_verify_1",
            email: "alice@example.com",
            codeHash: hashRegistrationVerificationCode("123456"),
            attempts: 0,
            expiresAt: new Date("2026-05-20T10:30:00.000Z"),
            consumedAt: null,
          }),
          update: vi.fn(),
        },
        $transaction: vi.fn(async (callback) =>
          callback({
            user: {
              create: vi.fn().mockResolvedValue({
                id: "user_new",
                email: "alice@example.com",
                name: "Alice",
              }),
            },
            space: {
              create: vi.fn().mockResolvedValue({ id: "space:personal:user_new" }),
            },
            project: { create: vi.fn().mockResolvedValue({ id: "project_new" }) },
            projectMember: { create: vi.fn().mockResolvedValue({ id: "pm_new" }) },
            company: { create: vi.fn() },
            companyMember: { create: vi.fn(), upsert: companyMemberUpsert },
            companyInvitation: { update: invitationUpdate },
          }),
        ),
      },
    });

    expect(companyMemberUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_userId: { companyId: "company_1", userId: "user_new" } },
        create: expect.objectContaining({ role: "member", status: "active" }),
      }),
    );
    expect(invitationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "invite_1" },
        data: expect.objectContaining({
          status: "accepted",
          acceptedById: "user_new",
        }),
      }),
    );
  });

  it("rejects duplicate registration email", async () => {
    await expect(
      registerWorkbenchUser({
        name: "Alice",
        email: "alice@example.com",
        password: "correct-password",
        verificationCode: "123456",
        request: new Request("http://localhost:3000/register"),
        cookieStore: {
          set: vi.fn(),
        },
        db: {
          user: {
            findFirst: vi.fn().mockResolvedValue({
              id: "user_existing",
            }),
          },
          registrationEmailVerification: {
            findFirst: vi.fn(),
            update: vi.fn(),
          },
          $transaction: vi.fn(),
        },
      }),
    ).rejects.toThrow("Workbench account already exists");
  });

  it("keeps generated database ids within schema limits for long email addresses", async () => {
    const userCreate = vi.fn().mockResolvedValue({
      id: "user_1_very_long_registration_identifier",
      email: "very-long-registration-email-local-part@example.com",
      name: "Long Email User",
    });
    const projectCreate = vi.fn().mockResolvedValue({
      id: "proj_20260520102000_very_long_registration_e_abcdef12",
    });
    const projectMemberCreate = vi.fn().mockResolvedValue({
      id: "pm_20260520102000_abcdef12",
    });

    await registerWorkbenchUser({
      name: "Long Email User",
      email:
        "very-long-registration-email-local-part-that-would-overflow@example.com",
      password: "correct-password",
      verificationCode: "123456",
      cookieStore: {
        set: vi.fn(),
      },
      now: new Date("2026-05-20T10:20:00.000Z"),
      request: new Request("http://localhost:3000/register"),
      createSession: vi.fn().mockResolvedValue({ token: "session", session: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }),
      db: {
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        registrationEmailVerification: {
          findFirst: vi.fn().mockResolvedValue({
            id: "reg_verify_1",
            email: "very-long-registration-email-local-part-that-would-overflow@example.com",
            codeHash: hashRegistrationVerificationCode("123456"),
            attempts: 0,
            expiresAt: new Date("2026-05-20T10:30:00.000Z"),
            consumedAt: null,
          }),
          update: vi.fn(),
        },
        $transaction: vi.fn(async (callback) =>
          callback({
            user: {
              create: userCreate,
            },
            space: {
              create: vi.fn().mockResolvedValue({
                id: "space:personal:user_1_very_long_registration_identifier",
              }),
            },
            project: {
              create: projectCreate,
            },
            projectMember: {
              create: projectMemberCreate,
            },
          }),
        ),
      },
    });

    const userInput = userCreate.mock.calls[0]?.[0] as {
      data: { id: string };
    };
    const projectInput = projectCreate.mock.calls[0]?.[0] as {
      data: { id: string };
    };
    const projectMemberInput = projectMemberCreate.mock.calls[0]?.[0] as {
      data: { id: string };
    };

    expect(userInput.data.id.length).toBeLessThanOrEqual(64);
    expect(projectInput.data.id.length).toBeLessThanOrEqual(64);
    expect(projectMemberInput.data.id.length).toBeLessThanOrEqual(96);
  });

  it("creates a registration email verification and sends the code", async () => {
    const create = vi.fn().mockResolvedValue({ id: "reg_verify_1" });
    const sendVerificationEmail = vi.fn().mockResolvedValue(undefined);
    const result = await createWorkbenchRegistrationVerification({
      email: " Alice@Example.com ",
      now: new Date("2026-05-20T10:20:00.000Z"),
      createCode: () => "123456",
      sendVerificationEmail,
      db: {
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        registrationEmailVerification: {
          findFirst: vi.fn().mockResolvedValue(null),
          create,
        },
      },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "alice@example.com",
        codeHash: hashRegistrationVerificationCode("123456"),
        attempts: 0,
        consumedAt: null,
      }),
      select: { id: true },
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: "alice@example.com",
      code: "123456",
    });
    expect(result).toEqual({
      email: "alice@example.com",
      expiresAt: new Date("2026-05-20T10:30:00.000Z"),
    });
  });

  it("rejects registration when the verification code is missing", async () => {
    await expect(
      registerWorkbenchUser({
        name: "Alice",
        email: "alice@example.com",
        password: "correct-password",
        verificationCode: "",
        request: new Request("http://localhost:3000/register"),
        cookieStore: {
          set: vi.fn(),
        },
        db: {
          user: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          registrationEmailVerification: {
            findFirst: vi.fn(),
            update: vi.fn(),
          },
          $transaction: vi.fn(),
        },
      }),
    ).rejects.toThrow("Registration verification code is required");
  });
});
