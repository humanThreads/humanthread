import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appendOrchestrationEvents,
  createGraphLoopRun,
  createMilestoneReleaseSnapshot,
  prisma,
  readPublishedLoopVersionsForProject,
  snapshotBindingGrants,
  type CreateGraphLoopRunInput,
} from "@humanthread/db";
import {
  bindingMatchesMilestoneEvent,
  buildLoopTriggerIdentity,
  evaluateMilestoneReleaseReadiness,
  isLoopGraphEnabled,
  readLoopGraphFeatureFlags,
  resolvePublishedRunGraphSnapshot,
  resolveLoopTriggerSnapshots,
  type LoopGraphFeatureFlags,
  type MilestoneReleaseTaskFact,
  type MilestoneReleaseSnapshot,
  type PublishedSnapshotLoopVersionInput,
} from "@humanthread/orchestration-core";
import { createEventEnvelope } from "@humanthread/orchestration-core";

const execFileAsync = promisify(execFile);

type MilestoneState = {
  id: string;
  projectId: string;
  version: number;
  blockers: number;
  stagingBranch: string;
  productionBranch: string;
  tasks: Array<MilestoneReleaseTaskFact & { taskNumber: number }>;
  stagingBaseCommit: string;
  productionBaseCommit: string;
};

type ReleaseBinding = Parameters<typeof resolveLoopTriggerSnapshots>[0];

interface MilestoneReleaseTriggerDependencies {
  flags: LoopGraphFeatureFlags;
  now(): Date;
  loadMilestone(input: { milestoneId: string }): Promise<MilestoneState | null>;
  listEnabledBindings(input: { projectId: string }): Promise<unknown[]>;
  readPublishedVersions(projectId: string): Promise<PublishedSnapshotLoopVersionInput[]>;
  snapshotBindingGrants(input: { bindingId: string; now: Date }): Promise<unknown[]>;
  createReleaseRunAndSnapshot(input: {
    run: CreateGraphLoopRunInput;
    snapshot: MilestoneReleaseSnapshot;
  }): Promise<unknown>;
}

const defaultDependencies: MilestoneReleaseTriggerDependencies = {
  flags: readLoopGraphFeatureFlags(process.env),
  now: () => new Date(),
  loadMilestone: loadMilestoneState,
  listEnabledBindings: ({ projectId }) => prisma.projectLoopBinding.findMany({
    where: { projectId, status: "enabled", bindingRole: "milestone_release" },
    select: {
      id: true,
      projectId: true,
      loopDefinitionId: true,
      activeVersionId: true,
      status: true,
      version: true,
      createdByUserId: true,
      triggerPolicy: true,
      parameterOverrides: true,
      notificationPolicy: true,
      automationGrantIds: true,
      allowedAgentProfileIds: true,
      allowedProviders: true,
      workerStageConfigurations: true,
      project: { select: { workerPoolId: true, workerRepositoryUrl: true, workerBranchPolicy: true } },
      activeVersion: { select: { id: true, status: true, maxStages: true, maxRepeatCount: true, platformMaxTransitions: true } },
      loopDefinition: {
        select: {
          scope: true,
          latestPublishedVersion: {
            select: {
              id: true,
              status: true,
              maxStages: true,
              maxRepeatCount: true,
              platformMaxTransitions: true,
            },
          },
        },
      },
    },
  }),
  readPublishedVersions: (projectId) => readPublishedLoopVersionsForProject(projectId),
  snapshotBindingGrants: (input) => snapshotBindingGrants(input),
  createReleaseRunAndSnapshot: async ({ run, snapshot }) => {
    await createGraphLoopRun(run);
    return createMilestoneReleaseSnapshot({
      ...snapshot,
      loopRunId: run.id,
      command: {
        commandId: `release-snapshot:${run.id}`,
        correlationId: run.correlationId,
        actor: run.actor,
        issuedAt: run.occurredAt,
        payload: snapshot,
      },
    });
  },
};

export async function emitMilestoneReleaseReadyEvent(input: {
  projectId: string;
  milestoneId: string;
  taskEventId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
}): Promise<boolean> {
  const milestone = await loadMilestoneState({ milestoneId: input.milestoneId });
  if (!milestone || milestone.projectId !== input.projectId) return false;
  const readiness = evaluateMilestoneReleaseReadiness({ tasks: milestone.tasks, blockers: milestone.blockers });
  if (!readiness.ready) return false;
  const eventId = `milestone-release-ready:${milestone.id}:${milestone.version}`;
  const releaseWorktreePaths = resolveWorkerReleaseWorktreePaths(milestone.projectId);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.orchestrationEvent.findUnique({ where: { id: eventId } });
    if (existing) return;
    const aggregate = await tx.orchestrationAggregateSequence.upsert({
      where: { aggregateType_aggregateId: { aggregateType: "milestone", aggregateId: milestone.id } },
      create: { aggregateType: "milestone", aggregateId: milestone.id, sequence: 1 },
      update: { sequence: { increment: 1 } },
      select: { sequence: true },
    });
    const event = createEventEnvelope({
      id: eventId,
      eventType: "milestone.release_ready",
      aggregate: { type: "milestone", id: milestone.id, version: milestone.version },
      sequence: aggregate.sequence,
      correlationId: input.correlationId,
      causationId: input.causationId ?? input.taskEventId,
      commandId: input.taskEventId,
      actor: { type: "system", id: "milestone-readiness" },
      occurredAt: input.occurredAt,
      payload: {
        projectId: milestone.projectId,
        milestoneId: milestone.id,
        milestoneVersion: milestone.version,
        stagingBranch: milestone.stagingBranch,
        productionBranch: milestone.productionBranch,
        ...(releaseWorktreePaths === null ? {} : { releaseWorktreePaths }),
      },
    });
    await appendOrchestrationEvents(tx as never, [event]);
  });
  return true;
}

export async function handleMilestoneReleaseEvent(
  input: unknown,
  dependencies: MilestoneReleaseTriggerDependencies = defaultDependencies,
): Promise<{ matched: number; triggered: number }> {
  const event = parseMilestoneEvent(input);
  if (!event || !isLoopGraphEnabled(dependencies.flags)) {
    return { matched: 0, triggered: 0 };
  }
  const milestone = await dependencies.loadMilestone({ milestoneId: event.milestoneId });
  if (
    !milestone
    || milestone.projectId !== event.projectId
    || milestone.id !== event.milestoneId
    || milestone.version !== event.milestoneVersion
  ) return { matched: 0, triggered: 0 };
  const readiness = evaluateMilestoneReleaseReadiness({
    tasks: milestone.tasks,
    blockers: milestone.blockers,
  });
  if (!readiness.ready) return { matched: 0, triggered: 0 };

  const bindings = await dependencies.listEnabledBindings({ projectId: event.projectId });
  const matching = bindings.filter((binding) => bindingMatchesMilestoneEvent(binding, event.eventType));
  const occurredAt = new Date(event.occurredAt);
  const eventPayload = requireRecord(event.payload, "Milestone event payload is invalid");
  const releaseWorktreePaths = parseReleaseWorktreePaths(eventPayload.releaseWorktreePaths);
  if ("releaseWorktreePaths" in eventPayload && releaseWorktreePaths === null) {
    throw validationError("Release worktree paths are invalid");
  }
  const publishedVersions = matching.length === 0
    ? []
    : await dependencies.readPublishedVersions(event.projectId);
  for (const rawBinding of matching) {
    const binding = requireRecord(rawBinding, "Release binding is invalid") as ReleaseBinding;
    const snapshots = resolveLoopTriggerSnapshots(binding);
    if (snapshots.bindingSnapshot.projectId !== event.projectId) {
      throw validationError("Release binding belongs to another Project");
    }
    const bindingState = requireRecord(rawBinding, "Release binding state is invalid");
    const identity = buildLoopTriggerIdentity({
      bindingId: snapshots.bindingSnapshot.id,
      triggerType: "milestone_event",
      sourceEventId: event.id,
    });
    const grants = await dependencies.snapshotBindingGrants({
      bindingId: snapshots.bindingSnapshot.id,
      now: dependencies.now(),
    });
    const runGraphSnapshot = resolvePublishedRunGraphSnapshot({
      rootLoopVersionId: snapshots.bindingSnapshot.activeVersionId,
      versions: publishedVersions,
    });
    const run = {
      id: identity.runId,
      triggerReceiptId: identity.triggerReceiptId,
      bindingId: snapshots.bindingSnapshot.id,
      triggerType: "milestone_event" as const,
      sourceEventId: event.id,
      projectId: event.projectId,
      taskId: null,
      loopVersionId: snapshots.bindingSnapshot.activeVersionId,
      inputSnapshot: {
        ...eventPayload,
        projectId: event.projectId,
        milestoneId: event.milestoneId,
        milestoneVersion: event.milestoneVersion,
        stagingBranch: milestone.stagingBranch,
        productionBranch: milestone.productionBranch,
        ...(releaseWorktreePaths === null ? {} : { releaseWorktreePaths }),
      },
      bindingSnapshot: {
        ...snapshots.bindingSnapshot,
        createdByUserId: requiredText(bindingState.createdByUserId, "createdByUserId", 64),
      },
      policySnapshot: snapshots.policySnapshot,
      grantSnapshot: grantSnapshot(grants),
      runGraphSnapshot,
      budgetSnapshot: snapshots.budgetSnapshot,
      occurredAt,
      correlationId: event.correlationId,
      ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
      actor: { type: "system" as const, id: "milestone-release-trigger" },
    } satisfies CreateGraphLoopRunInput;
    const snapshot = buildReleaseSnapshot(milestone, readiness.includedTaskIds, "milestone_event", occurredAt);
    await dependencies.createReleaseRunAndSnapshot({ run, snapshot });
  }
  return { matched: matching.length, triggered: matching.length };
}

function buildReleaseSnapshot(
  milestone: MilestoneState,
  includedTaskIds: string[],
  triggerType: "manual" | "milestone_event",
  createdAt: Date,
): MilestoneReleaseSnapshot {
  const included = new Set(includedTaskIds);
  return {
    projectId: milestone.projectId,
    milestoneId: milestone.id,
    milestoneVersion: milestone.version,
    triggerType,
    stagingBranch: requiredText(milestone.stagingBranch, "staging branch", 191),
    tasks: milestone.tasks.filter((task) => included.has(task.taskId)).map((task) => ({
      taskId: task.taskId,
      taskNumber: task.taskNumber,
      branch: requiredText(task.taskBranch, "task branch", 191),
      headCommit: requiredCommit(task.remoteHeadCommit, "task head commit"),
      taskDocument: task.taskDocument ?? (() => { throw validationError("Task document is missing"); })(),
      knowledgeRefs: task.knowledgeRefs,
      testReportRef: requiredText(task.testReport?.ref, "test report ref", 128),
      ...(task.testReport?.requirements ? { requirements: task.testReport.requirements } : {}),
    })),
    stagingBaseCommit: requiredCommit(milestone.stagingBaseCommit, "staging base commit"),
    productionBaseCommit: requiredCommit(milestone.productionBaseCommit, "production base commit"),
    createdAt: createdAt.toISOString(),
  };
}

export async function loadMilestoneState(input: { milestoneId: string }): Promise<MilestoneState | null> {
  const row = await prisma.milestone.findUnique({
    where: { id: input.milestoneId },
    select: {
      id: true,
      projectId: true,
      version: true,
      project: { select: { stagingBranch: true, productionBranch: true, developmentTemplateKey: true } },
      tasks: {
        select: {
          id: true,
          taskNumber: true,
          statusCategory: true,
          taskBranch: true,
          blockers: { where: { status: "active" }, select: { id: true } },
          documentLinks: { orderBy: { createdAt: "desc" }, take: 1, select: { document: { select: { id: true, version: true } } } },
          checkDefinitions: {
            where: { type: "development" },
            select: { results: { orderBy: { finishedAt: "desc" }, take: 1, select: { id: true, status: true, evidence: true } } },
          },
        },
      },
    },
  });
  if (!row?.project?.stagingBranch || !row.project.productionBranch) return null;
  const repositoryPath = resolveWorkerRepositoryPath(row.projectId);
  const refs = repositoryPath
    ? await resolveRemoteBranchCommits(repositoryPath, row.project.stagingBranch, row.project.productionBranch)
    : null;
  if (!refs) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    stagingBranch: row.project.stagingBranch,
    productionBranch: row.project.productionBranch,
    blockers: 0,
    stagingBaseCommit: refs.stagingBaseCommit,
    productionBaseCommit: refs.productionBaseCommit,
    tasks: row.tasks.map((task) => {
      const evidence = task.checkDefinitions.flatMap((definition) => definition.results).at(0);
      const payload = optionalRecord(evidence?.evidence);
      const push = optionalRecord(payload?.pushReceipt);
      const knowledgeRefs = Array.isArray(payload?.knowledgeRefs)
        ? payload.knowledgeRefs.filter((ref): ref is { path: string; commit: string } => Boolean(ref && typeof ref === "object" && typeof Reflect.get(ref, "path") === "string" && typeof Reflect.get(ref, "commit") === "string"))
        : [];
      return {
        taskId: task.id,
        taskNumber: task.taskNumber ?? 0,
        statusCategory: task.statusCategory,
        taskBranch: task.taskBranch,
        remoteHeadCommit: typeof push?.remoteHeadCommit === "string" ? push.remoteHeadCommit : null,
        taskDocument: task.documentLinks[0]?.document
          ? { documentId: task.documentLinks[0].document.id, version: task.documentLinks[0].document.version }
          : null,
        knowledgeRefs,
        testReport: evidence ? {
          ref: evidence.id,
          status: evidence.status === "passed" ? "passed" as const : "failed" as const,
          requirements: parseRequirementStatuses(optionalRecord(payload?.report)?.requirements),
        } : null,
        activeBlockerCount: task.blockers.length,
      };
    }),
  };
}

async function resolveRemoteBranchCommits(
  repositoryPath: string,
  stagingBranch: string,
  productionBranch: string,
): Promise<{ stagingBaseCommit: string; productionBaseCommit: string } | null> {
  try {
    const resolve = async (branch: string) => {
      const result = await execFileAsync("git", ["-C", repositoryPath, "rev-parse", "--verify", "--end-of-options", `origin/${branch}`], { encoding: "utf8" });
      const commit = result.stdout.trim();
      if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Git ref did not resolve to a commit");
      return commit;
    };
    return {
      stagingBaseCommit: await resolve(stagingBranch),
      productionBaseCommit: await resolve(productionBranch),
    };
  } catch {
    return null;
  }
}

/** Worker-local repository mapping. Secrets and paths stay outside platform project data. */
export function resolveWorkerRepositoryPath(
  projectId: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = environment.HUMANTHREAD_WORKER_REPOSITORIES;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const path = Reflect.get(parsed, projectId);
    return typeof path === "string" && path.trim().length > 0 ? path.trim() : null;
  } catch {
    return null;
  }
}

export type ReleaseWorktreePaths = {
  staging: string;
  production: string;
};

/**
 * Release worktrees are local-agent paths, so only repository-relative paths
 * are persisted in the event snapshot. The orchestration worker must receive
 * both paths explicitly; the local agent never derives a path from `main`.
 */
export function resolveWorkerReleaseWorktreePaths(
  projectId: string,
  environment: NodeJS.ProcessEnv = process.env,
): ReleaseWorktreePaths | null {
  const raw = environment.HUMANTHREAD_RELEASE_WORKTREES;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parseReleaseWorktreePaths(Reflect.get(parsed, projectId));
  } catch {
    return null;
  }
}

function parseReleaseWorktreePaths(value: unknown): ReleaseWorktreePaths | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const staging = repositoryRelativePath(Reflect.get(value, "staging"));
  const production = repositoryRelativePath(Reflect.get(value, "production"));
  return staging && production && staging !== production ? { staging, production } : null;
}

function repositoryRelativePath(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || value.startsWith("/")
    || value.includes("\\")
    || /^[a-z]:/iu.test(value)
    || /[\0-\x1f\x7f]/u.test(value)
    || value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) return null;
  return value;
}

function parseRequirementStatuses(value: unknown): Array<{ requirementId: string; status: "passed" | "failed" | "inconclusive" | "skipped" }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((requirement) => {
    const record = optionalRecord(requirement);
    const requirementId = record?.requirementId;
    const status = record?.status;
    return typeof requirementId === "string" && ["passed", "failed", "inconclusive", "skipped"].includes(String(status))
      ? [{ requirementId, status: status as "passed" | "failed" | "inconclusive" | "skipped" }]
      : [];
  });
}

function parseMilestoneEvent(input: unknown): {
  id: string;
  eventType: "milestone.release_ready";
  projectId: string;
  milestoneId: string;
  milestoneVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  payload: unknown;
} | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const event = input as Record<string, unknown>;
  if (event.aggregateType !== "milestone" || event.eventType !== "milestone.release_ready") return null;
  const payload = requireRecord(event.payload, "Milestone event payload is invalid");
  const milestoneVersion = payload.milestoneVersion;
  if (!Number.isInteger(milestoneVersion) || (milestoneVersion as number) <= 0) throw validationError("Milestone version is invalid");
  return {
    id: requiredText(event.id, "event.id", 128),
    eventType: "milestone.release_ready",
    projectId: requiredText(payload.projectId, "projectId", 64),
    milestoneId: requiredText(payload.milestoneId, "milestoneId", 96),
    milestoneVersion: milestoneVersion as number,
    occurredAt: requiredText(event.occurredAt, "occurredAt", 64),
    correlationId: requiredText(event.correlationId, "correlationId", 128),
    ...(event.causationId === undefined ? {} : { causationId: requiredText(event.causationId, "causationId", 128) }),
    payload: event.payload,
  };
}

function grantSnapshot(grants: unknown[]) {
  const normalized = grants.map((grant) => {
    const record = requireRecord(grant, "AutomationGrant snapshot is invalid");
    return record;
  });
  return {
    automationGrantIds: normalized.map((grant) => requiredText(grant.id, "grant id", 96)),
    grants: normalized,
  };
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validationError(message);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw validationError(`${name} is invalid`);
  return value;
}

function requiredCommit(value: unknown, name: string): string {
  const commit = requiredText(value, name, 64);
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw validationError(`${name} is invalid`);
  return commit;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
