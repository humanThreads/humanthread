import {
  desktopProjectCollectionResponseSchema,
  desktopProjectDetailResponseSchema,
  desktopTaskDetailResponseSchema,
  desktopTaskSchema,
  type DesktopAgentsResponse,
  type DesktopDashboardResponse,
  type DesktopProjectCollectionResponse,
  type DesktopProjectDetailResponse,
  type DesktopReportsResponse,
  type DesktopSearchResponse,
  type DesktopSettingsResponse,
  type DesktopTaskCollectionResponse,
  type DesktopTaskDetailResponse,
  type DesktopTeamResponse,
  type DesktopTemplatesResponse,
} from "@humanthread/workbench-client";
import {
  listDeviceExecutionConfiguration,
  prisma,
} from "../../../../../packages/db/src/index";

import { getAgentControlPlane } from "../orchestration/agent-read-model";
import {
  getCurrentTaskForUser,
  getTeamOverview,
  type UserTaskOverview,
} from "../overviews/task-overviews";
import { getTaskCollection } from "../tasks/task-read-model";
import { getTaskDetailView } from "../tasks/task-read-model";
import { parseTaskQuery } from "../tasks/task-query";
import { listTaskLabelDefinitions } from "../tasks/task-settings";
import { resolveWorkbenchApiActor, type WorkbenchApiActor } from "../workbench/workbench-api-session";
import { getWorkbenchContext, type WorkbenchContext } from "../workbench/workbench-context";
import { getWorkbenchDashboardData } from "../workbench/workbench-dashboard";
import {
  getDeliveryHealthReport,
  normalizeDeliveryHealthRange,
} from "../workbench/workbench-delivery-health-report";
import {
  listAccessibleProjectDocuments,
  listAccessibleSpaceDocuments,
} from "../workbench/workbench-documents";
import {
  getProjectHubView,
  getProjectListItems,
  getWorkbenchProjectDetail,
  getWorkbenchProjects,
  type ProjectHealth,
} from "../workbench/workbench-projects";
import { searchWorkbenchTasks } from "../workbench/workbench-search";
import {
  getWorkbenchCompanySettingsDetails,
  getWorkbenchSettingsContext,
} from "../workbench/workbench-settings-context";
import { listWorkbenchSpaces, type WorkbenchSpace } from "../workbench/workbench-spaces";
import { getAllTaskCenterTemplateDefinitions } from "../workbench/workbench-task-center";
import { getWorkbenchCompanyMembers } from "../workbench/workbench-settings";

type DesktopDashboardData = DesktopDashboardResponse["data"];
type DesktopSearchData = DesktopSearchResponse["data"];
type DesktopAgentsData = DesktopAgentsResponse["data"];
type DesktopTeamData = DesktopTeamResponse["data"];
type DesktopReportsData = DesktopReportsResponse["data"];
type DesktopTemplatesData = DesktopTemplatesResponse["data"];
type DesktopSettingsData = DesktopSettingsResponse["data"];
type DesktopTaskCollectionData = DesktopTaskCollectionResponse["data"];
type DesktopTaskDetailData = DesktopTaskDetailResponse["data"];
type DesktopProjectCollectionData = DesktopProjectCollectionResponse["data"];
type DesktopProjectDetailData = DesktopProjectDetailResponse["data"];
type DesktopTaskLabelOption = DesktopTaskDetailData["detail"]["collaboration"]["availableLabels"][number];

interface DesktopReadDependencies {
  resolveWorkbenchApiActor: typeof resolveWorkbenchApiActor;
  listWorkbenchSpaces: typeof listWorkbenchSpaces;
  getWorkbenchContext: typeof getWorkbenchContext;
  getCurrentTaskForUser: typeof getCurrentTaskForUser;
  getWorkbenchDashboardData: typeof getWorkbenchDashboardData;
  searchWorkbenchTasks: typeof searchWorkbenchTasks;
  getWorkbenchProjects: typeof getWorkbenchProjects;
  getProjectListItems: typeof getProjectListItems;
  getProjectHubView: typeof getProjectHubView;
  getWorkbenchProjectDetail: typeof getWorkbenchProjectDetail;
  listAccessibleSpaceDocuments: typeof listAccessibleSpaceDocuments;
  listAccessibleProjectDocuments: typeof listAccessibleProjectDocuments;
  getTeamOverview: typeof getTeamOverview;
  getAgentControlPlane: typeof getAgentControlPlane;
  getDeliveryHealthReport: typeof getDeliveryHealthReport;
  getWorkbenchSettingsContext: typeof getWorkbenchSettingsContext;
  getWorkbenchCompanySettingsDetails: typeof getWorkbenchCompanySettingsDetails;
  getAllTaskCenterTemplateDefinitions: typeof getAllTaskCenterTemplateDefinitions;
  getTaskCollection: typeof getTaskCollection;
  getTaskDetailView: typeof getTaskDetailView;
  listTaskLabelDefinitions: typeof listTaskLabelDefinitions;
  getWorkbenchCompanyMembers: typeof getWorkbenchCompanyMembers;
  listDeviceExecutionConfiguration: typeof listDeviceExecutionConfiguration;
  resolveDesktopNativeExecution: (actor: WorkbenchApiActor) => Promise<{
    authorized: boolean;
    localDeviceId: string | null;
  }>;
}

const DEFAULT_DEPENDENCIES: DesktopReadDependencies = {
  resolveWorkbenchApiActor,
  listWorkbenchSpaces,
  getWorkbenchContext,
  getCurrentTaskForUser,
  getWorkbenchDashboardData,
  searchWorkbenchTasks,
  getWorkbenchProjects,
  getProjectListItems,
  getProjectHubView,
  getWorkbenchProjectDetail,
  listAccessibleSpaceDocuments,
  listAccessibleProjectDocuments,
  getTeamOverview,
  getAgentControlPlane,
  getDeliveryHealthReport,
  getWorkbenchSettingsContext,
  getWorkbenchCompanySettingsDetails,
  getAllTaskCenterTemplateDefinitions,
  getTaskCollection,
  getTaskDetailView,
  listTaskLabelDefinitions,
  getWorkbenchCompanyMembers,
  listDeviceExecutionConfiguration,
  resolveDesktopNativeExecution: async (actor) => {
    if (actor.authKind !== "desktop_token") {
      return { authorized: false, localDeviceId: null };
    }
    const session = await prisma.desktopSession.findFirst({
      where: {
        id: actor.sessionId,
        userId: actor.userId,
        status: "active",
        revokedAt: null,
        device: { status: "authorized" },
      },
      select: { deviceId: true },
    });
    if (!session) return { authorized: false, localDeviceId: null };
    return { authorized: true, localDeviceId: session.deviceId };
  },
};

function dependenciesWith(
  overrides: Partial<DesktopReadDependencies>,
): DesktopReadDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

interface ResolvedDesktopSpace {
  id: string;
  key: string;
  kind: "personal" | "company";
  name: string;
  role: WorkbenchSpace["role"];
  companyId: string | null;
}

export interface DesktopReadContext {
  actor: WorkbenchApiActor;
  space: ResolvedDesktopSpace;
  spaces: ResolvedDesktopSpace[];
  workbench: WorkbenchContext;
  nativeExecutionAuthorized: boolean;
  localDeviceId: string | null;
}

function toDesktopSpace(space: WorkbenchSpace): ResolvedDesktopSpace {
  if (space.type === "personal") {
    return {
      id: space.id,
      key: "personal",
      kind: "personal",
      name: space.name,
      role: space.role,
      companyId: null,
    };
  }
  if (!space.companyId) {
    throw new Error("Invalid company Space");
  }
  return {
    id: space.id,
    key: `company:${space.companyId}`,
    kind: "company",
    name: space.name,
    role: space.role,
    companyId: space.companyId,
  };
}

export async function resolveDesktopReadContext(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopReadContext> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const actor = await dependencies.resolveWorkbenchApiActor(request);
  const spaces = (await dependencies.listWorkbenchSpaces({ userId: actor.userId }))
    .map(toDesktopSpace);
  const searchParams = new URL(request.url).searchParams;
  const requestedKey = searchParams.get("space")?.trim()
    || searchParams.get("spaceKey")?.trim();
  const space = requestedKey
    ? spaces.find((candidate) => candidate.key === requestedKey)
    : spaces.find((candidate) => candidate.kind === "personal") ?? spaces[0];

  if (!space) {
    throw new Error("Space access denied");
  }

  const workbench = await dependencies.getWorkbenchContext({
    selectedUserId: actor.userId,
    ownerType: space.kind,
    ...(space.companyId ? { companyId: space.companyId } : {}),
  });

  const nativeExecution = await dependencies.resolveDesktopNativeExecution(actor);

  return {
    actor,
    space,
    spaces,
    workbench,
    nativeExecutionAuthorized: nativeExecution.authorized,
    localDeviceId: nativeExecution.localDeviceId,
  };
}

function toIsoDate(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function toTaskSummary(task: UserTaskOverview): DesktopDashboardData["tasks"][number] {
  return {
    id: task.task.id,
    title: task.task.title,
    status: task.task.status,
    projectId: task.project.id,
    projectName: task.project.name,
    assigneeName: task.assignee.name || null,
    updatedAt: toIsoDate(task.task.updatedAt),
    route: `/tasks/${encodeURIComponent(task.task.id)}`,
  };
}

function projectScope(context: DesktopReadContext) {
  return {
    userId: context.actor.userId,
    ownerType: context.space.kind,
    ...(context.space.companyId ? { companyId: context.space.companyId } : {}),
  } as const;
}

function toDesktopProjectSummary(
  project: Awaited<ReturnType<typeof getProjectListItems>>[number],
): DesktopProjectCollectionData["projects"][number] {
  return {
    id: project.id,
    name: project.name,
    spaceLabel: project.spaceLabel,
    objective: project.objectiveExcerpt,
    owner: project.owner,
    status: project.status,
    health: project.health,
    progress: project.stageProgress,
    taskCounts: {
      open: project.openTaskCount,
      overdue: project.overdueTaskCount,
      blocked: project.blockedTaskCount,
    },
    nextMilestone: project.nextMilestone ? {
      ...project.nextMilestone,
      targetAt: toIsoDate(project.nextMilestone.targetAt),
    } : null,
    updatedAt: project.updatedAt.toISOString(),
  };
}

const PROJECT_HEALTH = new Set<ProjectHealth>([
  "healthy", "at_risk", "blocked", "complete", "unknown",
]);

export async function readDesktopProjects(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopProjectCollectionData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || undefined;
  const status = url.searchParams.get("status")?.trim() || undefined;
  const requestedHealth = url.searchParams.get("health")?.trim() as ProjectHealth | undefined;
  const health = requestedHealth && PROJECT_HEALTH.has(requestedHealth)
    ? requestedHealth
    : undefined;
  const projects = await dependencies.getProjectListItems({
    ...projectScope(context),
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(health ? { health } : {}),
  });
  const result = {
    projects: projects
      .filter((project) => project.spaceId === context.space.id)
      .map(toDesktopProjectSummary),
  };

  return desktopProjectCollectionResponseSchema.parse({ ok: true, data: result }).data;
}

export async function readDesktopProjectDetail(
  request: Request,
  projectId: string,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopProjectDetailData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const hub = await dependencies.getProjectHubView({
    projectId,
    userId: context.actor.userId,
  });

  if (!hub || hub.project.spaceId !== context.space.id) {
    throw new Error("Project not found");
  }

  const [projectDetail, accessibleDocuments, executionConfiguration] = await Promise.all([
    dependencies.getWorkbenchProjectDetail({
      projectId,
      userId: context.actor.userId,
    }),
    dependencies.listAccessibleProjectDocuments(projectScope(context)),
    context.localDeviceId
      ? dependencies.listDeviceExecutionConfiguration({
          actorUserId: context.actor.userId,
          localDeviceId: context.localDeviceId,
          projectId,
        })
      : Promise.resolve({ workspaces: [], runtimeProfiles: [] }),
  ]);

  if (!projectDetail || projectDetail.spaceId !== context.space.id) {
    throw new Error("Project not found");
  }

  const project = toDesktopProjectSummary(hub.project);
  const workspace = executionConfiguration.workspaces.find((candidate) => (
    candidate.projectId === projectId &&
    candidate.userId === context.actor.userId &&
    candidate.localDeviceId === context.localDeviceId
  ));
  const result = {
    detail: {
      project: {
        ...project,
        description: hub.project.description,
        startAt: toIsoDate(hub.project.startAt),
        targetAt: toIsoDate(hub.project.targetAt),
        visibility: hub.project.visibility,
        capabilities: {
          ...hub.project.capabilities,
          nativeWorkspace: Boolean(context.nativeExecutionAuthorized && workspace?.status === "ready"),
        },
      },
      health: hub.health,
      resources: hub.resources,
      taskSummary: hub.taskSummary,
      roadmap: hub.roadmap.map((stage) => ({
        id: stage.id,
        version: stage.version,
        sortOrder: stage.sortOrder,
        name: stage.name,
        status: stage.status,
        startAt: toIsoDate(stage.startAt),
        targetAt: toIsoDate(stage.targetAt),
        completedMilestones: stage.completedMilestones,
        totalMilestones: stage.totalMilestones,
        milestones: stage.milestones.map((milestone) => ({
          id: milestone.id,
          version: milestone.version,
          sortOrder: milestone.sortOrder,
          name: milestone.name,
          status: milestone.status,
          targetAt: toIsoDate(milestone.targetAt),
          riskSummary: milestone.riskSummary,
          taskCount: milestone.taskCount,
          tasks: milestone.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            version: task.version,
          })),
        })),
      })),
      tasks: projectDetail.recentTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        assigneeName: task.assigneeName,
        milestoneId: task.milestoneId,
        updatedAt: task.updatedAt.toISOString(),
        route: `/tasks/${encodeURIComponent(task.id)}`,
      })),
      documents: accessibleDocuments
        .filter((document) => document.projectId === projectId)
        .map((document) => ({
          id: document.id,
          title: document.title,
          path: document.path,
          version: document.version,
          updatedAt: document.updatedAt.toISOString(),
          route: `/documents/${encodeURIComponent(document.id)}`,
        })),
      risks: projectDetail.milestones
        .filter((milestone) => Boolean(milestone.riskSummary?.trim()))
        .map((milestone) => ({
          id: milestone.id,
          name: milestone.name,
          status: milestone.status,
          summary: milestone.riskSummary!.trim(),
        })),
      agents: projectDetail.activeWorkflows.map((workflow) => ({
        id: workflow.id,
        title: workflow.title,
        status: workflow.status,
        currentStepKey: workflow.currentStepKey,
        updatedAt: workflow.updatedAt.toISOString(),
        route: `/agents?workflow=${encodeURIComponent(workflow.id)}`,
      })),
      workspace: workspace ? {
        bindingId: workspace.id,
        status: workspace.status,
        pathFingerprint: workspace.pathFingerprint,
        configurationVersion: workspace.configurationVersion,
        lastValidatedAt: workspace.lastValidatedAt,
      } : null,
    },
  };

  return desktopProjectDetailResponseSchema.parse({ ok: true, data: result }).data;
}

export async function readDesktopBootstrap(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
) {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const current = await dependencies.getCurrentTaskForUser({
    teamId: context.workbench.teamId,
    userId: context.actor.userId,
    ownerType: context.space.kind,
    ...(context.space.companyId ? { companyId: context.space.companyId } : {}),
  });

  return {
    spaces: context.spaces.map((space) => ({
      key: space.key,
      kind: space.kind,
      name: space.name,
    })),
    activeSpaceKey: context.space.key,
    currentTask: current.currentTask
      ? {
          id: current.currentTask.task.id,
          title: current.currentTask.task.title,
          status: current.currentTask.task.status,
        }
      : null,
    capabilities: { nativeExecution: context.nativeExecutionAuthorized },
  };
}

export async function readDesktopDashboard(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopDashboardData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const url = new URL(request.url);
  const filterKey = url.searchParams.get("filter")?.trim() || undefined;
  const viewKey = url.searchParams.get("view")?.trim() || undefined;
  const selectedTaskId = url.searchParams.get("task")?.trim() || undefined;
  const dashboard = await dependencies.getWorkbenchDashboardData({
    teamId: context.workbench.teamId,
    ...projectScope(context),
    ...(filterKey ? { filterKey } : {}),
    ...(viewKey ? { viewKey } : {}),
    ...(selectedTaskId ? { selectedTaskId } : {}),
  });

  return {
    currentTask: dashboard.currentTask ? toTaskSummary(dashboard.currentTask) : null,
    stats: dashboard.stats.map(({ key, label, count, description }) => ({
      key,
      label,
      count,
      description,
    })),
    actionSignals: dashboard.actionSignals.map(({ key, label, count, description }) => ({
      key,
      label,
      count,
      description,
    })),
    tasks: dashboard.allTasks.map(toTaskSummary),
    devices: dashboard.devices.map((device) => ({
      id: device.id,
      name: device.name,
      platform: device.platform,
      status: device.status,
      lastSeenAt: toIsoDate(device.lastSeenAt),
      userName: device.user.name,
    })),
  };
}

function toDesktopCollectionTask(
  task: Awaited<ReturnType<typeof getTaskCollection>>["listRows"][number],
): DesktopTaskCollectionData["collection"]["listRows"][number] {
  return desktopTaskSchema.parse({
    id: task.id,
    shortId: task.shortId,
    title: task.title,
    statusCategory: task.statusCategory,
    status: {
      id: task.status.id,
      name: task.status.name,
      category: task.status.category,
      color: task.status.color,
    },
    visibility: task.visibility,
    priority: task.priority,
    startAt: toIsoDate(task.startAt),
    dueAt: toIsoDate(task.dueAt),
    overdue: task.overdue,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    createdById: task.createdById,
    assignee: task.assignee ? {
      id: task.assignee.id,
      name: task.assignee.name,
      avatarUrl: task.assignee.avatarUrl,
    } : null,
    project: task.project ? {
      id: task.project.id,
      name: task.project.name,
    } : null,
    blocker: task.blocker ? {
      id: task.blocker.id,
      reason: task.blocker.reason,
      ownerUserId: task.blocker.ownerUserId,
      createdAt: task.blocker.createdAt.toISOString(),
    } : null,
    labels: task.labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    })),
    childCount: task.childCount,
    automation: task.automation ? {
      id: task.automation.id,
      status: task.automation.status,
      createdAt: task.automation.createdAt.toISOString(),
      agentProfile: {
        id: task.automation.agentProfile.id,
        name: task.automation.agentProfile.name,
        provider: task.automation.agentProfile.provider,
      },
    } : null,
  });
}

export async function readDesktopTasks(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopTaskCollectionData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const url = new URL(request.url);
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
  const pageSize = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50, 1),
    100,
  );
  const collection = await dependencies.getTaskCollection({
    userId: context.actor.userId,
    spaceId: context.space.id,
    query: parseTaskQuery(Object.fromEntries(url.searchParams.entries())),
    timeZone: url.searchParams.get("timeZone") || "Asia/Shanghai",
    page,
    pageSize,
  });

  return {
    collection: {
      listRows: collection.listRows.map(toDesktopCollectionTask),
      boardGroups: collection.boardGroups.map((group) => ({
        key: group.key,
        tasks: group.tasks.map(toDesktopCollectionTask),
      })),
      calendar: {
        entries: collection.calendar.entries.map((entry) => ({
          ...entry,
          at: entry.at.toISOString(),
        })),
        unscheduled: collection.calendar.unscheduled.map(toDesktopCollectionTask),
      },
      relationCounts: collection.relationCounts,
      total: collection.total,
      page: collection.page ?? page,
      pageSize: collection.pageSize ?? pageSize,
      hasNextPage: collection.hasNextPage ?? collection.total > page * pageSize,
      hasPreviousPage: collection.hasPreviousPage ?? page > 1,
    },
  };
}

function normalizedOptionalText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function uniqueMemberOptions(
  members: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  return [...new Map(members.map((member) => [member.id, member])).values()];
}

export async function readDesktopTaskDetail(
  request: Request,
  taskId: string,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopTaskDetailData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const [detail, labels, companyMembers] = await Promise.all([
    dependencies.getTaskDetailView({
      userId: context.actor.userId,
      taskId,
      spaceId: context.space.id,
    }),
    dependencies.listTaskLabelDefinitions({
      userId: context.actor.userId,
      spaceId: context.space.id,
    }) as Promise<DesktopTaskLabelOption[]>,
    context.space.companyId
      ? dependencies.getWorkbenchCompanyMembers({
          userId: context.actor.userId,
          companyId: context.space.companyId,
        })
      : Promise.resolve({ company: null, members: [] }),
  ]);

  if (!detail) throw new Error("Task not found");

  const { task, capabilities } = detail;
  const execution = {
    projectId: task.project?.id ?? null,
    workflowInstanceId: task.workflowInstanceId ?? null,
    localPath: normalizedOptionalText(task.localPath, task.project?.localPath),
    command: normalizedOptionalText(task.command, task.project?.defaultCommand),
    toolSession: task.toolSessions[0] ?? null,
  };
  const availableMembers = context.space.companyId
    ? companyMembers.members.map((member) => ({
        id: member.user.id,
        name: member.user.name,
      }))
    : uniqueMemberOptions([
        { id: task.createdBy.id, name: task.createdBy.name },
        ...(task.assignee ? [{ id: task.assignee.id, name: task.assignee.name }] : []),
        ...task.members.map((member) => ({
          id: member.user.id,
          name: member.user.name,
        })),
      ]);
  const now = new Date();
  const result = {
    detail: {
      task: {
        id: task.id,
        shortId: task.shortId,
        title: task.title,
        statusCategory: task.statusCategory as "backlog" | "todo" | "in_progress" | "in_review" | "completed" | "cancelled",
        status: task.statusDefinition ?? {
          id: null,
          name: task.statusCategory,
          category: task.statusCategory,
          color: "#57606a",
        },
        visibility: task.visibility as "private" | "project" | "company",
        priority: task.priority,
        startAt: toIsoDate(task.startAt),
        dueAt: toIsoDate(task.dueAt),
        overdue: Boolean(
          task.dueAt
          && task.dueAt < now
          && task.statusCategory !== "completed"
          && task.statusCategory !== "cancelled"
        ),
        version: task.version,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        createdById: task.createdById,
        assignee: task.assignee,
        project: task.project ? { id: task.project.id, name: task.project.name } : null,
        blocker: task.blockers[0] ? {
          id: task.blockers[0].id,
          reason: task.blockers[0].reason,
          ownerUserId: task.blockers[0].ownerUserId,
          createdAt: task.blockers[0].createdAt.toISOString(),
        } : null,
        labels: task.labelAssignments.map((assignment) => assignment.label),
        childCount: task._count.childTasks,
        automation: task.agentRuns[0] ? {
          ...task.agentRuns[0],
          createdAt: task.agentRuns[0].createdAt.toISOString(),
        } : null,
        contentMarkdown: task.contentMarkdown,
        acceptanceMode: task.acceptanceMode,
        archivedAt: toIsoDate(task.archivedAt),
        createdBy: task.createdBy,
        acceptanceReviewer: task.acceptanceReviewer,
        members: task.members,
        blockers: task.blockers.map(({ id, reason }) => ({ id, reason })),
        comments: task.comments.map((comment) => ({
          ...comment,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
        })),
        activities: task.activities.map((activity) => ({
          ...activity,
          message: activity.message ?? null,
          payload: activity.payload ?? null,
          createdAt: activity.createdAt.toISOString(),
        })),
        reminders: task.reminders.map((reminder) => ({
          ...reminder,
          remindAt: reminder.remindAt.toISOString(),
        })),
        attachments: task.attachments.map((attachment) => ({
          ...attachment,
          createdAt: attachment.createdAt.toISOString(),
        })),
        documentLinks: task.documentLinks,
        childTasks: task.childTasks.map((child) => ({
          id: child.id,
          title: child.title,
          statusCategory: child.statusCategory,
        })),
      },
      capabilities: {
        ...capabilities,
        nativeExecute: Boolean(
          context.nativeExecutionAuthorized
          &&
          capabilities.dispatchAgent
          && execution.projectId
          && execution.workflowInstanceId
          && execution.localPath
        ),
      },
      collaboration: {
        availableMembers: uniqueMemberOptions(availableMembers),
        availableLabels: labels.map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
        })),
      },
      execution,
    },
  };

  return desktopTaskDetailResponseSchema.parse({ ok: true, data: result }).data;
}

function includesQuery(query: string, ...values: Array<string | null | undefined>) {
  return values.some((value) => value?.toLowerCase().includes(query));
}

export async function readDesktopSearch(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopSearchData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) {
    return { query, tasks: [], projects: [], documents: [], members: [], agents: [] };
  }

  const scope = projectScope(context);
  const [tasks, projects, spaceDocuments, projectDocuments, team, agents] = await Promise.all([
    dependencies.searchWorkbenchTasks({
      userId: context.actor.userId,
      spaceId: context.space.id,
      query,
      take: 20,
    }),
    dependencies.getWorkbenchProjects(scope),
    dependencies.listAccessibleSpaceDocuments({
      userId: context.actor.userId,
      spaceId: context.space.id,
    }),
    dependencies.listAccessibleProjectDocuments(scope),
    dependencies.getTeamOverview({
      teamId: context.workbench.teamId,
      ...scope,
    }),
    dependencies.getAgentControlPlane({
      userId: context.actor.userId,
      ownerType: context.space.kind,
      companyId: context.space.companyId,
    }),
  ]);

  return {
    query,
    tasks: tasks.slice(0, 20).map((task) => ({
      id: task.id,
      title: task.title,
      subtitle: `${task.projectName}${task.assigneeName ? ` · ${task.assigneeName}` : ""}`,
      status: task.status,
      updatedAt: task.updatedAt.toISOString(),
      route: `/tasks/${encodeURIComponent(task.id)}`,
    })),
    projects: projects
      .filter((project) => includesQuery(normalizedQuery, project.name, project.description))
      .slice(0, 20)
      .map((project) => ({
        id: project.id,
        title: project.name,
        subtitle: project.description,
        status: project.activeWorkflowCount > 0 ? "active" : null,
        updatedAt: project.updatedAt.toISOString(),
        route: `/projects/${encodeURIComponent(project.id)}`,
      })),
    documents: [...spaceDocuments, ...projectDocuments]
      .filter((document) => includesQuery(
        normalizedQuery,
        document.title,
        document.path,
        "projectName" in document ? document.projectName : document.spaceName,
      ))
      .slice(0, 20)
      .map((document) => ({
        id: document.id,
        title: document.title,
        subtitle: "projectName" in document ? document.projectName : document.spaceName,
        status: `v${document.version}`,
        updatedAt: document.updatedAt.toISOString(),
        route: `/documents/${encodeURIComponent(document.id)}`,
      })),
    members: team.members
      .filter((member) => includesQuery(
        normalizedQuery,
        member.user.name,
        member.user.email,
        member.user.status,
      ))
      .slice(0, 20)
      .map((member) => ({
        id: member.user.id,
        title: member.user.name,
        subtitle: member.user.email,
        status: member.user.status,
        updatedAt: toIsoDate(member.user.lastSeenAt),
        route: `/team?member=${encodeURIComponent(member.user.id)}`,
      })),
    agents: agents.profiles
      .filter((profile) => includesQuery(
        normalizedQuery,
        profile.name,
        profile.provider,
        profile.model,
        profile.status,
      ))
      .slice(0, 20)
      .map((profile) => ({
        id: profile.id,
        title: profile.name,
        subtitle: profile.model ?? profile.provider,
        status: profile.status,
        updatedAt: null,
        route: `/agents?profile=${encodeURIComponent(profile.id)}`,
      })),
  };
}

export async function readDesktopAgents(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopAgentsData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const result = await dependencies.getAgentControlPlane({
    userId: context.actor.userId,
    ownerType: context.space.kind,
    companyId: context.space.companyId,
  });

  return {
    canManage: result.canManage,
    profiles: result.profiles.map((profile) => ({
      ...profile,
      model: profile.model ?? null,
      route: `/agents?profile=${encodeURIComponent(profile.id)}`,
    })),
    workers: result.workers.map((worker) => ({
      ...worker,
      lastHeartbeatAt: toIsoDate(worker.lastHeartbeatAt),
    })),
    runs: result.runs.flatMap((run) => {
      const taskId = run.taskId ?? result.loops.find((loop) => loop.id === run.loopRunId)?.taskId ?? null;
      if (!taskId && !run.loopRunId) return [];
      const route = taskId
        ? `/tasks/${encodeURIComponent(taskId)}`
        : `/loop-runs/${encodeURIComponent(run.loopRunId!)}`;
      return [{
      id: run.id,
      taskId,
      taskTitle: run.taskTitle,
      status: run.status,
      attempt: run.attempt,
      provider: run.provider,
      workerName: run.workerName,
      createdAt: run.createdAt.toISOString(),
      lastHeartbeatAt: toIsoDate(run.lastHeartbeatAt),
      route,
    }];
    }),
    loops: result.loops.map((loop) => ({
      id: loop.id,
      taskId: loop.taskId,
      taskTitle: loop.taskTitle,
      loopName: loop.loopName ?? "未命名 Loop",
      scope: loop.scope ?? (loop.taskId ? "task" : "project"),
      parentLoopRunId: loop.parentLoopRunId ?? null,
      parentLoopName: loop.parentLoopName ?? null,
      status: loop.status,
      waitingReason: loop.waitingReason ?? null,
      version: loop.version,
      currentIteration: loop.currentIteration,
      maxIterations: loop.maxIterations,
      attempt: loop.attempt,
      lastHeartbeatAt: toIsoDate(loop.lastHeartbeatAt),
      route: loop.taskId
        ? `/tasks/${encodeURIComponent(loop.taskId)}`
        : `/loop-runs/${encodeURIComponent(loop.id)}`,
    })),
    approvals: result.approvals.map((approval) => ({
      ...approval,
      createdAt: approval.createdAt.toISOString(),
    })),
  };
}

export async function readDesktopTeam(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopTeamData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const result = await dependencies.getTeamOverview({
    teamId: context.workbench.teamId,
    ...projectScope(context),
  });

  return {
    team: result.team,
    members: result.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      status: member.user.status,
      lastSeenAt: toIsoDate(member.user.lastSeenAt),
      queueLength: member.queueLength,
      currentTask: member.currentTask ? toTaskSummary(member.currentTask) : null,
      route: `/team?member=${encodeURIComponent(member.user.id)}`,
    })),
  };
}

export async function readDesktopReports(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopReportsData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project")?.trim() || undefined;
  const report = await dependencies.getDeliveryHealthReport({
    ...projectScope(context),
    spaceKey: context.space.key,
    spaceId: context.space.id,
    range: normalizeDeliveryHealthRange(url.searchParams.get("range") ?? undefined),
    ...(projectId ? { projectId } : {}),
  });

  return {
    range: report.range,
    generatedAt: report.generatedAt.toISOString(),
    metrics: report.metrics,
    trend: report.trend,
    projects: report.projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      health: project.health,
      openTaskCount: project.openTaskCount,
      overdueTaskCount: project.overdueTaskCount,
      blockedTaskCount: project.blockedTaskCount,
      updatedAt: project.updatedAt.toISOString(),
      route: `/projects/${encodeURIComponent(project.id)}`,
    })),
    insights: report.insights.map((insight) => ({
      label: insight.label,
      count: insight.count,
      tone: insight.tone,
      route: insight.href,
    })),
  };
}

export async function readDesktopTemplates(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopTemplatesData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  await resolveDesktopReadContext(request, dependencies);

  return {
    templates: dependencies.getAllTaskCenterTemplateDefinitions().map((template) => ({
      ...template,
      route: `/tasks?template=${encodeURIComponent(template.key)}`,
    })),
  };
}

export async function readDesktopSettings(
  request: Request,
  dependencyOverrides: Partial<DesktopReadDependencies> = {},
): Promise<DesktopSettingsData> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await resolveDesktopReadContext(request, dependencies);
  const settings = await dependencies.getWorkbenchSettingsContext({
    userId: context.actor.userId,
  });
  const companyDetails = context.space.companyId
    ? await dependencies.getWorkbenchCompanySettingsDetails({
        userId: context.actor.userId,
        companyId: context.space.companyId,
      })
    : null;

  return {
    user: settings.user,
    companies: settings.companies.map((company) => ({
      ...company,
      route: `/settings/company/${encodeURIComponent(company.id)}`,
    })),
    isSiteAdmin: settings.isSiteAdmin,
    selectedCompany: companyDetails
      ? {
          company: companyDetails.context.company,
          membership: companyDetails.context.membership,
          profile: companyDetails.profile,
          members: companyDetails.members.map((member) => ({
            id: member.id,
            role: member.role,
            status: member.status,
            user: {
              ...member.user,
              avatarUrl: null,
              lastSeenAt: toIsoDate(member.user.lastSeenAt),
            },
          })),
          ...(companyDetails.integration
            ? {
                integration: {
                  emailHost: companyDetails.integration.emailHost,
                  emailPort: companyDetails.integration.emailPort,
                  emailUsername: companyDetails.integration.emailUsername,
                  hasPassword: companyDetails.integration.hasPassword,
                },
              }
            : {}),
        }
      : null,
  };
}
