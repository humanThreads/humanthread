import {
  assertCanReadProject,
  prisma,
  scheduledTaskProjectDigest,
} from "@humanthread/db";
import {
  buildProjectScheduledTaskReport,
  type ProjectScheduledTaskReport,
  type ProjectScheduledTaskReportNode,
} from "@humanthread/orchestration-core";
import {
  buildProjectExecutionOptions,
  type AgentProfileOptionInput,
  type LoopExecutionOption,
  type ProjectExecutionBindingInput,
  type WorkerPoolOptionInput,
} from "./execution-options";
import {
  readLoopRunProjection,
  type LoopRunProjection,
} from "./loop-read-model";

type JsonRecord = Record<string, unknown>;

const ACTIVE_RUN_STATUSES = ["preparing", "running", "waiting"] as const;
const EDITABLE_PROJECT_ROLES = new Set(["owner", "maintainer", "contributor"]);
const RECENT_RUN_LIMIT = 50;

export interface ProjectScheduledTaskLoopOption {
  id: string;
  name: string;
  scope: "project" | "task";
  versionNumber: number;
  targetOptions?: ProjectScheduledTaskTargetOption[];
}

export type ProjectScheduledTaskTargetOption = LoopExecutionOption & {
  loopBindingIds: string[];
};

export interface ProjectScheduledTaskExecutionTarget {
  type: "local_agent" | "linux_worker_pool";
  id: string;
  displayName: string;
  provider: "codex" | "claude" | null;
}

export interface ProjectScheduledTaskLoopBinding {
  id: string;
  name: string;
  scope: "project" | "task";
  versionNumber: number | null;
}

export interface ProjectScheduledTaskListItem {
  id: string;
  name: string;
  description: string;
  status: string;
  version: number;
  cronExpression: string;
  timezone: string;
  contentMode: string;
  contentMarkdown: string | null;
  loopBinding: ProjectScheduledTaskLoopBinding | null;
  executionTarget: ProjectScheduledTaskExecutionTarget | null;
  nextRunAt: string | null;
  pendingScheduledFor: string | null;
  lastScheduledFor: string | null;
  updatedAt: string | null;
  activeRun: { id: string; status: string } | null;
  latestRun: ProjectScheduledTaskLatestRun | null;
}

export interface ProjectScheduledTaskLatestRun {
  id: string;
  status: string;
  triggeredAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  targetType: "local_agent" | "linux_worker_pool" | null;
  reportEntry: { label: string; href: string } | null;
}

export interface ProjectScheduledTaskListModel {
  tasks: ProjectScheduledTaskListItem[];
  loopOptions: ProjectScheduledTaskLoopOption[];
  targetOptions: ProjectScheduledTaskTargetOption[];
  canEdit: boolean;
}

export interface ProjectScheduledTaskRunSummary {
  id: string;
  status: string;
  triggerSource: string;
  scheduledFor: string | null;
  triggeredAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  taskSnapshot: unknown;
  executionTargetSnapshot: unknown;
  loopRunReference: { id: string; engineKind: "graph_v1" } | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface ProjectScheduledTaskSelectedRun extends ProjectScheduledTaskRunSummary {
  contentSnapshot: string | null;
}

export type ProjectScheduledTaskLoopRunProjection = Omit<LoopRunProjection, "nodes"> & {
  nodes: Array<LoopRunProjection["nodes"][number] & { artifactRefs: string[] }>;
};

export interface ProjectScheduledTaskDetailModel {
  task: ProjectScheduledTaskListItem;
  loopOptions: ProjectScheduledTaskLoopOption[];
  targetOptions: ProjectScheduledTaskTargetOption[];
  canEdit: boolean;
  runs: ProjectScheduledTaskRunSummary[];
  selectedRun: ProjectScheduledTaskSelectedRun | null;
  loopRun: ProjectScheduledTaskLoopRunProjection | null;
  report: ProjectScheduledTaskReport;
}

export interface ProjectScheduledTaskRunViewModel {
  run: ProjectScheduledTaskSelectedRun;
  loopRun: ProjectScheduledTaskLoopRunProjection | null;
  report: ProjectScheduledTaskReport;
}

type RawScheduledTask = {
  id?: unknown;
  projectDigest?: unknown;
  name?: unknown;
  description?: unknown;
  status?: unknown;
  version?: unknown;
  cronExpression?: unknown;
  timezone?: unknown;
  contentMode?: unknown;
  contentMarkdown?: unknown;
  configurationSnapshot?: unknown;
  executionTargetSnapshot?: unknown;
  nextRunAt?: unknown;
  pendingScheduledFor?: unknown;
  lastScheduledFor?: unknown;
  updatedAt?: unknown;
  activeRun?: unknown;
  latestRun?: unknown;
  runs?: unknown;
};

type RawScheduledTaskRun = {
  id?: unknown;
  status?: unknown;
  triggerSource?: unknown;
  scheduledFor?: unknown;
  triggeredAt?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  taskSnapshot?: unknown;
  contentSnapshot?: unknown;
  executionTargetSnapshot?: unknown;
  loopRun?: unknown;
  failureCode?: unknown;
  failureMessage?: unknown;
};

type LinkedLoopRun = {
  id: string;
  projectId?: string | null;
};

type RawArtifact = {
  id?: unknown;
  storageKey?: unknown;
  loopNodeRunId?: unknown;
};

interface ProjectScheduledTaskReadDependencies {
  assertCanReadProject(input: { userId: string; projectId: string }): Promise<unknown>;
  loadTasks(input: {
    projectDigest: string;
    status?: "inactive" | "enabled" | "disabled";
  }): Promise<RawScheduledTask[]>;
  loadTask(input: { scheduledTaskId: string; projectDigest: string }): Promise<RawScheduledTask | null>;
  loadRuns(input: { scheduledTaskId: string; limit: number }): Promise<RawScheduledTaskRun[]>;
  loadRun(input: { scheduledTaskId: string; runId: string }): Promise<RawScheduledTaskRun | null>;
  loadLoopOptions(input: { projectId: string }): Promise<ProjectScheduledTaskLoopOption[]>;
  loadTargetOptions(input: { projectId: string }): Promise<ProjectScheduledTaskTargetOption[]>;
  readLoopRun(input: { userId: string; loopRunId: string }): Promise<LoopRunProjection>;
  loadArtifacts(input: { loopRunId: string }): Promise<RawArtifact[]>;
}

const DEFAULT_DEPENDENCIES: ProjectScheduledTaskReadDependencies = {
  assertCanReadProject: (input) => assertCanReadProject(input),
  loadTasks: ({ projectDigest, status }) => prisma.projectScheduledTask.findMany({
    where: {
      projectDigest,
      ...(status ? { status } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      projectDigest: true,
      name: true,
      description: true,
      status: true,
      version: true,
      cronExpression: true,
      timezone: true,
      contentMode: true,
      contentMarkdown: true,
      configurationSnapshot: true,
      executionTargetSnapshot: true,
      nextRunAt: true,
      pendingScheduledFor: true,
      lastScheduledFor: true,
      updatedAt: true,
      runs: {
        orderBy: [{ triggeredAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          status: true,
          triggeredAt: true,
          startedAt: true,
          finishedAt: true,
          executionTargetSnapshot: true,
        },
      },
    },
  }) as Promise<RawScheduledTask[]>,
  loadTask: ({ scheduledTaskId, projectDigest }) => prisma.projectScheduledTask.findFirst({
    where: { id: scheduledTaskId, projectDigest },
    select: {
      id: true,
      projectDigest: true,
      name: true,
      description: true,
      status: true,
      version: true,
      cronExpression: true,
      timezone: true,
      contentMode: true,
      contentMarkdown: true,
      configurationSnapshot: true,
      executionTargetSnapshot: true,
      nextRunAt: true,
      pendingScheduledFor: true,
      lastScheduledFor: true,
      updatedAt: true,
    },
  }) as Promise<RawScheduledTask | null>,
  loadRuns: ({ scheduledTaskId, limit }) => prisma.projectScheduledTaskRun.findMany({
    where: { scheduledTaskId },
    orderBy: [{ triggeredAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      status: true,
      triggerSource: true,
      scheduledFor: true,
      triggeredAt: true,
      startedAt: true,
      finishedAt: true,
      taskSnapshot: true,
      executionTargetSnapshot: true,
      failureCode: true,
      failureMessage: true,
      loopRun: { select: { id: true, projectId: true } },
    },
  }) as Promise<RawScheduledTaskRun[]>,
  loadRun: ({ scheduledTaskId, runId }) => prisma.projectScheduledTaskRun.findFirst({
    where: { id: runId, scheduledTaskId },
    select: {
      id: true,
      status: true,
      triggerSource: true,
      scheduledFor: true,
      triggeredAt: true,
      startedAt: true,
      finishedAt: true,
      taskSnapshot: true,
      contentSnapshot: true,
      executionTargetSnapshot: true,
      failureCode: true,
      failureMessage: true,
      loopRun: { select: { id: true, projectId: true } },
    },
  }) as Promise<RawScheduledTaskRun | null>,
  loadLoopOptions: async ({ projectId }) => {
    const rows = await prisma.projectLoopBinding.findMany({
      where: {
        projectId,
        status: "enabled",
        loopDefinition: {
          status: { not: "archived" },
          latestPublishedVersion: { status: "published" },
        },
        activeVersion: { status: "published" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        loopDefinition: {
          select: {
            name: true,
            scope: true,
            status: true,
            latestPublishedVersion: { select: { status: true } },
          },
        },
        activeVersion: { select: { versionNumber: true, status: true } },
      },
    });
    return buildProjectScheduledTaskLoopOptions(rows);
  },
  loadTargetOptions: loadProjectTargetOptions,
  readLoopRun: (input) => readLoopRunProjection(input),
  loadArtifacts: ({ loopRunId }) => prisma.artifact.findMany({
    where: { loopNodeRun: { loopRunId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, storageKey: true, loopNodeRunId: true },
  }) as Promise<RawArtifact[]>,
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integerValue(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function isoValue(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function requiredIsoValue(value: unknown): string {
  return isoValue(value) ?? new Date(0).toISOString();
}

function parseExecutionTarget(value: unknown): ProjectScheduledTaskExecutionTarget | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  const id = stringValue(value.id);
  const displayName = stringValue(value.displayName);
  if (!id || !displayName || (type !== "local_agent" && type !== "linux_worker_pool")) return null;
  const provider = type === "local_agent" && (value.provider === "codex" || value.provider === "claude")
    ? value.provider
    : null;
  return { type, id, displayName, provider };
}

function parseLoopBinding(
  task: RawScheduledTask,
  loopOptions: ProjectScheduledTaskLoopOption[],
): ProjectScheduledTaskLoopBinding | null {
  const configuration = isRecord(task.configurationSnapshot) ? task.configurationSnapshot : null;
  const id = stringValue(configuration?.loopBindingId);
  if (!id) return null;
  const option = loopOptions.find((candidate) => candidate.id === id);
  const snapshotScope = configuration?.loopScope;
  return {
    id,
    name: option?.name ?? id,
    scope: option?.scope ?? (snapshotScope === "task" ? "task" : "project"),
    versionNumber: option?.versionNumber ?? null,
  };
}

function linkedLoopRun(value: unknown): LinkedLoopRun | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    projectId: stringValue(value.projectId),
  };
}

function activeRun(task: RawScheduledTask): { id: string; status: string } | null {
  const candidate = isRecord(task.activeRun)
    ? task.activeRun
    : Array.isArray(task.runs) && isRecord(task.runs[0]) ? task.runs[0] : null;
  const id = stringValue(candidate?.id);
  const status = stringValue(candidate?.status);
  return id && status && ACTIVE_RUN_STATUSES.includes(status as typeof ACTIVE_RUN_STATUSES[number])
    ? { id, status }
    : null;
}

function latestRun(task: RawScheduledTask, projectId: string): ProjectScheduledTaskLatestRun | null {
  const candidate = isRecord(task.latestRun)
    ? task.latestRun
    : Array.isArray(task.runs) && isRecord(task.runs[0]) ? task.runs[0] : null;
  const id = stringValue(candidate?.id);
  const status = stringValue(candidate?.status);
  const triggeredAt = isoValue(candidate?.triggeredAt);
  if (!id || !status || !triggeredAt) return null;
  const startedAt = isoValue(candidate?.startedAt);
  const finishedAt = isoValue(candidate?.finishedAt);
  const executionTarget = parseExecutionTarget(candidate?.executionTargetSnapshot);
  return {
    id,
    status,
    triggeredAt,
    startedAt,
    finishedAt,
    durationMs: runDurationMs(startedAt, finishedAt),
    targetType: executionTarget?.type ?? null,
    reportEntry: {
      label: "任务报告",
      href: `/projects/${encodeURIComponent(projectId)}/scheduled-tasks/${encodeURIComponent(stringValue(task.id) ?? "")}?tab=report&run=${encodeURIComponent(id)}`,
    },
  };
}

function runDurationMs(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished) && finished >= started
    ? finished - started
    : null;
}

function taskListItem(
  task: RawScheduledTask,
  loopOptions: ProjectScheduledTaskLoopOption[],
  projectId: string,
): ProjectScheduledTaskListItem | null {
  const id = stringValue(task.id);
  const status = stringValue(task.status);
  if (!id || !status) return null;
  return {
    id,
    name: stringValue(task.name) ?? "",
    description: stringValue(task.description) ?? "",
    status,
    version: integerValue(task.version) ?? 1,
    cronExpression: stringValue(task.cronExpression) ?? "",
    timezone: stringValue(task.timezone) ?? "Asia/Shanghai",
    contentMode: stringValue(task.contentMode) ?? "loop_managed",
    contentMarkdown: stringValue(task.contentMarkdown),
    loopBinding: parseLoopBinding(task, loopOptions),
    executionTarget: parseExecutionTarget(task.executionTargetSnapshot),
    nextRunAt: isoValue(task.nextRunAt),
    pendingScheduledFor: isoValue(task.pendingScheduledFor),
    lastScheduledFor: isoValue(task.lastScheduledFor),
    updatedAt: isoValue(task.updatedAt),
    activeRun: activeRun(task),
    latestRun: latestRun(task, projectId),
  };
}

function authoritativeLoopRun(run: RawScheduledTaskRun | null | undefined, projectId: string): LinkedLoopRun | null {
  const linked = linkedLoopRun(run?.loopRun);
  return linked?.projectId === projectId ? linked : null;
}

function runSummary(run: RawScheduledTaskRun, projectId: string): ProjectScheduledTaskRunSummary | null {
  const id = stringValue(run.id);
  const status = stringValue(run.status);
  if (!id || !status) return null;
  const linked = authoritativeLoopRun(run, projectId);
  return {
    id,
    status,
    triggerSource: stringValue(run.triggerSource) ?? "scheduled",
    scheduledFor: isoValue(run.scheduledFor),
    triggeredAt: requiredIsoValue(run.triggeredAt),
    startedAt: isoValue(run.startedAt),
    finishedAt: isoValue(run.finishedAt),
    taskSnapshot: run.taskSnapshot,
    executionTargetSnapshot: run.executionTargetSnapshot,
    loopRunReference: linked ? { id: linked.id, engineKind: "graph_v1" } : null,
    failureCode: stringValue(run.failureCode),
    failureMessage: stringValue(run.failureMessage),
  };
}

function selectedRun(run: RawScheduledTaskRun, projectId: string): ProjectScheduledTaskSelectedRun | null {
  const summary = runSummary(run, projectId);
  if (!summary) return null;
  return {
    ...summary,
    contentSnapshot: stringValue(run.contentSnapshot),
  };
}

function latestAttempt(node: LoopRunProjection["nodes"][number]): { result: unknown; error: unknown } {
  const attempts = Array.isArray(node.attempts) ? node.attempts : [];
  const attempt = attempts[attempts.length - 1];
  return { result: attempt?.result ?? null, error: attempt?.error ?? null };
}

function mergeArtifacts(
  projection: LoopRunProjection,
  artifacts: RawArtifact[],
): ProjectScheduledTaskLoopRunProjection {
  const artifactRefsByNodeRunId = new Map<string, string[]>();
  for (const artifact of artifacts) {
    const nodeRunId = stringValue(artifact.loopNodeRunId);
    const storageKey = stringValue(artifact.storageKey);
    if (!nodeRunId || !storageKey) continue;
    const refs = artifactRefsByNodeRunId.get(nodeRunId) ?? [];
    if (!refs.includes(storageKey)) refs.push(storageKey);
    artifactRefsByNodeRunId.set(nodeRunId, refs);
  }
  return {
    ...projection,
    nodes: projection.nodes.map((node) => ({
      ...node,
      artifactRefs: node.currentNodeRunId ? artifactRefsByNodeRunId.get(node.currentNodeRunId) ?? [] : [],
    })),
  };
}

function reportNodes(projection: ProjectScheduledTaskLoopRunProjection): ProjectScheduledTaskReportNode[] {
  return projection.nodes.map((node) => {
    const latest = latestAttempt(node);
    return {
      nodeKey: node.nodeKey,
      label: node.label,
      status: node.status,
      result: latest.result,
      error: latest.error,
      artifactRefs: node.artifactRefs,
    };
  });
}

async function readLoopRunAggregate(input: {
  userId: string;
  loopRunId: string;
  deps: ProjectScheduledTaskReadDependencies;
  visited: Set<string>;
  ancestry: Set<string>;
  depth: number;
  labelPrefix?: string;
}): Promise<{ projection: LoopRunProjection; artifacts: RawArtifact[] } | null> {
  const MAX_CHILD_LOOP_DEPTH = 16;
  if (input.depth > MAX_CHILD_LOOP_DEPTH || input.visited.has(input.loopRunId) || input.ancestry.has(input.loopRunId)) {
    return null;
  }
  input.visited.add(input.loopRunId);
  const nextAncestry = new Set(input.ancestry);
  nextAncestry.add(input.loopRunId);
  const root = await input.deps.readLoopRun({ userId: input.userId, loopRunId: input.loopRunId });
  const artifacts = await input.deps.loadArtifacts({ loopRunId: input.loopRunId });
  const children = await Promise.all((root.childRuns ?? []).map(async (child) => {
    try {
      return await readLoopRunAggregate({
        ...input,
        loopRunId: child.id,
        visited: input.visited,
        ancestry: nextAncestry,
        depth: input.depth + 1,
        labelPrefix: `${input.labelPrefix ?? root.run.id} / ${child.id}`,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }));
  const successfulChildren = children.filter((child): child is NonNullable<typeof child> => child !== null);
  return {
    projection: {
      ...root,
      eventCursor: root.eventCursor + successfulChildren.reduce((total, child) => total + child.projection.eventCursor, 0),
      nodes: [
        ...root.nodes.map((node) => input.labelPrefix ? {
          ...node,
          nodeKey: `${input.loopRunId}:${node.nodeKey}`,
          label: `${input.labelPrefix} / ${node.label}`,
        } : node),
        ...successfulChildren.flatMap((child) => child.projection.nodes),
      ],
      edges: [
        ...(root.edges ?? []),
        ...successfulChildren.flatMap((child) => (child.projection.edges ?? []).map((edge) => ({
          ...edge,
          edgeId: `${child.projection.run.id}:${edge.edgeId}`,
        }))),
      ],
      activities: [
        ...root.activities,
        ...successfulChildren.flatMap((child) => child.projection.activities),
      ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id)),
      pendingApprovals: [
        ...(root.pendingApprovals ?? []),
        ...successfulChildren.flatMap((child) => child.projection.pendingApprovals ?? []),
      ],
    },
    artifacts: [...artifacts, ...successfulChildren.flatMap((child) => child.artifacts)],
  };
}

function emptyReport(run: ProjectScheduledTaskSelectedRun | null): ProjectScheduledTaskReport {
  return buildProjectScheduledTaskReport({
    runStatus: run?.status ?? "not_started",
    startedAt: run?.startedAt ?? null,
    finishedAt: run?.finishedAt ?? null,
    nodes: [],
  });
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "not_found";
}

function noLoopArtifacts(): Promise<RawArtifact[]> {
  return Promise.resolve([]);
}

function unavailableLoopProjection(): Promise<LoopRunProjection> {
  return Promise.reject(Object.assign(new Error("Graph LoopRun not found"), { code: "not_found" }));
}

function resolveDependencies(
  dependencies: Partial<ProjectScheduledTaskReadDependencies> | undefined,
): {
  deps: ProjectScheduledTaskReadDependencies;
  hasExplicitLoadRun: boolean;
} {
  if (!dependencies) {
    return { deps: DEFAULT_DEPENDENCIES, hasExplicitLoadRun: true };
  }
  return {
    deps: {
      assertCanReadProject: dependencies.assertCanReadProject ?? DEFAULT_DEPENDENCIES.assertCanReadProject,
      loadTasks: dependencies.loadTasks ?? DEFAULT_DEPENDENCIES.loadTasks,
      loadTask: dependencies.loadTask ?? DEFAULT_DEPENDENCIES.loadTask,
      loadRuns: dependencies.loadRuns ?? DEFAULT_DEPENDENCIES.loadRuns,
      loadRun: dependencies.loadRun ?? DEFAULT_DEPENDENCIES.loadRun,
      loadLoopOptions: dependencies.loadLoopOptions ?? (() => Promise.resolve([])),
      loadTargetOptions: dependencies.loadTargetOptions ?? (() => Promise.resolve([])),
      readLoopRun: dependencies.readLoopRun ?? unavailableLoopProjection,
      loadArtifacts: dependencies.loadArtifacts ?? noLoopArtifacts,
    },
    hasExplicitLoadRun: dependencies.loadRun !== undefined,
  };
}

async function readRunFacts(input: {
  userId: string;
  projectId: string;
  run: RawScheduledTaskRun | null;
  deps: ProjectScheduledTaskReadDependencies;
}): Promise<{
  loopRun: ProjectScheduledTaskLoopRunProjection | null;
  report: ProjectScheduledTaskReport;
  selectedRun: ProjectScheduledTaskSelectedRun | null;
}> {
  const selected = input.run ? selectedRun(input.run, input.projectId) : null;
  if (!selected) return { loopRun: null, report: emptyReport(null), selectedRun: null };
  const linked = authoritativeLoopRun(input.run, input.projectId);
  const loopRunId = linked?.id ?? null;
  if (!loopRunId) {
    return { loopRun: null, report: emptyReport(selected), selectedRun: selected };
  }
  try {
    const aggregate = await readLoopRunAggregate({
      userId: input.userId,
      loopRunId,
      deps: input.deps,
      visited: new Set(),
      ancestry: new Set(),
      depth: 0,
    });
    if (!aggregate) return { loopRun: null, report: emptyReport(selected), selectedRun: selected };
    const loopRun = mergeArtifacts(aggregate.projection, aggregate.artifacts);
    return {
      loopRun,
      report: buildProjectScheduledTaskReport({
        runStatus: selected.status,
        startedAt: selected.startedAt,
        finishedAt: selected.finishedAt,
        nodes: reportNodes(loopRun),
      }),
      selectedRun: selected,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return { loopRun: null, report: emptyReport(selected), selectedRun: selected };
    }
    throw error;
  }
}

function canEditProject(access: unknown): boolean {
  return isRecord(access) && typeof access.role === "string" && EDITABLE_PROJECT_ROLES.has(access.role);
}

async function loadProjectTargetOptions(input: { projectId: string }): Promise<ProjectScheduledTaskTargetOption[]> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      spaceId: true,
      workerPoolId: true,
      loopBindings: {
        where: {
          status: "enabled",
          loopDefinition: {
            status: { not: "archived" },
            latestPublishedVersion: { status: "published" },
          },
          activeVersion: { status: "published" },
        },
        select: {
          allowedAgentProfileIds: true,
          allowedProviders: true,
          workerStageConfigurations: true,
          workerPoolId: true,
          status: true,
          loopDefinition: {
            select: {
              status: true,
              latestPublishedVersion: { select: { status: true } },
            },
          },
          activeVersion: { select: { status: true } },
        },
      },
    },
  });
  if (!project?.spaceId) return [];
  const workerPoolIds = [...new Set([
    ...(project.workerPoolId ? [project.workerPoolId] : []),
    ...project.loopBindings.flatMap((binding) => binding.workerPoolId ? [binding.workerPoolId] : []),
  ])];
  const [profiles, pools] = await Promise.all([
    prisma.agentProfile.findMany({
      where: { spaceId: project.spaceId, status: "active" },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, provider: true },
    }),
    workerPoolIds.length === 0 ? Promise.resolve([]) : prisma.workerPool.findMany({
      where: { id: { in: workerPoolIds } },
      select: {
        id: true,
        displayName: true,
        status: true,
        revokedAt: true,
        maxConcurrentRuns: true,
        sessions: {
          select: {
            requestedConcurrency: true,
            lastSeenAt: true,
            linuxRuns: { select: { id: true } },
          },
        },
      },
    }),
  ]);
  return buildProjectScheduledTaskTargetOptions({
    project: { workerPoolId: project.workerPoolId, loopBindings: project.loopBindings },
    agentProfiles: profiles,
    workerPools: pools,
  });
}

export function buildProjectScheduledTaskLoopOptions(rows: unknown[]): ProjectScheduledTaskLoopOption[] {
  return rows.flatMap((value) => {
    if (!isEnabledProjectScheduledTaskLoop(value)) return [];
    const row = value as JsonRecord;
    const bindingId = stringValue(row.id);
    const definition = recordValue(row.loopDefinition);
    const activeVersion = recordValue(row.activeVersion);
    const name = stringValue(definition?.name);
    const versionNumber = integerValue(activeVersion?.versionNumber);
    if (!bindingId || !name || versionNumber === null) return [];
    return [{
      id: bindingId,
      name,
      scope: definition?.scope === "task" ? "task" as const : "project" as const,
      versionNumber,
      targetOptions: [],
    }];
  });
}

export function buildProjectScheduledTaskTargetOptions(input: {
  project: { workerPoolId: string | null; loopBindings: unknown[] };
  agentProfiles: AgentProfileOptionInput[];
  workerPools: WorkerPoolOptionInput[];
}): ProjectScheduledTaskTargetOption[] {
  const eligibleBindings = input.project.loopBindings.filter(isEnabledProjectScheduledTaskLoop);
  const poolsById = new Map(input.workerPools.map((pool) => [pool.id, pool]));
  const options = new Map<string, ProjectScheduledTaskTargetOption>();
  for (const value of eligibleBindings) {
    const binding = recordValue(value);
    if (!binding) continue;
    const poolId = stringValue(binding.workerPoolId) ?? input.project.workerPoolId;
    const built = buildProjectExecutionOptions({
      binding: binding as unknown as ProjectExecutionBindingInput,
      workerPool: poolId ? poolsById.get(poolId) ?? null : null,
      agentProfiles: input.agentProfiles,
    }).options;
    for (const option of built) {
      const key = `${option.type}:${option.id}`;
      const current = options.get(key);
      if (!current) {
        options.set(key, { ...option, loopBindingIds: [stringValue(binding.id) ?? ""] });
      } else {
        if (!current.loopBindingIds.includes(stringValue(binding.id) ?? "")) {
          current.loopBindingIds.push(stringValue(binding.id) ?? "");
        }
        if (!current.ready && option.ready) {
          options.set(key, { ...option, loopBindingIds: current.loopBindingIds });
        }
      }
    }
  }
  return [...options.values()];
}

function withLoopTargetOptions(
  loopOptions: ProjectScheduledTaskLoopOption[],
  targetOptions: ProjectScheduledTaskTargetOption[],
): ProjectScheduledTaskLoopOption[] {
  return loopOptions.map((option) => ({
    ...option,
    targetOptions: targetOptions.filter((target) => target.loopBindingIds.includes(option.id)),
  }));
}

function isEnabledProjectScheduledTaskLoop(value: unknown): boolean {
  const row = recordValue(value);
  const definition = recordValue(row?.loopDefinition);
  const activeVersion = recordValue(row?.activeVersion);
  const latestPublishedVersion = recordValue(definition?.latestPublishedVersion);
  return row?.status === "enabled"
    && definition?.status !== "archived"
    && latestPublishedVersion?.status === "published"
    && activeVersion?.status === "published";
}

function recordValue(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

export async function readProjectScheduledTaskList(input: {
  userId: string;
  projectId: string;
  status?: "inactive" | "enabled" | "disabled";
}, dependencies?: Partial<ProjectScheduledTaskReadDependencies>): Promise<ProjectScheduledTaskListModel | null> {
  const { deps } = resolveDependencies(dependencies);
  const access = await deps.assertCanReadProject({ userId: input.userId, projectId: input.projectId });
  const projectDigest = scheduledTaskProjectDigest(input.projectId);
  const [rows, baseLoopOptions, targetOptions] = await Promise.all([
    deps.loadTasks({ projectDigest, ...(input.status ? { status: input.status } : {}) }),
    deps.loadLoopOptions({ projectId: input.projectId }),
    deps.loadTargetOptions({ projectId: input.projectId }),
  ]);
  const loopOptions = withLoopTargetOptions(baseLoopOptions, targetOptions);
  return {
    tasks: rows.flatMap((row) => {
      const item = taskListItem(row, loopOptions, input.projectId);
      return item ? [item] : [];
    }),
    loopOptions,
    targetOptions,
    canEdit: canEditProject(access),
  };
}

export async function readProjectScheduledTaskDetail(input: {
  userId: string;
  projectId: string;
  scheduledTaskId: string;
  runId?: string;
}, dependencies?: Partial<ProjectScheduledTaskReadDependencies>): Promise<ProjectScheduledTaskDetailModel | null> {
  const { deps, hasExplicitLoadRun } = resolveDependencies(dependencies);
  const access = await deps.assertCanReadProject({ userId: input.userId, projectId: input.projectId });
  const projectDigest = scheduledTaskProjectDigest(input.projectId);
  const task = await deps.loadTask({ scheduledTaskId: input.scheduledTaskId, projectDigest });
  if (!task) return null;
  if (typeof task.projectDigest === "string" && task.projectDigest !== projectDigest) return null;
  const [runRows, baseLoopOptions, targetOptions] = await Promise.all([
    deps.loadRuns({ scheduledTaskId: input.scheduledTaskId, limit: RECENT_RUN_LIMIT }),
    deps.loadLoopOptions({ projectId: input.projectId }),
    deps.loadTargetOptions({ projectId: input.projectId }),
  ]);
  const loopOptions = withLoopTargetOptions(baseLoopOptions, targetOptions);
  const selectedRunId = input.runId ?? stringValue(runRows[0]?.id);
  const exactRun = selectedRunId
    ? hasExplicitLoadRun
      ? await deps.loadRun({ scheduledTaskId: input.scheduledTaskId, runId: selectedRunId })
      : input.runId
        ? runRows.find((run) => run.id === input.runId) ?? null
        : runRows[0] ?? null
    : null;
  if (selectedRunId && !exactRun) return null;
  const facts = await readRunFacts({
    userId: input.userId,
    projectId: input.projectId,
    run: exactRun,
    deps,
  });
  const taskModel = taskListItem(task, loopOptions, input.projectId);
  if (!taskModel) return null;
  return {
    task: taskModel,
    loopOptions,
    targetOptions,
    canEdit: canEditProject(access),
    runs: runRows.flatMap((run) => {
      const summary = runSummary(run, input.projectId);
      return summary ? [summary] : [];
    }),
    selectedRun: facts.selectedRun,
    loopRun: facts.loopRun,
    report: facts.report,
  };
}

export async function readProjectScheduledTaskRunView(input: {
  userId: string;
  projectId: string;
  scheduledTaskId: string;
  runId: string;
}, dependencies?: Partial<ProjectScheduledTaskReadDependencies>): Promise<ProjectScheduledTaskRunViewModel | null> {
  const { deps } = resolveDependencies(dependencies);
  await deps.assertCanReadProject({ userId: input.userId, projectId: input.projectId });
  const projectDigest = scheduledTaskProjectDigest(input.projectId);
  const task = await deps.loadTask({ scheduledTaskId: input.scheduledTaskId, projectDigest });
  if (!task) return null;
  if (typeof task.projectDigest === "string" && task.projectDigest !== projectDigest) return null;
  const run = await deps.loadRun({ scheduledTaskId: input.scheduledTaskId, runId: input.runId });
  if (!run) return null;
  const facts = await readRunFacts({
    userId: input.userId,
    projectId: input.projectId,
    run,
    deps,
  });
  if (!facts.selectedRun) return null;
  return {
    run: facts.selectedRun,
    loopRun: facts.loopRun,
    report: facts.report,
  };
}
