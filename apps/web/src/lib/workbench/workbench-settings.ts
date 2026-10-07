import { createHash, randomUUID } from "node:crypto";
import {
  buildCompanyMembershipId,
  buildCompanySpaceId,
  prisma,
} from "../../../../../packages/db/src/index";
import { createPasswordHash, verifyPasswordHash } from "./workbench-auth";

export interface WorkbenchAccountSettings {
  id: string;
  name: string;
  email: string | null;
  status: string;
  lastSeenAt: Date | null;
  avatarUrl: string | null;
  avatarUpdatedAt: Date | null;
  isSiteAdmin: boolean;
}

export interface WorkbenchCompanyMembershipSettings {
  id: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  company: {
    id: string;
    name: string;
    slug: string;
    status: string;
    description: string | null;
    logoUrl: string | null;
    certificationLevel: string;
    emailHost: string | null;
    emailPort: number | null;
    emailUsername: string | null;
    emailPassword: string | null;
  };
}

export interface WorkbenchCompanyMemberSettings {
  id: string;
  role: string;
  status: string;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    email: string | null;
    status: string;
    lastSeenAt: Date | null;
  };
}

export interface WorkbenchMcpCredentialSettings {
  id: string;
  name: string;
  status: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface WorkbenchCreatedCompanySettings {
  company: WorkbenchCompanyMembershipSettings["company"];
  membership: {
    id: string;
    role: string;
    status: string;
  };
}

interface WorkbenchAccountSettingsDb {
  user: {
    findUnique(args: {
      where: {
        id: string;
      };
      select: Record<string, boolean>;
    }): Promise<WorkbenchAccountSettings | null>;
  };
}

export function buildWorkbenchAccountSettingsCacheTag(userId: string) {
  return `workbench:account:${userId}`;
}

interface WorkbenchCreateCompanyDb {
  $transaction<T>(callback: (tx: {
    company: {
      create(input: unknown): Promise<WorkbenchCreatedCompanySettings["company"]>;
    };
    companyMember: {
      create(input: unknown): Promise<WorkbenchCreatedCompanySettings["membership"]>;
    };
    space: {
      create(input: unknown): Promise<{ id: string }>;
    };
  }) => Promise<T>): Promise<T>;
}

const COMPANY_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  description: true,
  logoUrl: true,
  certificationLevel: true,
  emailHost: true,
  emailPort: true,
  emailUsername: true,
  emailPassword: true,
} as const;

const COMPANY_MEMBER_LIMITS: Record<string, number> = {
  none: 1,
  normal: 10,
  vip: 200,
  community: 5,
};

const COMPANY_ROLES = new Set(["owner", "admin", "member", "viewer"]);

function getCompanyMemberLimit(certificationLevel: string | null | undefined) {
  return COMPANY_MEMBER_LIMITS[certificationLevel ?? "normal"] ?? 10;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";

  return normalized || null;
}

async function assertCanManageCompany(input: {
  userId: string;
  companyId: string;
  db: {
    companyMember: {
      findFirst(args: unknown): Promise<unknown>;
    };
  };
}) {
  const membership = await input.db.companyMember.findFirst({
    where: {
      userId: input.userId,
      companyId: input.companyId,
      status: "active",
      role: {
        in: ["owner", "admin"],
      },
    },
    select: {
      role: true,
    },
  });

  if (!membership) {
    throw new Error("Company management permission is required");
  }
}

export async function getWorkbenchAccountSettings(input: {
  userId: string;
  db?: WorkbenchAccountSettingsDb;
}): Promise<WorkbenchAccountSettings> {
  const db = (input.db ?? prisma) as WorkbenchAccountSettingsDb;
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      lastSeenAt: true,
      avatarUrl: true,
      avatarUpdatedAt: true,
      isSiteAdmin: true,
    },
  });

  if (!user) {
    throw new Error("Workbench account not found");
  }

  return user as WorkbenchAccountSettings;
}

export async function updateWorkbenchAccountProfile(input: {
  userId: string;
  name: string;
  db?: {
    user: {
      update(args: unknown): Promise<unknown>;
    };
  };
}) {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Account name is required");
  }

  const db = (input.db ?? prisma) as NonNullable<typeof input.db>;
  await db.user.update({
    where: { id: input.userId },
    data: { name },
  });
}

export async function getWorkbenchCompanyMemberships(input: {
  userId: string;
  db?: {
    companyMember: {
      findMany: typeof prisma.companyMember.findMany;
    };
  };
}): Promise<WorkbenchCompanyMembershipSettings[]> {
  const db = input.db ?? prisma;

  return db.companyMember.findMany({
    where: {
      userId: input.userId,
      status: "active",
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      company: {
        select: COMPANY_SELECT,
      },
    },
  }) as Promise<WorkbenchCompanyMembershipSettings[]>;
}

export async function getWorkbenchCompanyMembers(input: {
  userId: string;
  companyId?: string;
  db?: {
    companyMember: {
      findMany: typeof prisma.companyMember.findMany;
    };
  };
}): Promise<{
  company: WorkbenchCompanyMembershipSettings["company"] | null;
  members: WorkbenchCompanyMemberSettings[];
}> {
  const db = input.db ?? prisma;
  const memberships = (await db.companyMember.findMany({
    where: {
      userId: input.userId,
      status: "active",
      ...(input.companyId ? { companyId: input.companyId } : {}),
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 1,
    select: {
      company: {
        select: COMPANY_SELECT,
      },
    },
  })) as Array<{
    company: WorkbenchCompanyMembershipSettings["company"];
  }>;
  const company = memberships[0]?.company ?? null;

  if (!company) {
    return {
      company: null,
      members: [],
    };
  }

  const members = (await db.companyMember.findMany({
    where: {
      companyId: company.id,
      status: "active",
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      role: true,
      status: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          lastSeenAt: true,
        },
      },
    },
  })) as WorkbenchCompanyMemberSettings[];

  return {
    company,
    members,
  };
}

export async function listWorkbenchMcpCredentials(input: {
  userId: string;
  db?: {
    mcpCredential: {
      findMany: typeof prisma.mcpCredential.findMany;
    };
  };
}): Promise<WorkbenchMcpCredentialSettings[]> {
  const db = input.db ?? prisma;

  return db.mcpCredential.findMany({
    where: {
      userId: input.userId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      status: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true,
    },
  }) as Promise<WorkbenchMcpCredentialSettings[]>;
}

export async function revokeWorkbenchMcpCredential(input: {
  userId: string;
  credentialId: string;
  now?: Date;
  db?: {
    mcpCredential: {
      updateMany(args: unknown): Promise<{ count: number }>;
    };
  };
}) {
  const db = input.db ?? prisma;
  const result = await db.mcpCredential.updateMany({
    where: {
      id: input.credentialId,
      userId: input.userId,
      status: "active",
    },
    data: {
      status: "revoked",
      revokedAt: input.now ?? new Date(),
    },
  });

  if (result.count !== 1) {
    throw new Error("MCP credential not found");
  }
}

function normalizeWorkbenchCompanyName(value: string): string {
  return value.trim();
}

function slugifyWorkbenchCompanyName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "company";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

export async function createWorkbenchCompany(input: {
  userId: string;
  name: string;
  now?: Date;
  db?: WorkbenchCreateCompanyDb;
}): Promise<WorkbenchCreatedCompanySettings> {
  const name = normalizeWorkbenchCompanyName(input.name);

  if (!name) {
    throw new Error("Company name is required");
  }

  const db = input.db ?? (prisma as unknown as WorkbenchCreateCompanyDb);
  const now = input.now ?? new Date();
  const companyId = `company_${formatTimestamp(now)}_${randomUUID().slice(0, 8)}`;
  const slug = `${slugifyWorkbenchCompanyName(name)}-${shortHash(`${name}:${input.userId}`)}`;
  const membershipId = buildCompanyMembershipId(companyId, input.userId);

  return db.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        id: companyId,
        name,
        slug,
        status: "active",
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        description: true,
        logoUrl: true,
        certificationLevel: true,
        emailHost: true,
        emailPort: true,
        emailUsername: true,
        emailPassword: true,
      },
    });

    await tx.space.create({
      data: {
        id: buildCompanySpaceId(company.id),
        type: "company",
        ownerUserId: null,
        companyId: company.id,
        name: company.name,
        status: "active",
      },
      select: {
        id: true,
      },
    });

    const membership = await tx.companyMember.create({
      data: {
        id: membershipId,
        companyId: company.id,
        userId: input.userId,
        role: "owner",
        status: "active",
      },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    return {
      company,
      membership,
    };
  });
}

export async function changeWorkbenchPassword(input: {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  db?: {
    user: {
      findUnique(args: unknown): Promise<{
        id: string;
        passwordHash: string | null;
      } | null>;
    };
    $transaction<T>(callback: (tx: {
      user: { update(args: unknown): Promise<unknown> };
      webSession: { updateMany(args: unknown): Promise<{ count: number }> };
    }) => Promise<T>): Promise<T>;
  };
}): Promise<{ otherSessionsRevoked: number }> {
  const currentPassword = input.currentPassword.trim();
  const newPassword = input.newPassword.trim();
  const confirmPassword = input.confirmPassword.trim();

  if (!currentPassword) {
    throw new Error("Current password is required");
  }

  if (newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters");
  }

  if (newPassword !== confirmPassword) {
    throw new Error("Password confirmation does not match");
  }

  const db = (input.db ?? prisma) as NonNullable<typeof input.db>;
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      passwordHash: true,
    },
  });

  if (
    !user?.passwordHash ||
    !verifyPasswordHash({
      password: currentPassword,
      passwordHash: user.passwordHash,
    })
  ) {
    throw new Error("Current password is invalid");
  }

  const now = new Date();
  return db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { passwordHash: createPasswordHash(newPassword) },
    });
    const revoked = await tx.webSession.updateMany({
      where: {
        userId: input.userId,
        id: { not: input.currentSessionId },
        status: "active",
        revokedAt: null,
      },
      data: {
        status: "revoked",
        revokedAt: now,
        revokedReason: "password_changed",
      },
    });
    return { otherSessionsRevoked: revoked.count };
  });
}

export async function updateWorkbenchCompanyProfile(input: {
  userId: string;
  companyId: string;
  description?: string | null;
  logoUrl?: string | null | undefined;
  certificationLevel?: string | null;
  db?: {
    companyMember: {
      findFirst(args: unknown): Promise<{ role: string } | null>;
    };
    company: {
      update(args: unknown): Promise<unknown>;
    };
  };
}) {
  const db = input.db ?? prisma;
  await assertCanManageCompany({
    userId: input.userId,
    companyId: input.companyId,
    db,
  });

  const data: {
    description: string | null;
    logoUrl?: string | null;
    certificationLevel: string;
  } = {
    description: normalizeOptionalText(input.description),
    certificationLevel: normalizeOptionalText(input.certificationLevel) ?? "normal",
  };

  if (input.logoUrl !== undefined) {
    data.logoUrl = normalizeOptionalText(input.logoUrl);
  }

  await db.company.update({
    where: { id: input.companyId },
    data,
  });
}

export async function updateWorkbenchCompanyMailSettings(input: {
  userId: string;
  companyId: string;
  emailHost?: string | null;
  emailPort?: string | number | null;
  emailUsername?: string | null;
  emailPassword?: string | null | undefined;
  db?: {
    companyMember: {
      findFirst(args: unknown): Promise<{ role: string } | null>;
    };
    company: {
      update(args: unknown): Promise<unknown>;
    };
  };
}) {
  const db = input.db ?? prisma;
  await assertCanManageCompany({
    userId: input.userId,
    companyId: input.companyId,
    db,
  });

  const emailPortText = String(input.emailPort ?? "").trim();
  const emailPort = emailPortText ? Number(emailPortText) : null;

  if (emailPort !== null && (!Number.isInteger(emailPort) || emailPort <= 0)) {
    throw new Error("Email port is invalid");
  }

  const data: {
    emailHost: string | null;
    emailPort: number | null;
    emailUsername: string | null;
    emailPassword?: string | null;
  } = {
    emailHost: normalizeOptionalText(input.emailHost),
    emailPort,
    emailUsername: normalizeOptionalText(input.emailUsername),
  };

  if (normalizeOptionalText(input.emailPassword)) {
    data.emailPassword = normalizeOptionalText(input.emailPassword);
  }

  await db.company.update({
    where: { id: input.companyId },
    data,
  });
}

export async function inviteWorkbenchCompanyMember(input: {
  userId: string;
  companyId: string;
  email: string;
  role: string;
  now?: Date;
  db?: {
    companyMember: {
      findFirst(args: unknown): Promise<
        | { role: string }
        | {
            company: {
              certificationLevel: string;
            };
          }
        | null
      >;
      count(args: unknown): Promise<number>;
      upsert(args: unknown): Promise<unknown>;
    };
    user: {
      findFirst(args: unknown): Promise<{ id: string; email: string | null } | null>;
    };
    companyInvitation?: {
      upsert(args: unknown): Promise<{ id: string }>;
    };
  };
}) {
  const email = input.email.trim().toLowerCase();
  const role = input.role.trim() || "member";

  if (!email || !email.includes("@")) {
    throw new Error("Valid member email is required");
  }

  if (!COMPANY_ROLES.has(role) || role === "owner") {
    throw new Error("Unsupported company member role");
  }

  const db = input.db ?? prisma;
  await assertCanManageCompany({
    userId: input.userId,
    companyId: input.companyId,
    db,
  });

  const user = await db.user.findFirst({
    where: { email },
    select: { id: true, email: true },
  });

  const activeMemberCount = await db.companyMember.count({
    where: {
      companyId: input.companyId,
      status: "active",
    },
  });
  const companyRecord = await db.companyMember.findFirst({
    where: {
      companyId: input.companyId,
    },
    select: {
      company: {
        select: {
          certificationLevel: true,
        },
      },
    },
  }) as { company?: { certificationLevel?: string } } | null;
  const memberLimit = getCompanyMemberLimit(companyRecord?.company?.certificationLevel);

  if (activeMemberCount >= memberLimit) {
    throw new Error("Company member quota is full");
  }

  if (!user) {
    if (!db.companyInvitation) {
      throw new Error("Company invitation storage is unavailable");
    }

    const now = input.now ?? new Date();
    const invitation = await db.companyInvitation.upsert({
      where: {
        companyId_email: {
          companyId: input.companyId,
          email,
        },
      },
      create: {
        id: `invite_${randomUUID()}`,
        companyId: input.companyId,
        email,
        role,
        status: "pending",
        invitedById: input.userId,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
      update: {
        role,
        status: "pending",
        invitedById: input.userId,
        acceptedById: null,
        acceptedAt: null,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    return { status: "invited" as const, invitationId: invitation.id };
  }

  const membership = await db.companyMember.upsert({
    where: {
      companyId_userId: {
        companyId: input.companyId,
        userId: user.id,
      },
    },
    create: {
      id: buildCompanyMembershipId(input.companyId, user.id),
      companyId: input.companyId,
      userId: user.id,
      role,
      status: "active",
    },
    update: {
      role,
      status: "active",
    },
  });

  return { status: "active" as const, membership };
}

export async function updateWorkbenchCompanyMemberRole(input: {
  userId: string;
  companyId: string;
  memberId: string;
  role: string;
  db?: CompanyMemberMutationDependency;
}) {
  const role = input.role.trim();

  if (!COMPANY_ROLES.has(role)) {
    throw new Error("Unsupported company member role");
  }

  if (role === "owner") {
    throw new Error("Use company ownership transfer");
  }

  const db = (input.db ?? prisma) as CompanyMemberMutationDependency;

  return runCompanyMemberMutation(db, async (tx) => {
    await assertCanManageCompany({
      userId: input.userId,
      companyId: input.companyId,
      db: tx,
    });
    const target = await loadCompanyMemberForMutation({
      companyId: input.companyId,
      memberId: input.memberId,
      db: tx,
    });

    if (target.role === "owner" && role !== "owner") {
      await assertCompanyKeepsActiveOwner({ companyId: input.companyId, db: tx });
    }

    await tx.companyMember.update({
      where: { id: input.memberId },
      data: { role },
    });
  });
}

export async function removeWorkbenchCompanyMember(input: {
  userId: string;
  companyId: string;
  memberId: string;
  db?: CompanyMemberMutationDependency;
}) {
  const db = (input.db ?? prisma) as CompanyMemberMutationDependency;

  return runCompanyMemberMutation(db, async (tx) => {
    await assertCanManageCompany({
      userId: input.userId,
      companyId: input.companyId,
      db: tx,
    });

    const target = await loadCompanyMemberForMutation({
      companyId: input.companyId,
      memberId: input.memberId,
      db: tx,
    });

    if (target.userId === input.userId) {
      throw new Error("Cannot remove yourself from company management");
    }

    if (target.role === "owner") {
      await assertCompanyKeepsActiveOwner({ companyId: input.companyId, db: tx });
    }

    await tx.companyMember.update({
      where: { id: input.memberId },
      data: { status: "removed" },
    });
  });
}

export async function transferWorkbenchCompanyOwnership(input: {
  userId: string;
  companyId: string;
  targetMemberId: string;
  db?: {
    $transaction<T>(
      callback: (tx: CompanyMemberMutationDb) => Promise<T>,
      options?: { isolationLevel: "Serializable" },
    ): Promise<T>;
  };
}) {
  const db = input.db ?? (prisma as unknown as NonNullable<typeof input.db>);

  return db.$transaction(async (tx) => {
    const currentOwner = await tx.companyMember.findFirst({
      where: {
        companyId: input.companyId,
        userId: input.userId,
        role: "owner",
        status: "active",
      },
      select: { id: true, role: true },
    });

    if (!currentOwner?.id) {
      throw new Error("Company owner permission is required");
    }

    const target = await tx.companyMember.findFirst({
      where: {
        id: input.targetMemberId,
        companyId: input.companyId,
        status: "active",
      },
      select: { id: true, role: true, status: true },
    });

    if (!target?.id || target.id === currentOwner.id) {
      throw new Error("Company ownership target is invalid");
    }

    await tx.companyMember.update({
      where: { id: target.id },
      data: { role: "owner" },
    });
    await tx.companyMember.update({
      where: { id: currentOwner.id },
      data: { role: "admin" },
    });
  }, { isolationLevel: "Serializable" });
}

interface CompanyMemberMutationDb {
  companyMember: {
    findFirst(args: unknown): Promise<{
      id?: string;
      userId?: string;
      role: string;
      status?: string;
    } | null>;
    count?(args: unknown): Promise<number>;
    update(args: unknown): Promise<unknown>;
  };
}

type CompanyMemberMutationDependency =
  | CompanyMemberMutationDb
  | {
      $transaction<T>(
        callback: (tx: CompanyMemberMutationDb) => Promise<T>,
        options?: { isolationLevel: "Serializable" },
      ): Promise<T>;
    };

function runCompanyMemberMutation<T>(
  db: CompanyMemberMutationDependency,
  callback: (tx: CompanyMemberMutationDb) => Promise<T>,
): Promise<T> {
  return "$transaction" in db
    ? db.$transaction(callback, { isolationLevel: "Serializable" })
    : callback(db);
}

async function loadCompanyMemberForMutation(input: {
  companyId: string;
  memberId: string;
  db: CompanyMemberMutationDb;
}) {
  const member = await input.db.companyMember.findFirst({
    where: {
      id: input.memberId,
      companyId: input.companyId,
      status: "active",
    },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
    },
  });

  if (!member) {
    throw new Error("Company member not found");
  }

  return member;
}

async function assertCompanyKeepsActiveOwner(input: {
  companyId: string;
  db: CompanyMemberMutationDb;
}) {
  const count = input.db.companyMember.count;

  if (!count) {
    throw new Error("Company owner count is unavailable");
  }

  const activeOwnerCount = await count({
    where: {
      companyId: input.companyId,
      role: "owner",
      status: "active",
    },
  });

  if (activeOwnerCount <= 1) {
    throw new Error("Company must keep at least one active owner");
  }
}
