import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../../packages/db/src/index";
import type { TaskStatus } from "@humanthread/shared";
import {
  assertLegacyWorkflowTask,
  isLegacyWorkflowTask,
} from "../tasks/legacy-workflow-task";

const taskOverviewInclude = {
  workflowInstance: {
    include: {
      matterType: true,
    },
  },
  project: {
    include: {
      company: {
        select: {
          name: true,
        },
      },
    },
  },
  assignee: true,
    toolSessions: {
      where: {
        status: "active",
      },
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    take: 1,
  },
} satisfies Prisma.TaskInclude;

type PrismaTaskRecord = Prisma.TaskGetPayload<{
  include: typeof taskOverviewInclude;
}>;

export interface CurrentTaskForUserInput {
  db?: {
    task: {
      findMany: typeof prisma.task.findMany;
    };
  };
  teamId: string;
  userId: string;
  companyId?: string;
  ownerType?: "company" | "personal";
}

export interface UserTaskOverview {
  task: {
    id: string;
    status: TaskStatus;
    title: string;
    queuePosition: number;
    createdAt?: Date;
    updatedAt?: Date;
  };
  workflow: {
    id: string;
    title: string;
    status: string;
    currentStepKey: string;
    matterType: {
      id: string;
      name: string;
      description: string | null;
    };
  };
  project: {
    id: string;
    name: string;
    spaceLabel?: string;
    description: string | null;
    localPath: string | null;
    defaultCommand: string | null;
  };
  toolSession: {
    id: string;
    sessionType: string;
    sessionName: string;
    status: string;
    lastOutputSummary: string | null;
  } | null;
  assignee: {
    id: string;
    name: string;
    email: string | null;
    status: string;
    lastSeenAt: Date | null;
  };
}

export interface CurrentTaskForUserResult {
  teamId: string;
  userId: string;
  currentTask: UserTaskOverview | null;
  queueLength: number;
  queuedTasks: UserTaskOverview[];
}

function mapTaskRecordToOverview(task: PrismaTaskRecord): UserTaskOverview {
  assertLegacyWorkflowTask(task);
  if (!task.assignee) {
    throw new Error(`Task ${task.id} is missing an assignee.`);
  }

  return {
    task: {
      id: task.id,
      status: task.status as TaskStatus,
      title: task.title,
      queuePosition: task.queuePosition,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
    workflow: {
      id: task.workflowInstance.id,
      title: task.workflowInstance.title,
      status: task.workflowInstance.status,
      currentStepKey: task.workflowInstance.currentStepKey,
      matterType: {
        id: task.workflowInstance.matterType.id,
        name: task.workflowInstance.matterType.name,
        description: task.workflowInstance.matterType.description,
      },
    },
    project: {
      id: task.project.id,
      name: task.project.name,
      spaceLabel:
        task.project.ownerType === "personal"
          ? "个人空间"
          : (task.project.company?.name ?? "公司空间"),
      description: task.project.description,
      localPath: task.project.localPath,
      defaultCommand: task.project.defaultCommand,
    },
    toolSession: task.toolSessions?.[0]
      ? {
          id: task.toolSessions[0].id,
          sessionType: task.toolSessions[0].sessionType,
          sessionName: task.toolSessions[0].sessionName,
          status: task.toolSessions[0].status,
          lastOutputSummary: task.toolSessions[0].lastOutputSummary,
        }
      : null,
    assignee: {
      id: task.assignee.id,
      name: task.assignee.name,
      email: task.assignee.email,
      status: task.assignee.status,
      lastSeenAt: task.assignee.lastSeenAt,
    },
  };
}

function rankTaskStatus(status: string): number {
  if (status === "active") {
    return 0;
  }

  if (status === "pending") {
    return 1;
  }

  return 2;
}

function isOpenTaskStatus(status: string): boolean {
  return status === "active" || status === "pending";
}

function isWorkbenchInboxTaskStatus(status: string): boolean {
  return (
    status === "active" ||
    status === "pending" ||
    status === "blocked" ||
    status === "follow_up" ||
    status === "interrupted"
  );
}

function rankWorkbenchInboxTaskStatus(status: string): number {
  switch (status) {
    case "active":
      return 0;
    case "blocked":
      return 1;
    case "follow_up":
      return 2;
    case "interrupted":
      return 3;
    case "pending":
      return 4;
    default:
      return 5;
  }
}

function compareOpenTasks(left: PrismaTaskRecord, right: PrismaTaskRecord): number {
  const statusRankDiff = rankTaskStatus(left.status) - rankTaskStatus(right.status);

  if (statusRankDiff !== 0) {
    return statusRankDiff;
  }

  const createdAtDiff = right.createdAt.getTime() - left.createdAt.getTime();

  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return left.queuePosition - right.queuePosition;
}

function compareWorkbenchInboxTasks(
  left: PrismaTaskRecord,
  right: PrismaTaskRecord,
): number {
  const statusRankDiff =
    rankWorkbenchInboxTaskStatus(left.status) -
    rankWorkbenchInboxTaskStatus(right.status);

  if (statusRankDiff !== 0) {
    return statusRankDiff;
  }

  if (left.status === "pending" && right.status === "pending") {
    const queuePositionDiff = left.queuePosition - right.queuePosition;

    if (queuePositionDiff !== 0) {
      return queuePositionDiff;
    }
  }

  const updatedAtDiff = right.updatedAt.getTime() - left.updatedAt.getTime();

  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  return right.createdAt.getTime() - left.createdAt.getTime();
}

function buildProjectScopeWhere(input: {
  companyId?: string;
  ownerType?: "company" | "personal";
}): Prisma.ProjectWhereInput | undefined {
  if (!input.companyId && !input.ownerType) {
    return undefined;
  }

  return {
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ownerType: input.ownerType ?? (input.companyId ? "company" : "personal"),
  };
}

export async function getCurrentTaskForUser(
  input: CurrentTaskForUserInput,
): Promise<CurrentTaskForUserResult> {
  const projectScopeWhere = buildProjectScopeWhere(input);
  const taskRows = await (input.db ?? prisma).task.findMany({
    where: {
      teamId: input.teamId,
      assigneeUserId: input.userId,
      archivedAt: null,
      ...(projectScopeWhere ? { project: projectScopeWhere } : {}),
      status: {
        in: ["active", "pending"],
      },
    },
    orderBy: [
      {
        status: "asc",
      },
      {
        queuePosition: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    include: {
      ...taskOverviewInclude,
    },
  });

  const sortedTasks = taskRows
    .filter((task) => isOpenTaskStatus(task.status) && isLegacyWorkflowTask(task))
    .sort(compareOpenTasks);

  const currentTask = sortedTasks[0]
    ? mapTaskRecordToOverview(sortedTasks[0])
    : null;

  return {
    teamId: input.teamId,
    userId: input.userId,
    currentTask,
    queueLength: Math.max(sortedTasks.length - 1, 0),
    queuedTasks: sortedTasks.slice(1).map(mapTaskRecordToOverview),
  };
}

export async function listWorkbenchInboxTasks(
  input: CurrentTaskForUserInput,
): Promise<UserTaskOverview[]> {
  const projectScopeWhere = buildProjectScopeWhere(input);
  const taskRows = await (input.db ?? prisma).task.findMany({
    where: {
      teamId: input.teamId,
      assigneeUserId: input.userId,
      archivedAt: null,
      ...(projectScopeWhere ? { project: projectScopeWhere } : {}),
      status: {
        in: ["active", "pending", "blocked", "follow_up", "interrupted"],
      },
    },
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    include: {
      ...taskOverviewInclude,
    },
  });

  return taskRows
    .filter(
      (task) =>
        isWorkbenchInboxTaskStatus(task.status) && isLegacyWorkflowTask(task),
    )
    .sort(compareWorkbenchInboxTasks)
    .map(mapTaskRecordToOverview);
}

export interface TeamOverviewInput {
  db?: {
    team: {
      findUnique: typeof prisma.team.findUnique;
    };
    companyMember?: {
      findMany: typeof prisma.companyMember.findMany;
    };
    user: {
      findMany: typeof prisma.user.findMany;
    };
    task: {
      findMany: typeof prisma.task.findMany;
    };
  };
  teamId: string;
  userId?: string;
  companyId?: string;
  ownerType?: "company" | "personal";
}

export interface TeamMemberOverview {
  user: {
    id: string;
    name: string;
    email: string | null;
    status: string;
    lastSeenAt: Date | null;
  };
  currentTask: UserTaskOverview | null;
  queueLength: number;
}

export interface TeamOverviewResult {
  team: {
    id: string;
    name: string;
  } | null;
  members: TeamMemberOverview[];
}

const workflowTimelineEventInclude = {
  task: {
    select: {
      id: true,
      title: true,
      status: true,
      stepTemplateId: true,
    },
  },
} satisfies Prisma.TaskEventInclude;

type PrismaTaskEventRecord = Prisma.TaskEventGetPayload<{
  include: typeof workflowTimelineEventInclude;
}>;

export interface WorkflowTimelineInput {
  db?: {
    workflowInstance: {
      findUnique: typeof prisma.workflowInstance.findUnique;
    };
    taskEvent: {
      findMany: typeof prisma.taskEvent.findMany;
    };
  };
  workflowId: string;
}

export interface WorkflowTimelineEvent {
  id: string;
  taskId: string;
  workflowInstanceId: string;
  type: string;
  actorType: string;
  actorUserId: string | null;
  message: string | null;
  payload: unknown;
  createdAt: Date;
  task: {
    id: string;
    title: string;
    status: string;
    stepTemplateId: string;
  };
}

export interface WorkflowTimelineResult {
  workflow: {
    id: string;
    projectId: string;
    matterTypeId: string;
    workflowTemplateId: string;
    title: string;
    description: string | null;
    status: string;
    currentStepKey: string;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  events: WorkflowTimelineEvent[];
}

function mapWorkflowTimelineEvent(
  event: PrismaTaskEventRecord,
): WorkflowTimelineEvent {
  assertLegacyWorkflowTask(event.task);
  return {
    id: event.id,
    taskId: event.taskId,
    workflowInstanceId: event.workflowInstanceId,
    type: event.type,
    actorType: event.actorType,
    actorUserId: event.actorUserId,
    message: event.message,
    payload: event.payload,
    createdAt: event.createdAt,
    task: {
      id: event.task.id,
      title: event.task.title,
      status: event.task.status,
      stepTemplateId: event.task.stepTemplateId,
    },
  };
}

async function resolveTeamOverviewVisibleUserIds(input: {
  db: NonNullable<TeamOverviewInput["db"]> | typeof prisma;
  userId?: string;
  companyId?: string;
  ownerType?: "company" | "personal";
}): Promise<string[] | null> {
  if (!input.userId) {
    return null;
  }

  if (input.ownerType === "personal") {
    return [input.userId];
  }

  if (!input.db.companyMember) {
    return [input.userId];
  }

  const memberships = await input.db.companyMember.findMany({
    where: input.companyId
      ? {
          companyId: input.companyId,
          status: "active",
          company: {
            members: {
              some: {
                userId: input.userId,
                status: "active",
              },
            },
          },
        }
      : {
          status: "active",
          OR: [
            {
              userId: input.userId,
            },
            {
              company: {
                members: {
                  some: {
                    userId: input.userId,
                    status: "active",
                  },
                },
              },
            },
          ],
        },
    select: {
      userId: true,
    },
  });

  if (input.companyId) {
    return [...new Set(memberships.map((membership) => membership.userId))];
  }

  return [
    ...new Set([
      input.userId,
      ...memberships.map((membership) => membership.userId),
    ]),
  ];
}

export async function getTeamOverview(
  input: TeamOverviewInput,
): Promise<TeamOverviewResult> {
  const db = input.db ?? prisma;
  const projectScopeWhere = buildProjectScopeWhere(input);
  const visibleUserIds = await resolveTeamOverviewVisibleUserIds({
    db,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.ownerType ? { ownerType: input.ownerType } : {}),
  });
  const [team, users, tasks] = await Promise.all([
    db.team.findUnique({
      where: { id: input.teamId },
      select: {
        id: true,
        name: true,
      },
    }),
    db.user.findMany({
      where: {
        teamId: input.teamId,
        ...(visibleUserIds ? { id: { in: visibleUserIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        lastSeenAt: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
    db.task.findMany({
      where: {
        teamId: input.teamId,
        archivedAt: null,
        ...(projectScopeWhere ? { project: projectScopeWhere } : {}),
        status: {
          in: ["active", "pending"],
        },
        assigneeUserId: visibleUserIds
          ? {
              in: visibleUserIds,
            }
          : {
              not: null,
            },
      },
      orderBy: [
        {
          assigneeUserId: "asc",
        },
        {
          status: "asc",
        },
        {
          queuePosition: "asc",
        },
      ],
      include: {
        ...taskOverviewInclude,
      },
    }),
  ]);

  const tasksByUserId = new Map<string, PrismaTaskRecord[]>();

  for (const task of tasks) {
    if (!task.assigneeUserId) {
      continue;
    }

    const current = tasksByUserId.get(task.assigneeUserId) ?? [];
    current.push(task);
    tasksByUserId.set(task.assigneeUserId, current);
  }

  return {
    team,
    members: users.map((user) => {
      const userTasks = (tasksByUserId.get(user.id) ?? [])
        .filter((task) => isOpenTaskStatus(task.status) && isLegacyWorkflowTask(task))
        .sort(compareOpenTasks);

      return {
        user,
        currentTask: userTasks[0] ? mapTaskRecordToOverview(userTasks[0]) : null,
        queueLength: Math.max(userTasks.length - 1, 0),
      };
    }),
  };
}

export async function getWorkflowTimeline(
  input: WorkflowTimelineInput,
): Promise<WorkflowTimelineResult> {
  const db = input.db ?? prisma;
  const workflow = await db.workflowInstance.findUnique({
    where: { id: input.workflowId },
    select: {
      id: true,
      projectId: true,
      matterTypeId: true,
      workflowTemplateId: true,
      title: true,
      description: true,
      status: true,
      currentStepKey: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!workflow) {
    return {
      workflow: null,
      events: [],
    };
  }

  const events = await db.taskEvent.findMany({
    where: {
      workflowInstanceId: input.workflowId,
    },
    orderBy: [
      {
        createdAt: "asc",
      },
      {
        id: "asc",
      },
    ],
    include: {
      ...workflowTimelineEventInclude,
    },
  });

  return {
    workflow,
    events: events.map(mapWorkflowTimelineEvent),
  };
}
