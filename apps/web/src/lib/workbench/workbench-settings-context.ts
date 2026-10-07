import { prisma } from "../../../../../packages/db/src/index";

export type WorkbenchCompanyRole = "owner" | "admin" | "member" | "viewer";

export interface WorkbenchSettingsContext {
  user: {
    id: string;
    name: string;
    email: string | null;
    avatarUrl: string | null;
    status: string;
  };
  companies: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    role: WorkbenchCompanyRole;
    canManage: boolean;
  }>;
  isSiteAdmin: boolean;
}

export interface WorkbenchCompanySettingsContext {
  company: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    status: string;
  };
  membership: {
    role: WorkbenchCompanyRole;
    canManageProfile: boolean;
    canManageMembers: boolean;
    canManageIntegrations: boolean;
    canTransferOwnership: boolean;
  };
}

export interface WorkbenchCompanySettingsDetails {
  context: WorkbenchCompanySettingsContext;
  profile: {
    description: string | null;
    certificationLevel: string;
  };
  members: Array<{
    id: string;
    role: WorkbenchCompanyRole;
    status: string;
    user: {
      id: string;
      name: string;
      email: string | null;
      status: string;
      lastSeenAt: Date | null;
    };
  }>;
  integration?: {
    emailHost: string | null;
    emailPort: number | null;
    emailUsername: string | null;
    hasPassword: boolean;
  };
}

interface SettingsContextDb {
  user: {
    findUnique(args: unknown): Promise<{
      id: string;
      name: string;
      email: string | null;
      avatarUrl: string | null;
      status: string;
      isSiteAdmin: boolean;
    } | null>;
  };
  companyMember: {
    findMany(args: unknown): Promise<Array<{
      role: string;
      company: {
        id: string;
        name: string;
        logoUrl: string | null;
      };
    }>>;
  };
}

interface CompanySettingsContextDb {
  companyMember: {
    findFirst(args: unknown): Promise<{
      role: string;
      company: {
        id: string;
        name: string;
        slug: string;
        logoUrl: string | null;
        status: string;
      };
    } | null>;
  };
}

interface CompanySettingsDetailsDb extends CompanySettingsContextDb {
  companyMember: CompanySettingsContextDb["companyMember"] & {
    findMany(args: unknown): Promise<Array<{
      id: string;
      role: string;
      status: string;
      user: {
        id: string;
        name: string;
        email: string | null;
        status: string;
        lastSeenAt: Date | null;
      };
    }>>;
  };
  company: {
    findUnique(args: unknown): Promise<{
      description: string | null;
      certificationLevel: string;
      emailHost?: string | null;
      emailPort?: number | null;
      emailUsername?: string | null;
      emailPassword?: string | null;
    } | null>;
  };
}

function asCompanyRole(role: string): WorkbenchCompanyRole {
  if (role === "owner" || role === "admin" || role === "member" || role === "viewer") {
    return role;
  }

  throw new Error("Unsupported company role");
}

export async function getWorkbenchSettingsContext(input: {
  userId: string;
  db?: SettingsContextDb;
}): Promise<WorkbenchSettingsContext> {
  const db = input.db ?? (prisma as unknown as SettingsContextDb);
  const [user, memberships] = await Promise.all([
    db.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        status: true,
        isSiteAdmin: true,
      },
    }),
    db.companyMember.findMany({
      where: {
        userId: input.userId,
        status: "active",
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        role: true,
        company: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
          },
        },
      },
    }),
  ]);

  if (!user) {
    throw new Error("Workbench account not found");
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      status: user.status,
    },
    companies: memberships.map((membership) => {
      const role = asCompanyRole(membership.role);

      return {
        id: membership.company.id,
        name: membership.company.name,
        logoUrl: membership.company.logoUrl,
        role,
        canManage: role === "owner" || role === "admin",
      };
    }),
    isSiteAdmin: user.isSiteAdmin,
  };
}

export async function getWorkbenchCompanySettingsContext(input: {
  userId: string;
  companyId: string;
  db?: CompanySettingsContextDb;
}): Promise<WorkbenchCompanySettingsContext | null> {
  const db = input.db ?? (prisma as unknown as CompanySettingsContextDb);
  const membership = await db.companyMember.findFirst({
    where: {
      userId: input.userId,
      companyId: input.companyId,
      status: "active",
    },
    select: {
      role: true,
      company: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          status: true,
        },
      },
    },
  });

  if (!membership) {
    return null;
  }

  const role = asCompanyRole(membership.role);
  const canManage = role === "owner" || role === "admin";

  return {
    company: {
      id: membership.company.id,
      name: membership.company.name,
      slug: membership.company.slug,
      logoUrl: membership.company.logoUrl,
      status: membership.company.status,
    },
    membership: {
      role,
      canManageProfile: canManage,
      canManageMembers: canManage,
      canManageIntegrations: canManage,
      canTransferOwnership: role === "owner",
    },
  };
}

export async function getWorkbenchCompanySettingsDetails(input: {
  userId: string;
  companyId: string;
  db?: CompanySettingsDetailsDb;
}): Promise<WorkbenchCompanySettingsDetails | null> {
  const db = input.db ?? (prisma as unknown as CompanySettingsDetailsDb);
  const context = await getWorkbenchCompanySettingsContext({
    userId: input.userId,
    companyId: input.companyId,
    db,
  });

  if (!context) {
    return null;
  }

  const canReadIntegration = context.membership.canManageIntegrations;
  const [company, members] = await Promise.all([
    db.company.findUnique({
      where: { id: input.companyId },
      select: {
        description: true,
        certificationLevel: true,
        ...(canReadIntegration
          ? {
              emailHost: true,
              emailPort: true,
              emailUsername: true,
              emailPassword: true,
            }
          : {}),
      },
    }),
    db.companyMember.findMany({
      where: { companyId: input.companyId, status: "active" },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        role: true,
        status: true,
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
    }),
  ]);

  if (!company) {
    return null;
  }

  return {
    context,
    profile: {
      description: company.description,
      certificationLevel: company.certificationLevel,
    },
    members: members.map((member) => ({
      ...member,
      role: asCompanyRole(member.role),
    })),
    ...(canReadIntegration
      ? {
          integration: {
            emailHost: company.emailHost ?? null,
            emailPort: company.emailPort ?? null,
            emailUsername: company.emailUsername ?? null,
            hasPassword: Boolean(company.emailPassword),
          },
        }
      : {}),
  };
}
