import { type Prisma } from "@prisma/client";
import {
  assertCanWriteProject,
  buildAccessibleProjectWhere,
  prisma,
} from "../../../../../packages/db/src/index";

export interface WorkbenchProjectOverview {
  id: string;
  spaceId: string | null;
  name: string;
  description: string | null;
  localPath: string | null;
  defaultCommand: string | null;
  updatedAt: Date;
  activeWorkflowCount: number;
  milestones: Array<{ id: string; name: string }>;
}

export interface WorkbenchProjectDetail extends WorkbenchProjectOverview {
  objective: string | null;
  orchestrationStatus: string;
  stages: Array<{ id: string; name: string; status: string; completedMilestones: number; totalMilestones: number }>;
  milestones: Array<{ id: string; name: string; status: string; riskSummary: string | null }>;
  ownerType: string;
  visibility: string;
  company: {
    id: string;
    name: string;
  } | null;
  ownerUser: {
    id: string;
    name: string;
  } | null;
  activeWorkflows: Array<{
    id: string;
    title: string;
    status: string;
    currentStepKey: string;
    updatedAt: Date;
  }>;
  recentTasks: Array<{
    id: string;
    title: string;
    status: string;
    updatedAt: Date;
    assigneeName: string | null;
    priority: number;
    milestoneId: string | null;
  }>;
}

interface ProjectRow {
  id: string;
  spaceId: string | null;
  name: string;
  description: string | null;
  localPath: string | null;
  defaultCommand: string | null;
  updatedAt: Date;
  workflowInstances: Array<{
    id: string;
  }>;
  milestones?: Array<{ id: string; name: string }>;
}

interface ProjectDetailRow {
  id: string;
  spaceId: string | null;
  name: string;
  description: string | null;
  objective?: string | null;
  orchestrationStatus?: string | null;
  ownerType: string;
  visibility: string;
  localPath: string | null;
  defaultCommand: string | null;
  updatedAt: Date;
  company: {
    id: string;
    name: string;
  } | null;
  ownerUser: {
    id: string;
    name: string;
  } | null;
  workflowInstances: Array<{
    id: string;
    title: string;
    status: string;
    currentStepKey: string;
    updatedAt: Date;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority?: number;
    milestoneId?: string | null;
    updatedAt: Date;
    assignee: {
      id: string;
      name: string;
    } | null;
  }>;
  stages?: Array<{ id: string; key?: string; name: string; status: string; milestones: Array<{ status: string }> }>;
  milestones?: Array<{ id: string; name: string; status: string; riskSummary: string | null }>;
}

export interface GetWorkbenchProjectsInput {
  teamId?: string;
  userId?: string;
  companyId?: string;
  ownerType?: "company" | "personal";
  db?: {
    project: {
      findMany: typeof prisma.project.findMany;
    };
  };
}

export interface GetWorkbenchProjectDetailInput {
  projectId: string;
  userId: string;
  db?: {
    project: {
      findFirst: typeof prisma.project.findFirst;
    };
  };
}

export type ProjectHealth = "healthy" | "at_risk" | "blocked" | "complete" | "unknown";

export interface ProjectListItem {
  id: string;
  version?: number;
  shortCode?: string | null;
  spaceId: string;
  spaceLabel: string;
  name: string;
  objectiveExcerpt: string | null;
  owner: { id: string; name: string } | null;
  status: string;
  health: ProjectHealth;
  stageProgress: { completed: number; total: number; percent: number };
  openTaskCount: number;
  overdueTaskCount: number;
  blockedTaskCount: number;
  nextMilestone: { id: string; name: string; targetAt: Date | null; status: string } | null;
  updatedAt: Date;
}

export interface ProjectHubView {
  project: ProjectListItem & {
    version: number;
    description: string | null;
    startAt: Date | null;
    targetAt: Date | null;
    visibility: string;
    developmentTemplateKey: string | null;
    developmentTemplateVersion: number | null;
    developmentTemplateConfig: unknown;
    loopGroupConfig: unknown;
    productionBranch: string | null;
    stagingBranch: string | null;
    releaseAgentProfileId: string | null;
    environmentConfiguration: unknown;
    environmentConfigurationVersion: number;
    repositoryConfiguration: unknown;
    workerDeploymentConfiguration: unknown;
    developmentLoopVersionId: string | null;
    releaseLoopVersionId: string | null;
    capabilities: { edit: boolean; manageMembers: boolean; changeLifecycle: boolean; manageRoadmap: boolean };
  };
  roadmap: Array<{
    id: string;
    version: number;
    sortOrder: number;
    name: string;
    status: string;
    publicationStatus?: string;
    startAt: Date | null;
    targetAt: Date | null;
    completedMilestones: number;
    totalMilestones: number;
    milestones: Array<{ id: string; version: number; sortOrder: number; name: string; status: string; targetAt: Date | null; riskSummary: string | null; taskCount: number; tasks: Array<{ id: string; title: string; status: string; statusCategory?: string; publicationStatus?: string; version: number }> }>;
  }>;
  health: { objectiveState: "complete" | "missing"; currentStageName: string | null; nextAction: string; blockers: number; overdueTasks: number };
  resources: { documents: number; members: number; activities: number; automationState: string };
  taskSummary: { total: number; open: number; overdue: number; blocked: number; completed: number };
}

interface ProjectProjectionTask {
  id?: string;
  title?: string;
  status?: string;
  version?: number;
  statusCategory: string;
  dueAt: Date | null;
  blockers: Array<{ status: string }>;
  publicationStatus?: string;
}

interface ProjectProjectionStage {
  id: string;
  key?: string;
  name?: string;
  status: string;
  publicationStatus?: string;
  sortOrder?: number;
  version?: number;
  startedAt?: Date | null;
  startAt?: Date | null;
  targetAt?: Date | null;
  milestones: Array<{
    id?: string;
    name?: string;
    status: string;
    sortOrder?: number;
    version?: number;
    riskSummary?: string | null;
    targetAt?: Date | null;
    tasks?: ProjectProjectionTask[];
  }>;
}

interface ProjectProjectionRow {
  id: string;
  version?: number;
  shortCode?: string | null;
  spaceId: string | null;
  name: string;
  description: string | null;
  objective?: string | null;
  ownerType: string;
  visibility: string;
  orchestrationStatus?: string | null;
  managerUserId?: string | null;
  ownerUser?: { id: string; name: string } | null;
  space?: { name: string } | null;
  startAt?: Date | null;
  targetAt?: Date | null;
  updatedAt: Date;
  developmentTemplateKey?: string | null;
  developmentTemplateVersion?: number | null;
  developmentTemplateConfig?: unknown;
  loopGroupConfig?: unknown;
  productionBranch?: string | null;
  stagingBranch?: string | null;
  releaseAgentProfileId?: string | null;
  environmentConfiguration?: unknown;
  environmentConfigurationVersion?: number;
  repositoryConfiguration?: unknown;
  workerDeploymentConfiguration?: unknown;
  loopBindings?: Array<{ bindingRole: string; activeVersionId: string }>;
  stages: ProjectProjectionStage[];
  milestones: Array<{ id: string; name: string; status: string; targetAt: Date | null; riskSummary?: string | null }>;
  tasks: ProjectProjectionTask[];
  members?: Array<{ id: string }>;
  documents?: Array<{ id: string }>;
  workflowInstances?: Array<{ id: string }>;
}

interface ProjectProjectionDb {
  project: {
    findMany: typeof prisma.project.findMany;
    findFirst: typeof prisma.project.findFirst;
  };
  user?: { findMany: typeof prisma.user.findMany };
}

function projectTaskSummary(tasks: ProjectProjectionTask[], now: Date) {
  const completed = tasks.filter((task) => task.statusCategory === "completed").length;
  const overdue = tasks.filter((task) => task.statusCategory !== "completed" && task.dueAt && task.dueAt < now).length;
  const blocked = tasks.filter((task) => task.blockers.some((blocker) => blocker.status === "active")).length;
  return { total: tasks.length, open: tasks.length - completed, overdue, blocked, completed };
}

async function managerNames(db: ProjectProjectionDb, ids: string[]) {
  if (!db.user || ids.length === 0) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

function projectOwner(project: ProjectProjectionRow, names: Map<string, string>) {
  const id = project.managerUserId ?? project.ownerUser?.id ?? null;
  if (!id) return null;
  return { id, name: names.get(id) ?? project.ownerUser?.name ?? "未设置负责人" };
}

function projectHealth(project: ProjectProjectionRow, summary: ReturnType<typeof projectTaskSummary>): ProjectHealth {
  if (["completed", "archived"].includes(project.orchestrationStatus ?? "")) return "complete";
  if (summary.blocked > 0) return "blocked";
  if (summary.overdue > 0 || project.milestones.some((milestone) => milestone.status === "at_risk")) return "at_risk";
  return "healthy";
}

function stageProgress(stages: ProjectProjectionStage[]) {
  const total = stages.reduce((sum, stage) => sum + stage.milestones.length, 0);
  const completed = stages.reduce((sum, stage) => sum + stage.milestones.filter((milestone) => milestone.status === "completed").length, 0);
  return { completed, total, percent: total === 0 ? 0 : Math.round(completed / total * 100) };
}

function projectStageName(stage: Pick<ProjectProjectionStage, "key" | "name">): string {
  return stage.key === "legacy_delivery" ? "当前交付阶段" : stage.name ?? "未命名阶段";
}

function projectMilestoneName(milestone: { id?: string; name?: string }): string {
  return milestone.id?.startsWith("milestone:legacy:") ? "待规划工作" : milestone.name ?? "未命名里程碑";
}

function nextDeliveryMilestone(stages: ProjectProjectionStage[]) {
  for (const stage of stages) {
    const milestone = stage.milestones.find((item) => !["completed", "cancelled"].includes(item.status));
    if (milestone) {
      return {
        id: milestone.id ?? `${stage.id}:milestone`,
        name: projectMilestoneName(milestone),
        status: milestone.status,
        targetAt: milestone.targetAt ?? null,
      };
    }
  }
  return null;
}

async function canWriteProject(userId: string, projectId: string): Promise<boolean> {
  try {
    await assertCanWriteProject({ userId, projectId });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("access denied")) return false;
    throw error;
  }
}

function projectSelect(): Prisma.ProjectSelect {
  return {
    id: true,
    version: true,
    shortCode: true,
    spaceId: true,
    name: true,
    description: true,
    objective: true,
    ownerType: true,
    visibility: true,
    orchestrationStatus: true,
    managerUserId: true,
    ownerUser: { select: { id: true, name: true } },
    space: { select: { name: true } },
    startAt: true,
    targetAt: true,
    developmentTemplateKey: true,
    developmentTemplateVersion: true,
    developmentTemplateConfig: true,
    loopGroupConfig: true,
    productionBranch: true,
    stagingBranch: true,
    releaseAgentProfileId: true,
    environmentConfiguration: true,
    environmentConfigurationVersion: true,
    repositoryConfiguration: true,
    workerDeploymentConfiguration: true,
    loopBindings: { where: { bindingRole: { in: ["task_development", "milestone_release"] } }, select: { bindingRole: true, activeVersionId: true } },
    updatedAt: true,
    stages: { orderBy: { sortOrder: "asc" }, select: { id: true, key: true, name: true, status: true, publicationStatus: true, sortOrder: true, version: true, startedAt: true, startAt: true, targetAt: true, milestones: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, status: true, sortOrder: true, version: true, targetAt: true, riskSummary: true, tasks: { orderBy: { updatedAt: "desc" }, select: { id: true, title: true, status: true, version: true, statusCategory: true, dueAt: true, publicationStatus: true, blockers: { select: { status: true } } } } } } } },
    milestones: { orderBy: { targetAt: "asc" }, select: { id: true, name: true, status: true, targetAt: true, riskSummary: true } },
    tasks: { select: { statusCategory: true, dueAt: true, blockers: { select: { status: true } } } },
    members: { select: { id: true } },
    documents: { where: { deletedAt: null }, select: { id: true } },
    workflowInstances: { where: { status: { in: ["active", "pending"] } }, select: { id: true } },
  };
}

export async function getProjectListItems(input: {
  userId: string;
  companyId?: string;
  ownerType?: "company" | "personal";
  search?: string;
  status?: string;
  health?: ProjectHealth;
  now?: Date;
  db?: { project: { findMany: typeof prisma.project.findMany }; user?: { findMany: typeof prisma.user.findMany } };
}): Promise<ProjectListItem[]> {
  const db = input.db ?? prisma;
  const where: Prisma.ProjectWhereInput = buildAccessibleProjectWhere({ userId: input.userId, ...(input.companyId ? { companyId: input.companyId } : {}), ...(input.ownerType ? { ownerType: input.ownerType } : {}) }) as Prisma.ProjectWhereInput;
  const rows = await db.project.findMany({ where, orderBy: [{ updatedAt: "desc" }, { name: "asc" }], select: projectSelect() }) as unknown as ProjectProjectionRow[];
  const names = await managerNames(db as ProjectProjectionDb, rows.flatMap((row) => row.managerUserId ? [row.managerUserId] : []));
  const now = input.now ?? new Date();
  return rows.map((project) => {
    const summary = projectTaskSummary(project.tasks, now);
    const progress = stageProgress(project.stages);
    const nextMilestone = nextDeliveryMilestone(project.stages);
    return {
      id: project.id,
      version: project.version ?? 1,
      shortCode: project.shortCode ?? null,
      spaceId: project.spaceId ?? "",
      spaceLabel: project.space?.name ?? "未知空间",
      name: project.name,
      objectiveExcerpt: project.objective ?? project.description,
      owner: projectOwner(project, names),
      status: project.orchestrationStatus ?? "draft",
      health: projectHealth(project, summary),
      stageProgress: progress,
      openTaskCount: summary.open,
      overdueTaskCount: summary.overdue,
      blockedTaskCount: summary.blocked,
      nextMilestone,
      updatedAt: project.updatedAt,
    };
  }).filter((project) => (!input.search || `${project.name} ${project.objectiveExcerpt ?? ""}`.toLowerCase().includes(input.search.toLowerCase())) && (!input.status || project.status === input.status) && (!input.health || project.health === input.health));
}

export async function getProjectHubView(input: { projectId: string; userId: string; now?: Date; db?: { project: { findFirst: typeof prisma.project.findFirst }; user?: { findMany: typeof prisma.user.findMany } }; canWriteProject?: (input: { userId: string; projectId: string }) => Promise<boolean> }): Promise<ProjectHubView | null> {
  const db = input.db ?? prisma;
  const row = await db.project.findFirst({ where: { id: input.projectId, AND: [buildAccessibleProjectWhere({ userId: input.userId })] }, select: projectSelect() }) as unknown as ProjectProjectionRow | null;
  if (!row) return null;
  const names = await managerNames(db as ProjectProjectionDb, row.managerUserId ? [row.managerUserId] : []);
  const now = input.now ?? new Date();
  const summary = projectTaskSummary(row.tasks, now);
  const progress = stageProgress(row.stages);
  const health = projectHealth(row, summary);
  const roadmap = row.stages.map((stage, stageIndex) => ({ id: stage.id, version: stage.version ?? 1, sortOrder: stage.sortOrder ?? stageIndex, name: projectStageName(stage), status: stage.status, publicationStatus: stage.publicationStatus ?? "unreleased", startAt: stage.startAt ?? stage.startedAt ?? null, targetAt: stage.targetAt ?? null, completedMilestones: stage.milestones.filter((milestone) => milestone.status === "completed").length, totalMilestones: stage.milestones.length, milestones: stage.milestones.map((milestone, milestoneIndex) => ({ id: milestone.id ?? `${stage.id}:milestone`, version: milestone.version ?? 1, sortOrder: milestone.sortOrder ?? milestoneIndex, name: projectMilestoneName(milestone), status: milestone.status, targetAt: milestone.targetAt ?? null, riskSummary: milestone.riskSummary ?? null, taskCount: milestone.tasks?.length ?? 0, tasks: (milestone.tasks ?? []).flatMap((task) => task.id && task.title && task.status ? [{ id: task.id, title: task.title, status: task.status, ...(task.statusCategory === undefined ? {} : { statusCategory: task.statusCategory }), publicationStatus: task.publicationStatus ?? "unreleased", version: task.version ?? 1 }] : []) })) }));
  const owner = projectOwner(row, names);
  const canWrite = await (input.canWriteProject ?? ((scope) => canWriteProject(scope.userId, scope.projectId)))({ userId: input.userId, projectId: input.projectId });
  const nextMilestone = nextDeliveryMilestone(row.stages);
  return {
    project: { id: row.id, version: row.version ?? 1, shortCode: row.shortCode ?? null, spaceId: row.spaceId ?? "", spaceLabel: row.space?.name ?? "未知空间", name: row.name, objectiveExcerpt: row.objective ?? row.description, owner, status: row.orchestrationStatus ?? "draft", health, stageProgress: progress, openTaskCount: summary.open, overdueTaskCount: summary.overdue, blockedTaskCount: summary.blocked, nextMilestone, updatedAt: row.updatedAt, description: row.description, startAt: row.startAt ?? null, targetAt: row.targetAt ?? null, visibility: row.visibility, developmentTemplateKey: row.developmentTemplateKey ?? null, developmentTemplateVersion: row.developmentTemplateVersion ?? null, developmentTemplateConfig: row.developmentTemplateConfig ?? null, loopGroupConfig: row.loopGroupConfig ?? null, productionBranch: row.productionBranch ?? null, stagingBranch: row.stagingBranch ?? null, releaseAgentProfileId: row.releaseAgentProfileId ?? null, environmentConfiguration: row.environmentConfiguration ?? null, environmentConfigurationVersion: row.environmentConfigurationVersion ?? 1, repositoryConfiguration: row.repositoryConfiguration ?? null, workerDeploymentConfiguration: row.workerDeploymentConfiguration ?? null, developmentLoopVersionId: row.loopBindings?.find((binding) => binding.bindingRole === "task_development")?.activeVersionId ?? null, releaseLoopVersionId: row.loopBindings?.find((binding) => binding.bindingRole === "milestone_release")?.activeVersionId ?? null, capabilities: { edit: canWrite, manageMembers: canWrite, changeLifecycle: canWrite, manageRoadmap: canWrite } },
    roadmap,
    health: { objectiveState: row.objective?.trim() ? "complete" : "missing", currentStageName: row.stages.find((stage) => ["active", "at_risk"].includes(stage.status)) ? projectStageName(row.stages.find((stage) => ["active", "at_risk"].includes(stage.status))!) : null, nextAction: row.objective?.trim() ? (summary.blocked > 0 ? "处理阻塞任务" : summary.overdue > 0 ? "处理逾期任务" : "推进下一交付节点") : "补充项目目标", blockers: summary.blocked, overdueTasks: summary.overdue },
    resources: { documents: row.documents?.length ?? 0, members: row.members?.length ?? 0, activities: 0, automationState: row.workflowInstances?.length ? "已自动化" : "未自动化" },
    taskSummary: summary,
  };
}

export async function getWorkbenchProjects(
  input: GetWorkbenchProjectsInput,
): Promise<WorkbenchProjectOverview[]> {
  const db = input.db ?? prisma;
  const where: Prisma.ProjectWhereInput =
    input.userId && input.userId.trim().length > 0
      ? (buildAccessibleProjectWhere({
          userId: input.userId,
          ...(input.companyId ? { companyId: input.companyId } : {}),
          ...(input.ownerType ? { ownerType: input.ownerType } : {}),
        }) as Prisma.ProjectWhereInput)
      : {
          ...(input.teamId ? { teamId: input.teamId } : {}),
        };
  const projects = (await db.project.findMany({
    where,
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        name: "asc",
      },
    ],
    select: {
      id: true,
      spaceId: true,
      name: true,
      description: true,
      objective: true,
      orchestrationStatus: true,
      localPath: true,
      defaultCommand: true,
      updatedAt: true,
      workflowInstances: {
        where: {
          status: {
            in: ["active", "pending"],
          },
        },
        select: {
          id: true,
        },
      },
      milestones: {
        orderBy: { targetAt: "asc" },
        select: { id: true, name: true },
      },
    },
  })) as unknown as ProjectRow[];

  return projects.map((project) => ({
    id: project.id,
    spaceId: project.spaceId,
    name: project.name,
    description: project.description,
    localPath: project.localPath,
    defaultCommand: project.defaultCommand,
    updatedAt: project.updatedAt,
    activeWorkflowCount: project.workflowInstances.length,
    milestones: (project.milestones ?? []).map((milestone) => ({ ...milestone, name: projectMilestoneName(milestone) })),
  }));
}

export async function getWorkbenchProjectDetail(
  input: GetWorkbenchProjectDetailInput,
): Promise<WorkbenchProjectDetail | null> {
  const db = input.db ?? prisma;
  const project = (await db.project.findFirst({
    where: {
      id: input.projectId,
      AND: [buildAccessibleProjectWhere({ userId: input.userId })],
    },
    select: {
      id: true,
      spaceId: true,
      name: true,
      description: true,
      objective: true,
      orchestrationStatus: true,
      ownerType: true,
      visibility: true,
      localPath: true,
      defaultCommand: true,
      updatedAt: true,
      company: {
        select: {
          id: true,
          name: true,
        },
      },
      ownerUser: {
        select: {
          id: true,
          name: true,
        },
      },
      workflowInstances: {
        where: {
          status: {
            in: ["active", "pending"],
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 8,
        select: {
          id: true,
          title: true,
          status: true,
          currentStepKey: true,
          updatedAt: true,
        },
      },
      tasks: {
        orderBy: {
          updatedAt: "desc",
        },
        take: 8,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          milestoneId: true,
          updatedAt: true,
          assignee: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      stages: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, key: true, name: true, status: true, milestones: { select: { status: true } } },
      },
      milestones: {
        orderBy: { targetAt: "asc" },
        select: { id: true, name: true, status: true, riskSummary: true },
      },
    },
  })) as ProjectDetailRow | null;

  if (!project) {
    return null;
  }

  return {
    id: project.id,
    spaceId: project.spaceId,
    name: project.name,
    description: project.description,
    objective: project.objective ?? project.description,
    orchestrationStatus: project.orchestrationStatus ?? "draft",
    localPath: project.localPath,
    defaultCommand: project.defaultCommand,
    updatedAt: project.updatedAt,
    ownerType: project.ownerType,
    visibility: project.visibility,
    company: project.company,
    ownerUser: project.ownerUser,
    activeWorkflowCount: project.workflowInstances.length,
    stages: (project.stages ?? []).map((stage) => ({
      id: stage.id,
      name: projectStageName(stage),
      status: stage.status,
      completedMilestones: stage.milestones.filter((milestone) => milestone.status === "completed").length,
      totalMilestones: stage.milestones.length,
    })),
    milestones: (project.milestones ?? []).map((milestone) => ({ ...milestone, name: projectMilestoneName(milestone) })),
    activeWorkflows: project.workflowInstances.map((workflow) => ({
      id: workflow.id,
      title: workflow.title,
      status: workflow.status,
      currentStepKey: workflow.currentStepKey,
      updatedAt: workflow.updatedAt,
    })),
    recentTasks: project.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      updatedAt: task.updatedAt,
      assigneeName: task.assignee?.name ?? null,
      priority: task.priority ?? 0,
      milestoneId: task.milestoneId ?? null,
    })),
  };
}
