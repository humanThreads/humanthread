import type { Prisma } from "@prisma/client";
import {
  evaluateTaskAcceptance,
  loopAuthoringGraphSchema,
  type TaskAcceptanceEvidenceStatus,
} from "@humanthread/orchestration-core";
import {
  assertCanGovernTask,
  buildAccessibleTaskWhere,
  prisma,
  TaskAccessError,
} from "../../../../../packages/db/src/index";
import { buildTaskCalendarEntries, getTaskDateRange } from "./task-calendar";
import type { ParsedTaskQuery, TaskGroup, TaskSort } from "./task-query";
import { requireUserTaskReads, requireUserTaskWrites } from "./task-rollout";
import { normalizeTaskFieldRecord } from "./task-business-fields";

const COMPLETED_LOOP_NODE_STATUSES = new Set(["succeeded", "completed", "skipped"]);

const TASK_LOOP_RUN_SELECT = {
  id: true,
  status: true,
  statusReason: true,
  currentIteration: true,
  stopReason: true,
  version: true,
  loopVersion: { select: { graph: true } },
  nodeRuns: { select: { nodeKey: true, status: true, activationNo: true } },
  workflowInteractions: {
    where: { status: "open" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, kind: true, status: true },
  },
} satisfies Prisma.LoopRunSelect;

export function deriveLoopRunProgress(input: {
  graph: unknown;
  nodeRuns: ReadonlyArray<{ nodeKey: string; status: string; activationNo: number }>;
  runStatus?: string | null;
}): { completed: number; total: number; percent: number } {
  const latestByNode = new Map<string, { status: string; activationNo: number }>();
  for (const nodeRun of input.nodeRuns) {
    const current = latestByNode.get(nodeRun.nodeKey);
    if (!current || nodeRun.activationNo >= current.activationNo) latestByNode.set(nodeRun.nodeKey, nodeRun);
  }
  const parsed = loopAuthoringGraphSchema.safeParse(input.graph);
  const nodeKeys = parsed.success ? parsed.data.nodes.map((node) => node.key) : [...latestByNode.keys()];
  const total = nodeKeys.length;
  if (total === 0) return { completed: 0, total: 0, percent: input.runStatus === "completed" ? 100 : 0 };
  const completed = nodeKeys.filter((key) => COMPLETED_LOOP_NODE_STATUSES.has(latestByNode.get(key)?.status ?? "")).length;
  return { completed, total, percent: Math.min(100, Math.max(0, Math.round((completed / total) * 100))) };
}

const TASK_SUMMARY_SELECT = {
  id: true,
  shortId: true,
  taskNumber: true,
  title: true,
  statusCategory: true,
  visibility: true,
  priority: true,
  startAt: true,
  dueAt: true,
  recurrenceRule: true,
  dispatchPolicy: true,
  version: true,
  archivedAt: true,
  createdById: true,
  assigneeUserId: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, name: true, avatarUrl: true } },
  project: { select: { id: true, name: true, shortCode: true } },
  customFieldValues: {
    select: {
      id: true,
      textValue: true,
      numberValue: true,
      dateValue: true,
      booleanValue: true,
      userValue: true,
      selectValue: true,
      fieldDefinition: { select: { id: true, projectId: true, key: true, name: true, type: true, required: true, options: true, sortOrder: true, isActive: true } },
    },
  },
  statusDefinition: { select: { id: true, name: true, category: true, color: true } },
  members: { select: { userId: true, role: true } },
  blockers: {
    where: { status: "active" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, reason: true, ownerUserId: true, createdAt: true },
  },
  labelAssignments: {
    select: { label: { select: { id: true, name: true, color: true } } },
  },
  _count: { select: { childTasks: true } },
  agentRuns: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      createdAt: true,
      agentProfile: { select: { id: true, name: true, provider: true } },
    },
  },
  loopRuns: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: TASK_LOOP_RUN_SELECT,
  },
} satisfies Prisma.TaskSelect;

const TASK_DETAIL_SELECT = {
  ...TASK_SUMMARY_SELECT,
  localPath: true,
  command: true,
  workflowInstanceId: true,
  contentMarkdown: true,
  acceptanceMode: true,
  acceptancePolicy: true,
  archivedAt: true,
  space: { select: { id: true, type: true, ownerUserId: true } },
  project: {
    select: {
      id: true,
      name: true,
      shortCode: true,
      localPath: true,
      defaultCommand: true,
    },
  },
  acceptanceReviewer: { select: { id: true, name: true, avatarUrl: true } },
  checkDefinitions: {
    where: { type: "acceptance" },
    select: {
      projectId: true,
      name: true,
      configuration: true,
      results: {
        select: {
          id: true,
          status: true,
          summary: true,
          evidence: true,
          finishedAt: true,
        },
      },
    },
  },
  createdBy: { select: { id: true, name: true, avatarUrl: true } },
  members: {
    select: { userId: true, role: true, user: { select: { id: true, name: true, avatarUrl: true } } },
  },
  childTasks: { select: TASK_SUMMARY_SELECT, orderBy: { createdAt: "asc" } },
  predecessorDependencies: {
    select: { id: true, type: true, successorTask: { select: { id: true, title: true, statusCategory: true } } },
  },
  successorDependencies: {
    select: { id: true, type: true, predecessorTask: { select: { id: true, title: true, statusCategory: true } } },
  },
  documentLinks: {
    select: { document: { select: { id: true, title: true, path: true, version: true } } },
  },
  attachments: {
    where: { deletedAt: null },
    select: { id: true, originalName: true, mimeType: true, byteSize: true, createdAt: true },
  },
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      contentMarkdown: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
  activities: {
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, type: true, actorType: true, message: true, payload: true, createdAt: true },
  },
  reminders: {
    where: { status: { in: ["pending", "failed"] } },
    orderBy: { remindAt: "asc" },
    select: { id: true, remindAt: true, channel: true, status: true },
  },
  loopRuns: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: TASK_LOOP_RUN_SELECT,
  },
  toolSessions: {
    where: { status: "active" },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 1,
    select: {
      id: true,
      sessionType: true,
      sessionName: true,
      status: true,
      lastOutputSummary: true,
    },
  },
} satisfies Prisma.TaskSelect;

type TaskSummary = Prisma.TaskGetPayload<{ select: typeof TASK_SUMMARY_SELECT }>;
type TaskDetail = Prisma.TaskGetPayload<{ select: typeof TASK_DETAIL_SELECT }>;

interface TaskCollectionDb {
  task: {
    findMany(args: unknown): Promise<TaskSummary[]>;
    count?(args: unknown): Promise<number>;
  };
}

interface TaskDetailDb {
  task: {
    findFirst<T = TaskDetail>(args: unknown): Promise<T | null>;
  };
}

interface TaskSavedViewDb {
  taskSavedView: {
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
}

function relationFilter(query: ParsedTaskQuery) {
  if (["assigned", "created", "participating", "following", "overdue"].includes(query.relation)) {
    return query.relation as "assigned" | "created" | "participating" | "following" | "overdue";
  }
  return undefined;
}

function orderBy(sort: TaskSort): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case "due_asc":
      return [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }, { id: "asc" }];
    case "priority_desc":
      return [{ priority: "desc" }, { updatedAt: "desc" }, { id: "asc" }];
    case "created_desc":
      return [{ createdAt: "desc" }, { id: "asc" }];
    default:
      return [{ updatedAt: "desc" }, { id: "asc" }];
  }
}

function taskFilters(input: {
  userId: string;
  spaceId?: string;
  query: ParsedTaskQuery;
  timeZone: string;
  now: Date;
}) {
  const dateRange = getTaskDateRange({
    ...(input.query.dateFrom ? { dateFrom: input.query.dateFrom } : {}),
    ...(input.query.dateTo ? { dateTo: input.query.dateTo } : {}),
    timeZone: input.timeZone,
  });
  const relation = relationFilter(input.query);
  const access = buildAccessibleTaskWhere({
    userId: input.userId,
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    ...(relation ? { relation } : {}),
    includeArchived: input.query.relation === "archived",
    now: input.now,
  });
  const filters: Prisma.TaskWhereInput[] = [access];
  if (input.query.relation === "archived") filters.push({ archivedAt: { not: null } });
  if (input.query.relation === "completed") filters.push({ statusCategory: "completed" });
  if (input.query.relation === "blocked") filters.push({ blockers: { some: { status: "active" } } });
  if (input.query.status.length) filters.push({ statusCategory: { in: input.query.status } });
  if (input.query.assignee.length) filters.push({ assigneeUserId: { in: input.query.assignee } });
  if (input.query.priority.length) filters.push({ priority: { in: input.query.priority } });
  if (input.query.project.length) {
    const projectIds = input.query.project.filter((projectId) => projectId !== "__none__");
    const includeUnassigned = input.query.project.includes("__none__");
    if (projectIds.length && includeUnassigned) {
      filters.push({ OR: [{ projectId: { in: projectIds } }, { projectId: null }] });
    } else if (projectIds.length) {
      filters.push({ projectId: { in: projectIds } });
    } else {
      filters.push({ projectId: null });
    }
  }
  if (input.query.shortId) filters.push({ shortId: input.query.shortId });
  if (input.query.search) filters.push({ OR: [
    { title: { contains: input.query.search } },
    { contentMarkdown: { contains: input.query.search } },
  ] });
  if (dateRange.from || dateRange.to) {
    const range = {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.to ? { lte: dateRange.to } : {}),
    };
    filters.push({ OR: [{ startAt: range }, { dueAt: range }] });
  }
  return { AND: filters } satisfies Prisma.TaskWhereInput;
}

function normalizeTaskSummary(task: TaskSummary, now: Date) {
  const customFields = Object.fromEntries((task.customFieldValues ?? []).filter((value) => value.fieldDefinition.isActive).map((value) => {
    const normalized = normalizeTaskFieldRecord(value);
    return [normalized.key, normalized.value];
  }));
  const loopRun = (task as TaskSummary & { loopRuns?: Array<Prisma.LoopRunGetPayload<{ select: typeof TASK_LOOP_RUN_SELECT }>> }).loopRuns?.[0] ?? null;
  const loopProgress = loopRun
    ? deriveLoopRunProgress({ graph: loopRun.loopVersion?.graph ?? null, nodeRuns: loopRun.nodeRuns, runStatus: loopRun.status })
    : null;
  return {
    id: task.id,
    shortId: task.shortId,
    taskNumber: task.taskNumber,
    title: task.title,
    statusCategory: task.statusCategory ?? "todo",
    status: task.statusDefinition ?? {
      id: null,
      name: task.statusCategory ?? "todo",
      category: task.statusCategory ?? "todo",
      color: "#57606a",
    },
    visibility: task.visibility ?? "private",
    priority: task.priority,
    startAt: task.startAt,
    dueAt: task.dueAt,
    overdue: Boolean(task.dueAt
      && task.dueAt < now
      && task.statusCategory !== "completed"
      && task.statusCategory !== "cancelled"),
    version: task.version,
    archivedAt: task.archivedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    createdById: task.createdById,
    assignee: task.assignee,
    project: task.project,
    customFields,
    blocker: task.blockers[0] ?? null,
    labels: task.labelAssignments.map((assignment) => assignment.label),
    childCount: task._count.childTasks,
    automation: task.agentRuns[0] ?? null,
    loopRun: loopRun ? {
      id: loopRun.id,
      status: loopRun.status,
      statusReason: loopRun.statusReason,
      currentIteration: loopRun.currentIteration,
      stopReason: loopRun.stopReason,
      version: loopRun.version,
      progress: loopProgress ?? { completed: 0, total: 0, percent: 0 },
      pendingInteraction: loopRun.workflowInteractions[0] ?? null,
    } : null,
  };
}

function groupKey(task: ReturnType<typeof normalizeTaskSummary>, group: TaskGroup) {
  if (group === "assignee") return task.assignee?.id ?? "unassigned";
  if (group === "priority") return String(task.priority);
  if (group === "project") return task.project?.id ?? "no_project";
  return task.statusCategory;
}

export async function getTaskCollection(input: {
  userId: string;
  spaceId?: string;
  query: ParsedTaskQuery;
  timeZone: string;
  now?: Date;
  take?: number;
  page?: number;
  pageSize?: number;
  db?: TaskCollectionDb;
}) {
  if (!input.db) requireUserTaskReads();
  const db = input.db ?? (prisma as unknown as TaskCollectionDb);
  const now = input.now ?? new Date();
  const pageSize = Math.min(Math.max(input.pageSize ?? input.take ?? 50, 1), 100);
  const page = Math.max(input.page ?? 1, 1);
  const where = taskFilters({ ...input, now });
  const rows = await db.task.findMany({
    where,
    select: TASK_SUMMARY_SELECT,
    orderBy: orderBy(input.query.sort),
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
  const archivedCount = db.task.count ? await db.task.count({
    where: {
      AND: [
        buildAccessibleTaskWhere({
          userId: input.userId,
          ...(input.spaceId ? { spaceId: input.spaceId } : {}),
          includeArchived: true,
          now,
        }),
        { archivedAt: { not: null } },
      ],
    },
  }) : 0;
  const total = db.task.count ? await db.task.count({ where }) : rows.length;
  const listRows = rows.map((task) => normalizeTaskSummary(task, now));
  const groups = new Map<string, typeof listRows>();
  for (const task of listRows) {
    const key = groupKey(task, input.query.group);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const relationCounts = {
    assigned: rows.filter((task) => task.assigneeUserId === input.userId).length,
    created: rows.filter((task) => task.createdById === input.userId).length,
    participating: rows.filter((task) => task.members.some((member) => member.userId === input.userId && member.role === "participant")).length,
    following: rows.filter((task) => task.members.some((member) => member.userId === input.userId && member.role === "follower")).length,
    overdue: listRows.filter((task) => task.overdue).length,
    blocked: rows.filter((task) => task.blockers.length > 0).length,
    completed: rows.filter((task) => task.statusCategory === "completed").length,
    archived: archivedCount,
  };
  return {
    listRows,
    boardGroups: [...groups].map(([key, tasks]) => ({ key, tasks })),
    calendar: buildTaskCalendarEntries({ tasks: listRows, timeZone: input.timeZone, now }),
    relationCounts,
    total,
    page,
    pageSize,
    hasNextPage: page * pageSize < total,
    hasPreviousPage: page > 1,
  };
}

function detailCapabilities(task: TaskDetail, userId: string, canGovern: boolean, archived = false) {
  const isCreator = task.createdById === userId;
  const isAssignee = task.assigneeUserId === userId;
  const role = task.members.find((member) => member.userId === userId)?.role;
  const isParticipant = role === "participant";
  const isFollower = role === "follower";
  const isSpaceOwner = task.space?.type === "personal" && task.space.ownerUserId === userId;
  return {
    read: true,
    comment: !archived && (isCreator || isAssignee || isParticipant || isFollower || isSpaceOwner),
    edit: !archived && (isCreator || isAssignee || isParticipant || isSpaceOwner),
    changeStatus: !archived && (isAssignee || isSpaceOwner || (isCreator && !task.assigneeUserId)),
    manageMembers: !archived && (isCreator || isSpaceOwner),
    manageVisibility: !archived && (isCreator || isSpaceOwner),
    dispatchAgent: !archived && (isCreator || isAssignee || isParticipant || isSpaceOwner),
    govern: canGovern,
  };
}

function acceptanceEvidenceSource(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const source = (value as Prisma.JsonObject).source;
  return typeof source === "string" ? source : "unknown";
}

function acceptanceEvidenceStatus(value: string): TaskAcceptanceEvidenceStatus {
  return ["passed", "failed", "inconclusive", "skipped"].includes(value)
    ? value as TaskAcceptanceEvidenceStatus
    : "inconclusive";
}

function taskAcceptanceReadiness(task: TaskDetail) {
  if (task.acceptanceMode !== "automated" && task.acceptanceMode !== "hybrid") return null;
  return evaluateTaskAcceptance({
    policy: task.acceptancePolicy,
    results: task.checkDefinitions
      .filter((definition) => definition.projectId === task.project?.id)
      .flatMap((definition) => {
      const configuration = definition.configuration;
      const configuredKey = configuration
        && typeof configuration === "object"
        && !Array.isArray(configuration)
        ? (configuration as Prisma.JsonObject).acceptanceCheckKey
        : undefined;
      const checkKey = typeof configuredKey === "string" ? configuredKey : definition.name;
      return definition.results.map((result) => ({
        id: result.id,
        checkKey,
        status: acceptanceEvidenceStatus(result.status),
        summary: result.summary,
        source: acceptanceEvidenceSource(result.evidence),
        finishedAt: result.finishedAt,
      }));
      }),
  });
}

export async function getTaskDetailView(input: {
  userId: string;
  taskId?: string;
  shortId?: string;
  spaceId?: string;
  includeArchived?: boolean;
  db?: TaskDetailDb;
  authorizeGovern?: (input: { userId: string; taskId: string }) => Promise<unknown>;
}) {
  if (!input.db) requireUserTaskReads();
  if (Boolean(input.taskId) === Boolean(input.shortId)) return null;
  const db = input.db ?? (prisma as unknown as TaskDetailDb);
  let taskId = input.taskId;
  if (!taskId && input.shortId) {
    const identifier = await db.task.findFirst<{ id: string }>({
      where: {
        AND: [
          { shortId: input.shortId },
          buildAccessibleTaskWhere({ userId: input.userId, ...(input.spaceId ? { spaceId: input.spaceId } : {}) }),
        ],
      },
      select: { id: true },
    });
    taskId = identifier?.id;
  }
  if (!taskId) return null;
  const task = await db.task.findFirst({
    where: {
      AND: [
        { id: taskId },
        buildAccessibleTaskWhere({
          userId: input.userId,
          ...(input.spaceId ? { spaceId: input.spaceId } : {}),
          ...(input.includeArchived ? { includeArchived: true } : {}),
        }),
      ],
    },
    select: {
      ...TASK_DETAIL_SELECT,
      checkDefinitions: {
        ...TASK_DETAIL_SELECT.checkDefinitions,
        select: {
          ...TASK_DETAIL_SELECT.checkDefinitions.select,
          results: {
            ...TASK_DETAIL_SELECT.checkDefinitions.select.results,
            where: { taskId },
          },
        },
      },
    },
  });
  if (!task) return null;
  let canGovern = false;
  const authorizeGovern = input.authorizeGovern ?? ((authorizationInput) => assertCanGovernTask(authorizationInput));
  try {
    await authorizeGovern({ userId: input.userId, taskId });
    canGovern = true;
  } catch (error) {
    if (!(error instanceof TaskAccessError)) throw error;
  }
  const acceptanceReadiness = taskAcceptanceReadiness(task);
  const {
    acceptancePolicy: _acceptancePolicy,
    dispatchPolicy: _dispatchPolicy,
    checkDefinitions: _checkDefinitions,
    customFieldValues: fieldValues,
    ...taskProjection
  } = task;
  void _acceptancePolicy;
  void _dispatchPolicy;
  void _checkDefinitions;
  return {
    task: {
      ...taskProjection,
      recurringLoopBinding: task.dispatchPolicy && typeof task.dispatchPolicy === "object" && !Array.isArray(task.dispatchPolicy)
        ? (task.dispatchPolicy as { recurringLoopBinding?: unknown }).recurringLoopBinding ?? null
        : null,
      loopRuns: task.loopRuns.map(({ loopVersion, nodeRuns, ...run }) => ({
        ...run,
        progress: deriveLoopRunProgress({ graph: loopVersion?.graph ?? null, nodeRuns, runStatus: run.status }),
      })),
      customFields: Object.fromEntries((fieldValues ?? []).filter((value) => value.fieldDefinition.isActive).map((value) => {
        const normalized = normalizeTaskFieldRecord(value);
        return [normalized.key, normalized.value];
      })),
      acceptanceReadiness,
      attachments: task.attachments.map((attachment) => ({
        ...attachment,
        byteSize: Number(attachment.byteSize),
      })),
    },
    capabilities: detailCapabilities(task, input.userId, canGovern, Boolean(task.archivedAt)),
  };
}

function savedViewData(input: { name: string; query: ParsedTaskQuery }) {
  return {
    name: input.name.trim(),
    spaceId: null,
    viewMode: input.query.view,
    filters: input.query,
    grouping: input.query.group,
    sorting: input.query.sort,
  };
}

export function listTaskSavedViews(input: { userId: string; db?: TaskSavedViewDb }) {
  if (!input.db) requireUserTaskReads();
  const db = input.db ?? (prisma as unknown as TaskSavedViewDb);
  return db.taskSavedView.findMany({ where: { userId: input.userId }, orderBy: { updatedAt: "desc" } });
}

export function saveTaskView(input: {
  userId: string;
  id: string;
  name: string;
  query: ParsedTaskQuery;
  db?: TaskSavedViewDb;
}) {
  if (!input.db) requireUserTaskWrites();
  const db = input.db ?? (prisma as unknown as TaskSavedViewDb);
  return db.taskSavedView.create({ data: { id: input.id, userId: input.userId, ...savedViewData(input) } });
}

export async function updateTaskSavedView(input: {
  userId: string;
  viewId: string;
  name: string;
  query: ParsedTaskQuery;
  db?: TaskSavedViewDb;
}) {
  if (!input.db) requireUserTaskWrites();
  const db = input.db ?? (prisma as unknown as TaskSavedViewDb);
  return db.taskSavedView.updateMany({
    where: { id: input.viewId, userId: input.userId },
    data: savedViewData(input),
  });
}

export function deleteTaskSavedView(input: { userId: string; viewId: string; db?: TaskSavedViewDb }) {
  if (!input.db) requireUserTaskWrites();
  const db = input.db ?? (prisma as unknown as TaskSavedViewDb);
  return db.taskSavedView.deleteMany({ where: { id: input.viewId, userId: input.userId } });
}
