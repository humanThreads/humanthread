import {
  buildAccessibleProjectWhere,
  prisma,
} from "../../../../../packages/db/src/index";

export interface WorkbenchContext {
  teamId: string;
  userId: string;
  projectId: string;
  matterTypeId: string;
}

export const WORKBENCH_USER_COOKIE = "ht_workbench_user_id";
export const WORKBENCH_LOGIN_EMAIL_COOKIE = "ht_workbench_login_email";

export interface WorkbenchContextInput {
  selectedUserId?: string;
  selectedUserEmail?: string;
  companyId?: string;
  ownerType?: "company" | "personal";
  db?: {
    user: {
      findUnique: typeof prisma.user.findUnique;
      findFirst: typeof prisma.user.findFirst;
    };
    project: {
      findFirst: typeof prisma.project.findFirst;
    };
    matterType: {
      findFirst: typeof prisma.matterType.findFirst;
    };
  };
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();

  return normalized ? normalized : undefined;
}

async function loadWorkbenchDefaults(input: {
  db: NonNullable<WorkbenchContextInput["db"]>;
  user: {
    id: string;
    teamId: string;
  };
  companyId?: string;
  ownerType?: "company" | "personal";
}): Promise<WorkbenchContext> {
  const [project, matterType] = await Promise.all([
    input.db.project.findFirst({
      where: {
        teamId: input.user.teamId,
        AND: [
          buildAccessibleProjectWhere({
            userId: input.user.id,
            ...(input.companyId ? { companyId: input.companyId } : {}),
            ...(input.ownerType ? { ownerType: input.ownerType } : {}),
          }),
        ],
      },
      orderBy: [
        {
          ownerType: "desc",
        },
        {
          createdAt: "asc",
        },
      ],
      select: {
        id: true,
      },
    }),
    input.db.matterType.findFirst({
      where: {
        teamId: input.user.teamId,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (!project) {
    throw new Error(`No workbench project found for team ${input.user.teamId}`);
  }

  if (!matterType) {
    throw new Error(`No workbench matter type found for team ${input.user.teamId}`);
  }

  return {
    teamId: input.user.teamId,
    userId: input.user.id,
    projectId: project.id,
    matterTypeId: matterType.id,
  };
}

export async function getWorkbenchContext(
  input: WorkbenchContextInput = {},
): Promise<WorkbenchContext> {
  const db = input.db ?? prisma;
  const selectedUserId = input.selectedUserId?.trim();
  const selectedUserEmail = normalizeEmail(input.selectedUserEmail);
  const companyId = input.companyId?.trim() || undefined;
  const ownerType = input.ownerType;

  if (selectedUserId) {
    const selectedUser = await db.user.findUnique({
        where: {
          id: selectedUserId,
        },
        select: {
          id: true,
          teamId: true,
          status: true,
        },
      });

    if (!selectedUser || selectedUser.status !== "active") {
      throw new Error("Workbench user is unavailable");
    }

    return loadWorkbenchDefaults({
      db,
      user: selectedUser,
      ...(companyId ? { companyId } : {}),
      ...(ownerType ? { ownerType } : {}),
    });
  }

  if (selectedUserEmail) {
    const selectedUser = await db.user.findFirst({
      where: {
        email: selectedUserEmail,
        status: "active",
      },
      select: {
        id: true,
        teamId: true,
        status: true,
      },
    });

    if (!selectedUser || selectedUser.status !== "active") {
      throw new Error("Workbench user is unavailable");
    }

    return loadWorkbenchDefaults({
      db,
      user: selectedUser,
      ...(companyId ? { companyId } : {}),
      ...(ownerType ? { ownerType } : {}),
    });
  }

  const user = await db.user.findFirst({
    where: {
      status: "active",
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      teamId: true,
    },
  });

  if (!user) {
    throw new Error("No active workbench user found");
  }

  return loadWorkbenchDefaults({
    db,
    user,
    ...(companyId ? { companyId } : {}),
    ...(ownerType ? { ownerType } : {}),
  });
}
