import { createHash, randomUUID } from "node:crypto";
import {
  activateLoopNode,
  acknowledgeLoopNotificationProjection,
  assertCanReadTask,
  assertCanWriteProject,
  claimPlatformLoopAttempt,
  completeLoopNode,
  createOutboxPublisherStore,
  parsePublishedLoopVersionGraph,
  prisma,
  publishOutboxBatch,
  recoverOrphanedGraphNode,
  reserveEffectExecution,
  resumeLoopNodeAfterConfiguration,
  resumeWaitingLoopNode,
  resolveEffectExecution,
  waitForLoopNodeConfiguration,
  updateDocumentIdempotently,
  waitPlatformLoopAttempt,
  workerResourceScopeWhere,
  type ActivateLoopNodeInput,
  type LoopConfigurationReadinessEvidence,
} from "@humanthread/db";
import {
  evaluateAutomationGrant,
  deriveHumanGateRoutes,
  LOOP_AUTOMATION_POLICY_VERSION,
  parseRunGraphSnapshot,
  parseRunGraphSnapshotV2,
  readLoopGraphFeatureFlags,
  reconcileLiveAutomationGrants,
  type AutomationAction,
} from "@humanthread/orchestration-core";
import {
  projectRepositoryConfigurationSchema,
  type LoopConfigurationWaitingReason,
} from "@humanthread/shared";
import { dispatchReadyNode } from "./loop-dispatcher";
import { handleTaskEventForLoopBindings } from "./loop-task-trigger";
import {
  executePlatformLoopAttempt,
  type PlatformExecutionMessage,
} from "./loop-platform-execution";
import { scheduleReadyLoopNodes, type ReadyLoopNodeCandidate } from "./loop-scheduler";
import { resumeDueLoopWaits, type WaitingLoopCandidate } from "./loop-waits";
import { createOutboxTopicRouter } from "./outbox-router";
import { executePlatformNode } from "./platform-node-executors";
import { handleKnowledgeGenerationEvent } from "./knowledge-generation-trigger";
import { dispatchQueuedKnowledgeIndexJobs } from "./knowledge-index-dispatcher";
import { runDueKnowledgeSchedules } from "./knowledge-schedule-runner";
import { handleChildLoopTerminalEvent, invokeTaskScopedChildLoop } from "./task-loop-invocation";
import { recoverExpiredRuns } from "./recovery";
import { createWorkerIteration, readWorkerFlags } from "./runtime";
import { handleTaskDevelopmentLoopEvent } from "./task-development-loop";
import { handleMilestoneReleaseEvent } from "./milestone-release-trigger";
import { handleReleasePlanLoopEvent } from "@humanthread/db";
import { claimDueTaskReminders, deliverDueTaskReminders, type ClaimedTaskReminder } from "./task-reminders";
import { runScheduledTaskIteration } from "./scheduled-task-runner";
import { createRepositoryVerificationHandler } from "./repository-verification";

export function createProductionWorkerIteration(environment: NodeJS.ProcessEnv = process.env) {
  const flags = readWorkerFlags(environment);
  const graphFlags = readLoopGraphFeatureFlags(environment);
  const platformExecutionEnabled = flags.loop && graphFlags.graphV1;
  const outboxStore = createOutboxPublisherStore(prisma, {
    topics: resolveProductionOutboxTopics({
      loop: flags.loop,
      graphV1: graphFlags.graphV1,
    }),
  });
  const acknowledgeLoopSignal = async (payload: unknown) => {
    requireRecord(payload, "Loop scheduler signal is invalid");
  };
  const outboxHandlers: Record<
    string,
    ((payload: unknown) => Promise<void>) | readonly ((payload: unknown) => Promise<void>)[]
  > = {
    "orchestration.event": [
      (payload) => handleTaskEventForLoopBindings(payload).then(() => undefined),
      (payload) => handleTaskDevelopmentLoopEvent(payload).then(() => undefined),
      (payload) => handleMilestoneReleaseEvent(payload).then(() => undefined),
      (payload) => handleChildLoopTerminalEvent(payload).then(() => undefined),
      (payload) => handleReleasePlanLoopEvent(payload).then(() => undefined),
      (payload) => handleKnowledgeGenerationEvent(payload).then(() => undefined),
    ],
    "loop.schedule": acknowledgeLoopSignal,
    "loop.timer": acknowledgeLoopSignal,
    "run.recover": async (payload) => {
      const recovery = parseRecoverySignal(payload);
      await recoverOrphanedGraphNode({
        loopRunId: recovery.loopRunId,
        agentRunId: recovery.runId,
        occurredAt: new Date(),
        correlationId: `loop:${recovery.loopRunId}`,
        causationId: recovery.runId,
        actor: { type: "system", id: "loop-recovery" },
      });
    },
    "loop.notification.intent": async (payload) => {
      const record = requireRecord(payload, "Loop notification projection is invalid");
      const notificationId = requiredText(record.id, "notificationId", 128);
      const channels = Array.isArray(record.channels)
        ? record.channels.filter((channel): channel is "in_app" | "desktop" | "email" | "enterprise_im" =>
          typeof channel === "string")
        : undefined;
      await acknowledgeLoopNotificationProjection({
        notificationId,
        ...(channels ? { channels } : {}),
      });
    },
    "repository.verification.requested": createRepositoryVerificationHandler(),
  };
  if (platformExecutionEnabled) {
    outboxHandlers["loop.platform.execute"] = async (payload) => {
      const record = requireRecord(payload, "Platform execution message is invalid");
      requiredText(record.projectId, "projectId", 64);
      await executePlatformLoopAttempt(payload as PlatformExecutionMessage, {
        now: () => new Date(),
        claimAttempt: (input) => claimPlatformLoopAttempt(input),
        reserveEffect: (input) => reserveEffectExecution(input),
        resolveEffect: (input) => resolveEffectExecution(input),
        executeNode: (input) => executePlatformNode(input, {
          assertCanWriteProject: (access) => assertCanWriteProject(access),
          loadDocumentTarget: (documentId) => prisma.document.findUnique({
            where: { id: documentId },
            select: { id: true, projectId: true },
          }),
          updateDocumentIdempotently: (documentInput) => updateDocumentIdempotently(documentInput),
          invokeTaskScopedChildLoop: (childInput) => invokeTaskScopedChildLoop(childInput),
        }),
        completeNode: async (input) => {
          await completeLoopNode(input);
        },
        waitNode: (input) => waitPlatformLoopAttempt({
          ...input,
          actor: { type: "system", id: "loop-platform-executor" },
        }),
      });
    };
  }
  const routeOutbox = createOutboxTopicRouter(outboxHandlers);
  return createWorkerIteration({
    flags: { ...flags, loop: flags.loop && graphFlags.graphV1 },
    publishOutbox: () => {
      const now = new Date();
      return publishOutboxBatch({
        store: outboxStore,
        limit: 100,
        now,
        claimToken: `orchestration-worker:${randomUUID()}`,
        publish: routeOutbox,
      });
    },
    deliverTaskReminders: () => deliverDueTaskReminders({
      now: new Date(),
      claim: (now) => claimDueTaskReminders({
        now,
        loadCandidates: async ({ now: claimNow, staleBefore }) => {
          const reminders = await prisma.taskReminder.findMany({
            where: { OR: [
              { status: { in: ["pending", "failed"] }, remindAt: { lte: claimNow } },
              { status: "processing", updatedAt: { lte: staleBefore } },
            ] },
            orderBy: [{ remindAt: "asc" }, { id: "asc" }],
            take: 100,
            select: { id: true, taskId: true, recipientUserId: true, remindAt: true },
          });
          return reminders satisfies ClaimedTaskReminder[];
        },
        claimOne: async ({ reminder, now: claimNow, staleBefore }) => {
          const result = await prisma.taskReminder.updateMany({
            where: { id: reminder.id, OR: [
              { status: { in: ["pending", "failed"] }, remindAt: { lte: claimNow } },
              { status: "processing", updatedAt: { lte: staleBefore } },
            ] },
            data: { status: "processing", lastError: null },
          });
          return result.count === 1;
        },
      }),
      publish: async ({ notificationId, reminder }) => {
        const task = await prisma.task.findUnique({
          where: { id: reminder.taskId },
          select: { id: true, title: true, archivedAt: true },
        });
        if (!task || task.archivedAt) return;
        try {
          await assertCanReadTask({ userId: reminder.recipientUserId, taskId: reminder.taskId });
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
          if (code === "task_not_found" || code === "task_access_denied") return;
          throw error;
        }
        await prisma.taskActivity.upsert({
          where: { id: notificationId },
          create: {
            id: notificationId,
            taskId: reminder.taskId,
            type: "reminder_due",
            actorType: "system",
            message: `任务提醒：${task.title}`,
            payload: { reminderId: reminder.id, recipientUserId: reminder.recipientUserId },
            correlationId: notificationId,
            createdAt: new Date(),
          },
          update: {},
        });
      },
      markSent: async ({ reminderId, sentAt }) => {
        await prisma.taskReminder.updateMany({
          where: { id: reminderId, status: "processing" },
          data: { status: "sent", sentAt, lastError: null },
        });
      },
      markFailed: async ({ reminderId, error, retryAt }) => {
        await prisma.taskReminder.updateMany({
          where: { id: reminderId, status: "processing" },
          data: { status: "failed", lastError: error, remindAt: retryAt },
        });
      },
    }),
    dispatch: async () => {
      await prisma.agentRun.count({ where: { status: "queued" } });
    },
    scheduleScheduledTasks: () => runScheduledTaskIteration(new Date()),
    scheduleLoops: async () => {
      const now = new Date();
      await runDueKnowledgeSchedules({ now });
      await dispatchQueuedKnowledgeIndexJobs({});
      await expirePendingRuntimeSafetyApprovals(now);
      await resumeDueLoopWaits({ limit: 100, now }, {
        loadWaiting: ({ limit, now: scanNow }) => loadWaitingLoopCandidates(
          limit,
          scanNow,
        ),
        completeWaitingNode: (input) => resumeWaitingLoopNode({
          ...input,
          actor: { type: "system", id: "loop-wait-resumer" },
        }).then(() => undefined),
      });
      await resumeWaitingConfigurationNodes({
        limit: 100,
        now,
        loadWaiting: ({ limit }) => loadWaitingConfigurationCandidates(
          limit,
        ),
        evaluate: (candidate) => evaluatePersistedLocalExecutionReadiness(candidate, now),
        resume: (input) => resumeLoopNodeAfterConfiguration(input),
        waitForConfiguration: (input) => waitForLoopNodeConfiguration(input),
      });
      await scheduleReadyLoopNodes({
        limit: 100,
        now,
        loadReady: ({ limit }) => loadReadyLoopNodes(limit, now),
        activate: (input) => activateLoopNode(input),
        dispatch: (candidate, assignment) => dispatchProductionReadyNode(candidate, assignment),
      });
    },
    recover: () => recoverExpiredRuns({
      now: new Date(),
      loadExpired: (now) => prisma.agentRun.findMany({
        where: { status: { in: ["claimed", "starting", "running", "waiting_approval"] }, leaseExpiresAt: { lte: now } },
        select: { id: true, loopRunId: true, leaseGeneration: true, workerId: true },
      }),
      recoverAtomically: (input) => recoverExpiredRunAtomically(input),
    }),
  });
}

interface RuntimeSafetyApprovalExpiryTransaction {
  approvalRequest: {
    findMany(input: unknown): Promise<Array<{
      id: string;
      loopRunId: string | null;
      loopNodeRunId: string | null;
    }>>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  loopNodeRun: { updateMany(input: unknown): Promise<{ count: number }> };
  loopRun: { updateMany(input: unknown): Promise<{ count: number }> };
}

interface RuntimeSafetyApprovalExpiryDb {
  $transaction<T>(
    callback: (transaction: RuntimeSafetyApprovalExpiryTransaction) => Promise<T>,
  ): Promise<T>;
}

export async function expirePendingRuntimeSafetyApprovals(
  now: Date,
  db: RuntimeSafetyApprovalExpiryDb = prisma as unknown as RuntimeSafetyApprovalExpiryDb,
): Promise<{ expired: number }> {
  return db.$transaction(async (tx) => {
    const approvals = await tx.approvalRequest.findMany({
      where: {
        type: "loop_runtime_safety",
        status: "pending",
        expiresAt: { lte: now },
      },
      select: { id: true, loopRunId: true, loopNodeRunId: true },
    });
    let expired = 0;
    for (const approval of approvals) {
      const result = await tx.approvalRequest.updateMany({
        where: { id: approval.id, status: "pending" },
        data: {
          status: "expired",
          decidedAt: now,
          decisionReason: "runtime_safety_expired",
        },
      });
      if (result.count !== 1) continue;
      expired += 1;
      if (!approval.loopRunId || !approval.loopNodeRunId) continue;
      await tx.loopNodeRun.updateMany({
        where: {
          id: approval.loopNodeRunId,
          loopRunId: approval.loopRunId,
          status: "waiting_approval",
        },
        data: {
          status: "failed",
          waitingReason: null,
          finishedAt: now,
          version: { increment: 1 },
        },
      });
      await tx.loopRun.updateMany({
        where: { id: approval.loopRunId, status: "waiting" },
        data: {
          status: "failed",
          statusReason: "runtime_safety_expired",
          finishedAt: now,
          version: { increment: 1 },
          projectionVersion: { increment: 1 },
        },
      });
    }
    return { expired };
  });
}

interface ProductionLoopDispatchTransaction {
  loopNodeRun: { updateMany(input: unknown): Promise<{ count: number }> };
  loopRun: { updateMany(input: unknown): Promise<{ count: number }> };
  approvalRequest: { create(input: unknown): Promise<unknown> };
}

interface ProductionLoopDispatchDependencies {
  activate(input: ActivateLoopNodeInput): Promise<unknown>;
  waitForConfiguration?(input: Parameters<typeof waitForLoopNodeConfiguration>[0]): Promise<unknown>;
  db: {
    $transaction<T>(
      callback: (transaction: ProductionLoopDispatchTransaction) => Promise<T>,
    ): Promise<T>;
  };
}

const PRODUCTION_LOOP_DISPATCH_DEPENDENCIES: ProductionLoopDispatchDependencies = {
  activate: (input) => activateLoopNode(input),
  waitForConfiguration: (input) => waitForLoopNodeConfiguration(input),
  db: prisma as unknown as ProductionLoopDispatchDependencies["db"],
};

export async function dispatchProductionReadyNode(
  candidate: ReadyLoopNodeCandidate,
  assignment: ActivateLoopNodeInput,
  dependencies: ProductionLoopDispatchDependencies = PRODUCTION_LOOP_DISPATCH_DEPENDENCIES,
) {
  if (
    candidate.node.type === "agent_action"
    && candidate.localExecutionReadiness
    && !candidate.localExecutionReadiness.ready
  ) {
    return (dependencies.waitForConfiguration ?? waitForLoopNodeConfiguration)({
      loopRunId: candidate.loopRunId,
      nodeRunId: candidate.nodeRunId,
      nodeRunVersion: candidate.nodeRunVersion,
      projectId: candidate.projectId,
      recipientUserId: requiredText(
        candidate.configurationRecipientUserId,
        "configuration recipientUserId",
        64,
      ),
      waitingReason: candidate.localExecutionReadiness.reason as LoopConfigurationWaitingReason,
      configurationVersion: candidate.localExecutionReadiness.configurationVersion,
      evidence: configurationEvidence(candidate.localExecutionReadiness.evidence),
      occurredAt: assignment.occurredAt,
      correlationId: assignment.correlationId,
      actor: assignment.actor,
    });
  }
  return dispatchReadyNode<ProductionLoopDispatchTransaction>({
    loopRunId: candidate.loopRunId,
    projectId: candidate.projectId,
    nodeRunId: candidate.nodeRunId,
    nodeRunVersion: candidate.nodeRunVersion,
    node: candidate.node,
    policyDecision: candidate.policyDecision ?? defaultPolicyDecision(candidate.node),
    ...(candidate.actionFingerprint === undefined
      ? (candidate.policyDecision === undefined && requiresRuntimeSafety(candidate.node)
          ? { actionFingerprint: actionFingerprintForCandidate(candidate) }
          : {})
      : { actionFingerprint: candidate.actionFingerprint }),
    ...(candidate.humanGateRoutes === undefined
      ? {}
      : { humanGateRoutes: candidate.humanGateRoutes }),
    now: assignment.occurredAt,
  }, {
    transaction: (callback) => dependencies.db.$transaction(callback),
    createAssignment: () => dependencies.activate(assignment),
    createApproval: (approval, transaction) => requireDispatchTransaction(transaction)
      .approvalRequest.create({ data: approval }),
    updateNode: (input, transaction) => requireDispatchTransaction(transaction)
      .loopNodeRun.updateMany({
        where: {
          id: input.nodeRunId,
          loopRunId: input.loopRunId,
          status: "ready",
          version: input.nodeRunVersion,
        },
        data: {
          status: input.status,
          waitingReason: input.waitingReason,
          version: { increment: 1 },
        },
      }),
    updateRun: (input, transaction) => requireDispatchTransaction(transaction)
      .loopRun.updateMany({
        where: { id: input.loopRunId, status: { in: ["pending", "running"] } },
        data: {
          status: input.status,
          statusReason: input.waitingReason,
          version: { increment: 1 },
          projectionVersion: { increment: 1 },
        },
      }),
  });
}

type LocalExecutionBinding = {
  id: string;
  version: number;
  allowedAgentProfileIds: readonly string[];
  allowedProviders: readonly string[];
  workerExecution?: LinuxWorkerExecutionBinding;
};

type LinuxWorkerExecutionBinding = {
  workerPoolId: string;
  workerRepositoryUrl: string;
  workerBranchPolicy: { allowedBranches: string[] };
  workerStageConfigurations: Record<string, {
    siteId: string;
    model: string;
    reasoningEffort: string;
  }>;
};

type LocalExecutionProfile = {
  id: string;
  provider: string;
  status: string;
} | null;

type LocalExecutionWorker = {
  id: string;
  localDeviceId: string | null;
  status: string;
  version: number;
  lastHeartbeatAt: Date | null;
  providers: readonly string[];
} | null;

type LocalExecutionRuntime = {
  id: string;
  localDeviceId: string;
  provider: string;
  status: string;
  version: number;
} | null;

type LocalExecutionWorkspace = {
  id: string;
  projectId: string;
  localDeviceId: string;
  status: string;
  configurationVersion: number;
} | null;

type LocalExecutionGrant = {
  id: string;
  status: string;
  version: number;
  workspaceBindingIds: readonly string[];
  agentProfileIds: readonly string[];
  providers: readonly string[];
  deviceIds: readonly string[];
  workerIds: readonly string[];
} | null;

export interface LocalExecutionReadinessInput {
  binding: LocalExecutionBinding;
  profile: LocalExecutionProfile;
  adapterRegistered: boolean;
  worker: LocalExecutionWorker;
  runtime: LocalExecutionRuntime;
  workspace: LocalExecutionWorkspace;
  grant: LocalExecutionGrant;
  projectId: string;
  recipientUserId?: string;
  now: Date;
  workerHeartbeatTimeoutMs: number;
}

export type LocalExecutionReadiness = {
  ready: boolean;
  reason: LoopConfigurationWaitingReason | null;
  configurationVersion: string;
  evidence: LoopConfigurationReadinessEvidence;
};

export function evaluateLocalExecutionReadiness(
  input: LocalExecutionReadinessInput,
): LocalExecutionReadiness {
  const profileId = input.profile?.id ?? null;
  const provider = input.profile?.provider ?? null;
  const workerId = input.worker?.id ?? null;
  const deviceId = input.worker?.localDeviceId ?? null;
  const evidence: LocalExecutionReadiness["evidence"] = {
    bindingId: input.binding.id,
    bindingVersion: input.binding.version,
    agentProfileId: profileId,
    provider,
    workerId,
    workerVersion: input.worker?.version ?? null,
    deviceId,
    runtimeProfileId: input.runtime?.id ?? null,
    runtimeVersion: input.runtime?.version ?? null,
    workspaceBindingId: input.workspace?.id ?? null,
    workspaceConfigurationVersion: input.workspace?.configurationVersion ?? null,
    automationGrantId: input.grant?.id ?? null,
    automationGrantVersion: input.grant?.version ?? null,
  };
  const configurationVersion = readinessConfigurationVersion(evidence);
  const blocked = (reason: LoopConfigurationWaitingReason): LocalExecutionReadiness => ({
    ready: false,
    reason,
    configurationVersion,
    evidence,
  });

  if (!input.profile || input.profile.status !== "active"
    || !input.binding.allowedAgentProfileIds.includes(input.profile.id)) {
    return blocked("profile_not_allowed");
  }
  if (!input.binding.allowedProviders.includes(input.profile.provider)
    || !input.adapterRegistered) {
    return blocked("provider_not_allowed");
  }
  if (
    !input.worker
    || !input.worker.localDeviceId
    || input.worker.status !== "online"
    || !input.worker.lastHeartbeatAt
    || input.worker.lastHeartbeatAt.getTime() < input.now.getTime() - input.workerHeartbeatTimeoutMs
    || !input.worker.providers.includes(input.profile.provider)
  ) return blocked("worker_offline");
  if (!input.runtime || input.runtime.status === "missing" || input.runtime.status === "disabled") {
    return blocked("runtime_missing");
  }
  if (input.runtime.status === "unauthenticated") return blocked("runtime_unauthenticated");
  if (
    input.runtime.status !== "ready"
    || input.runtime.provider !== input.profile.provider
    || input.runtime.localDeviceId !== input.worker.localDeviceId
  ) return blocked("runtime_missing");
  if (!input.workspace) return blocked("workspace_missing");
  if (
    input.workspace.status !== "ready"
    || input.workspace.projectId !== input.projectId
    || input.workspace.localDeviceId !== input.worker.localDeviceId
  ) return blocked("workspace_stale");
  // Grants are platform-side policy metadata, not a prerequisite for a
  // leased local execution. The Loop graph's explicit gates own user-facing
  // approval; workers run inside an isolated container/workspace.
  return { ready: true, reason: null, configurationVersion, evidence };
}

function readinessConfigurationVersion(evidence: LoopConfigurationReadinessEvidence): string {
  const digest = createHash("sha256").update(JSON.stringify([
    evidence.bindingId,
    evidence.bindingVersion,
    evidence.agentProfileId,
    evidence.provider,
    evidence.workerId,
    evidence.workerVersion,
    evidence.deviceId,
    evidence.runtimeProfileId,
    evidence.runtimeVersion,
    evidence.workspaceBindingId,
    evidence.workspaceConfigurationVersion,
    evidence.automationGrantId,
    evidence.automationGrantVersion,
  ])).digest("hex");
  return `configuration:${digest}`;
}

function configurationEvidence(value: Record<string, unknown>): LoopConfigurationReadinessEvidence {
  return {
    bindingId: requiredText(value.bindingId, "configuration bindingId", 96),
    bindingVersion: positiveNumber(value.bindingVersion, "configuration bindingVersion"),
    agentProfileId: nullableText(value.agentProfileId, "configuration agentProfileId", 96),
    provider: nullableText(value.provider, "configuration provider", 32),
    workerId: nullableText(value.workerId, "configuration workerId", 96),
    workerVersion: nullablePositiveNumber(value.workerVersion, "configuration workerVersion"),
    deviceId: nullableText(value.deviceId, "configuration deviceId", 64),
    runtimeProfileId: nullableText(value.runtimeProfileId, "configuration runtimeProfileId", 96),
    runtimeVersion: nullablePositiveNumber(value.runtimeVersion, "configuration runtimeVersion"),
    workspaceBindingId: nullableText(value.workspaceBindingId, "configuration workspaceBindingId", 96),
    workspaceConfigurationVersion: nullablePositiveNumber(
      value.workspaceConfigurationVersion,
      "configuration workspaceConfigurationVersion",
    ),
    automationGrantId: nullableText(value.automationGrantId, "configuration automationGrantId", 96),
    automationGrantVersion: nullablePositiveNumber(
      value.automationGrantVersion,
      "configuration automationGrantVersion",
    ),
  };
}

function positiveNumber(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw validationError(`${name} is invalid`);
  return value as number;
}

function nullablePositiveNumber(value: unknown, name: string): number | null {
  return value === null ? null : positiveNumber(value, name);
}

function nullableText(value: unknown, name: string, maxLength: number): string | null {
  return value === null ? null : requiredText(value, name, maxLength);
}

function requiresRuntimeSafety(node: ReadyLoopNodeCandidate["node"]): boolean {
  return node.type === "agent_action" || node.type === "platform_action";
}

function defaultPolicyDecision(
  node: ReadyLoopNodeCandidate["node"],
) {
  if (requiresRuntimeSafety(node)) {
    return {
      outcome: "require_approval" as const,
      reasonCode: "assignment_policy_not_evaluated",
      matchedGrantId: null,
    };
  }
  return {
    outcome: "allow" as const,
    reasonCode: "low_risk_platform_action",
    matchedGrantId: null,
  };
}

function actionFingerprintForCandidate(candidate: ReadyLoopNodeCandidate): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ loopRunId: candidate.loopRunId, nodeRunId: candidate.nodeRunId, nodeKey: candidate.nodeKey }))
    .digest("hex")}`;
}

function requireDispatchTransaction(
  transaction: ProductionLoopDispatchTransaction | undefined,
): ProductionLoopDispatchTransaction {
  if (!transaction) throw validationError("Loop approval wait requires a database transaction");
  return transaction;
}

export function resolveProductionOutboxTopics(input: {
  loop: boolean;
  graphV1: boolean;
}): string[] {
  return [
    "orchestration.event",
    "loop.schedule",
    "loop.timer",
    "run.recover",
    "loop.notification.intent",
    "repository.verification.requested",
    ...(input.loop && input.graphV1 ? ["loop.platform.execute"] : []),
  ];
}

export interface WaitingConfigurationCandidate {
  loopRunId: string;
  projectId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  activationNo: number;
  waitingReason: string | null;
  configurationVersion: string | null;
}

interface WaitingConfigurationInput {
  limit: number;
  now: Date;
  loadWaiting(input: { limit: number }): Promise<WaitingConfigurationCandidate[]>;
  evaluate(candidate: WaitingConfigurationCandidate): Promise<{
    recipientUserId: string;
    readiness: LocalExecutionReadiness;
  }>;
  resume(input: Parameters<typeof resumeLoopNodeAfterConfiguration>[0]): Promise<unknown>;
  waitForConfiguration?(input: Parameters<typeof waitForLoopNodeConfiguration>[0]): Promise<unknown>;
}

export async function resumeWaitingConfigurationNodes(
  input: WaitingConfigurationInput,
): Promise<{ scanned: number; resumed: number; refreshed: number; contended: number }> {
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 1_000) {
    throw validationError("Loop configuration scan limit must be between 1 and 1000");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw validationError("Loop configuration scan time is invalid");
  }
  const candidates = await input.loadWaiting({ limit: input.limit });
  let resumed = 0;
  let refreshed = 0;
  let contended = 0;
  for (const candidate of candidates) {
    const evaluated = await input.evaluate(candidate);
    if (!evaluated.readiness.ready) {
      if (
        candidate.waitingReason === evaluated.readiness.reason
        && candidate.configurationVersion === evaluated.readiness.configurationVersion
      ) continue;
      if (!input.waitForConfiguration || !evaluated.readiness.reason) {
        throw validationError("Loop configuration wait refresh is unavailable");
      }
      try {
        await input.waitForConfiguration({
          loopRunId: candidate.loopRunId,
          nodeRunId: candidate.nodeRunId,
          nodeRunVersion: candidate.nodeRunVersion,
          projectId: candidate.projectId,
          recipientUserId: evaluated.recipientUserId,
          waitingReason: evaluated.readiness.reason,
          configurationVersion: evaluated.readiness.configurationVersion,
          evidence: evaluated.readiness.evidence,
          occurredAt: input.now,
          correlationId: `loop:${candidate.loopRunId}`,
          actor: { type: "system", id: "loop-configuration-resumer" },
        });
        refreshed += 1;
      } catch (error) {
        if (errorCode(error) !== "stale_lease") throw error;
        contended += 1;
      }
      continue;
    }
    try {
      await input.resume({
        loopRunId: candidate.loopRunId,
        nodeRunId: candidate.nodeRunId,
        nodeRunVersion: candidate.nodeRunVersion,
        occurredAt: input.now,
        correlationId: `loop:${candidate.loopRunId}`,
        actor: { type: "system", id: "loop-configuration-resumer" },
      });
      resumed += 1;
    } catch (error) {
      if (errorCode(error) !== "stale_lease") throw error;
      contended += 1;
    }
  }
  return { scanned: candidates.length, resumed, refreshed, contended };
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

interface WaitingConfigurationDb {
  loopNodeRun: Pick<typeof prisma.loopNodeRun, "findMany">;
}

export async function loadWaitingConfigurationCandidates(
  limit: number,
  db: WaitingConfigurationDb = prisma,
): Promise<WaitingConfigurationCandidate[]> {
  const rows = await db.loopNodeRun.findMany({
    where: {
      status: "waiting_configuration",
      loopRun: {
        engineKind: "graph_v1",
        status: "waiting",
      },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      loopRunId: true,
      activationNo: true,
      version: true,
      waitingReason: true,
      readinessEvidence: true,
      loopRun: { select: { projectId: true } },
    },
  });
  return rows.map((row) => ({
    loopRunId: row.loopRunId,
    projectId: requiredText(row.loopRun.projectId, "Waiting configuration projectId", 64),
    nodeRunId: row.id,
    nodeRunVersion: row.version,
    activationNo: row.activationNo,
    waitingReason: row.waitingReason,
    configurationVersion: storedReadinessConfigurationVersion(row.readinessEvidence),
  }));
}

function storedReadinessConfigurationVersion(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>).configurationVersion;
  return typeof version === "string" ? version : null;
}

interface LocalExecutionReadinessDb {
  loopNodeRun: {
    findUnique(args: unknown): Promise<unknown>;
  };
  agentProfile: {
    findFirst(args: unknown): Promise<unknown>;
  };
  agentWorker: {
    findMany(args: unknown): Promise<unknown[]>;
  };
  deviceAgentRuntimeProfile: {
    findFirst(args: unknown): Promise<unknown>;
  };
  projectDeviceWorkspace: {
    findFirst(args: unknown): Promise<unknown>;
  };
  automationGrant: {
    findMany(args: unknown): Promise<unknown[]>;
  };
  workerPool: {
    findFirst(args: unknown): Promise<unknown>;
  };
}

const WORKER_HEARTBEAT_TIMEOUT_MS = 60_000;

export async function loadPersistedLocalExecutionReadiness(
  input: { loopRunId: string; nodeRunId: string; now: Date },
  db: LocalExecutionReadinessDb = prisma as unknown as LocalExecutionReadinessDb,
): Promise<{ recipientUserId: string; readiness: LocalExecutionReadiness }> {
  const rowValue = await db.loopNodeRun.findUnique({
    where: { id: input.nodeRunId },
    select: {
      id: true,
      loopRunId: true,
      nodeKey: true,
      loopRun: {
        select: {
          projectId: true,
          bindingSnapshot: true,
          executionSnapshot: true,
          grantSnapshot: true,
          project: {
            select: {
              spaceId: true,
              ownerType: true,
              ownerUserId: true,
              companyId: true,
              repositoryConfiguration: true,
            },
          },
        },
      },
    },
  });
  const row = requireRecord(rowValue, "Local execution NodeRun is unavailable");
  if (row.loopRunId !== input.loopRunId) throw validationError("Local execution NodeRun belongs to another Run");
  const run = requireRecord(row.loopRun, "Local execution LoopRun is invalid");
  const nodeKey = requiredText(row.nodeKey, "Local execution nodeKey", 96);
  const projectId = requiredText(run.projectId, "Local execution projectId", 64);
  const project = requireRecord(run.project, "Local execution Project is invalid");
  const spaceId = requiredText(project.spaceId, "Local execution spaceId", 96);
  const binding = parseLocalExecutionBinding(run.bindingSnapshot);
  const executionTarget = parsePersistedExecutionTarget(run.executionSnapshot);
  const recipientUserId = requiredText(binding.createdByUserId, "Loop binding creator", 64);
  if (executionTarget?.type === "linux_worker_pool" || (!executionTarget && binding.workerExecution)) {
    if (executionTarget?.type === "linux_worker_pool" && binding.workerExecution?.workerPoolId !== executionTarget.workerPoolId) {
      throw configurationRequired("Selected Linux Worker Pool does not match the Run configuration");
    }
    if (!binding.workerExecution) throw configurationRequired("Linux Worker configuration is missing");
    if (!binding.workerExecution.workerStageConfigurations[nodeKey]) {
      throw configurationRequired("Linux Worker stage configuration is missing");
    }
    const projectWorkerScope = workerScopeForProject(project);
    const pool = await db.workerPool.findFirst({
      where: {
        id: binding.workerExecution.workerPoolId,
        ...workerResourceScopeWhere(projectWorkerScope),
        status: "active",
        revokedAt: null,
      },
      select: {
        id: true,
        maxConcurrentRuns: true,
        sessions: {
          where: { status: "active", revokedAt: null, expiresAt: { gt: input.now } },
          select: {
            requestedConcurrency: true,
            lastSeenAt: true,
            linuxRuns: {
              where: {
                status: { in: ["claimed", "starting", "running", "waiting_approval"] },
                leaseExpiresAt: { gt: input.now },
              },
              select: { id: true },
            },
          },
        },
      },
    });
    return {
      recipientUserId,
      readiness: evaluateLinuxWorkerExecutionReadiness({
        binding,
        pool,
        repositoryConfiguration: project.repositoryConfiguration,
        now: input.now,
      }),
    };
  }
  const requestedProfileId = executionTarget?.type === "local_agent"
    ? executionTarget.agentProfileId
    : binding.allowedAgentProfileIds[0] ?? null;
  const profileValue = requestedProfileId === null ? null : await db.agentProfile.findFirst({
    where: { id: requestedProfileId, spaceId, status: "active" },
    select: { id: true, provider: true, status: true },
  });
  const profile = parseOptionalProfile(profileValue);
  const provider = profile?.provider ?? binding.allowedProviders[0] ?? null;
  const workers = provider === null ? [] : await db.agentWorker.findMany({
    where: {
      status: "online",
      localDeviceId: { not: null },
      localDevice: { userId: recipientUserId, status: "authorized" },
    },
    orderBy: [{ id: "asc" }],
    select: {
      id: true,
      localDeviceId: true,
      status: true,
      version: true,
      lastHeartbeatAt: true,
      capabilities: true,
      localDevice: { select: { userId: true, status: true } },
    },
  });
  const grantIds = readAutomationGrantIds(run.grantSnapshot);
  const grantRows = grantIds.length === 0 ? [] : await db.automationGrant.findMany({
    where: {
      id: { in: grantIds },
      projectId,
      status: "active",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
    },
    orderBy: [{ id: "asc" }],
    select: { id: true, status: true, version: true, scope: true, expiresAt: true, revokedAt: true },
  });
  const grants = grantRows.map(parseGrantReadiness);
  const bindingReadiness = {
    id: binding.id,
    version: binding.version,
    allowedAgentProfileIds: binding.allowedAgentProfileIds,
    allowedProviders: binding.allowedProviders,
  };
  const parsedWorkers = workers.map(parseWorker).sort((left, right) => {
    const priority = (worker: Exclude<LocalExecutionWorker, null>): number => {
      const deviceId = worker.localDeviceId ?? "";
      const grantMatches = grants.some((grant) => (
        grant.workerIds.includes(worker.id) && grant.deviceIds.includes(deviceId)
      ));
      const providerMatches = worker.providers.includes(provider ?? "");
      const heartbeatFresh = worker.lastHeartbeatAt !== null
        && worker.lastHeartbeatAt.getTime() >= input.now.getTime() - WORKER_HEARTBEAT_TIMEOUT_MS;
      return Number(grantMatches) * 4 + Number(providerMatches) * 2 + Number(heartbeatFresh);
    };
    return priority(right) - priority(left) || left.id.localeCompare(right.id);
  });
  const readinessCandidates = await Promise.all(parsedWorkers.map(async (worker) => {
    const deviceId = worker.localDeviceId;
    const [runtimeValue, workspaceValue] = deviceId === null
      ? [null, null]
      : await Promise.all([
          provider === null ? null : db.deviceAgentRuntimeProfile.findFirst({
            where: { userId: recipientUserId, localDeviceId: deviceId, provider },
            orderBy: [{ id: "asc" }],
            select: { id: true, localDeviceId: true, provider: true, status: true, version: true },
          }),
          db.projectDeviceWorkspace.findFirst({
            where: { projectId, userId: recipientUserId, localDeviceId: deviceId },
            orderBy: [{ id: "asc" }],
            select: { id: true, projectId: true, localDeviceId: true, status: true, configurationVersion: true },
          }),
        ]);
    const runtime = parseOptionalRuntime(runtimeValue);
    const workspace = parseOptionalWorkspace(workspaceValue);
    const grant = grants.find((candidate) => (
      workspace !== null
      && profile !== null
      && candidate.workspaceBindingIds.includes(workspace.id)
      && candidate.agentProfileIds.includes(profile.id)
      && candidate.providers.includes(profile.provider)
      && candidate.deviceIds.includes(deviceId ?? "")
      && candidate.workerIds.includes(worker.id)
    )) ?? grants[0] ?? null;
    return evaluateLocalExecutionReadiness({
      binding: bindingReadiness,
      profile,
      adapterRegistered: provider === "codex",
      worker,
      runtime,
      workspace,
      grant,
      projectId,
      now: input.now,
      workerHeartbeatTimeoutMs: WORKER_HEARTBEAT_TIMEOUT_MS,
    });
  }));
  const readiness = readinessCandidates.find((candidate) => candidate.ready)
    ?? readinessCandidates[0]
    ?? evaluateLocalExecutionReadiness({
      binding: bindingReadiness,
      profile,
      adapterRegistered: provider === "codex",
      worker: null,
      runtime: null,
      workspace: null,
      grant: grants[0] ?? null,
      projectId,
      now: input.now,
      workerHeartbeatTimeoutMs: WORKER_HEARTBEAT_TIMEOUT_MS,
    });
  return { recipientUserId, readiness };
}

function workerScopeForProject(project: Record<string, unknown>): {
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
} {
  const ownerType = project.ownerType;
  const ownerUserId = typeof project.ownerUserId === "string" ? project.ownerUserId : null;
  const companyId = typeof project.companyId === "string" ? project.companyId : null;
  if (ownerType === "personal" && ownerUserId && !companyId) {
    return { ownerType, ownerUserId, companyId: null };
  }
  if (ownerType === "company" && companyId && !ownerUserId) {
    return { ownerType, ownerUserId: null, companyId };
  }
  throw configurationRequired("Project Worker resource scope is invalid");
}

async function evaluatePersistedLocalExecutionReadiness(
  candidate: WaitingConfigurationCandidate,
  now: Date,
): Promise<{ recipientUserId: string; readiness: LocalExecutionReadiness }> {
  return loadPersistedLocalExecutionReadiness({
    loopRunId: candidate.loopRunId,
    nodeRunId: candidate.nodeRunId,
    now,
  });
}

function parseLocalExecutionBinding(value: unknown): LocalExecutionBinding & { createdByUserId: string } {
  const binding = requireRecord(value, "Loop binding snapshot is invalid");
  return {
    id: requiredText(binding.id, "Loop binding id", 96),
    version: positiveNumber(binding.version, "Loop binding version"),
    createdByUserId: requiredText(binding.createdByUserId, "Loop binding creator", 64),
    allowedAgentProfileIds: stringList(binding.allowedAgentProfileIds),
    allowedProviders: stringList(binding.allowedProviders),
    ...(binding.workerExecution === undefined ? {} : {
      workerExecution: parseLinuxWorkerExecutionBinding(binding.workerExecution),
    }),
  };
}

function parsePersistedExecutionTarget(value: unknown):
  | { type: "local_agent"; agentProfileId: string }
  | { type: "linux_worker_pool"; workerPoolId: string }
  | null {
  const snapshot = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const target = snapshot?.target && typeof snapshot.target === "object" && !Array.isArray(snapshot.target)
    ? snapshot.target as Record<string, unknown>
    : null;
  if (target?.type === "local_agent") return { type: "local_agent", agentProfileId: requiredText(target.agentProfileId, "Run Local Agent", 96) };
  if (target?.type === "linux_worker_pool") return { type: "linux_worker_pool", workerPoolId: requiredText(target.workerPoolId, "Run Linux Worker Pool", 32) };
  return null;
}

function parseLinuxWorkerExecutionBinding(value: unknown): LinuxWorkerExecutionBinding {
  const configuration = requireRecord(value, "Linux Worker configuration is invalid");
  const workerPoolId = requiredText(configuration.workerPoolId, "Linux Worker Pool", 32);
  if (!/^[a-f0-9]{32}$/u.test(workerPoolId)) throw configurationRequired("Linux Worker Pool is invalid");
  const policy = requireRecord(configuration.workerBranchPolicy, "Linux Worker branch policy is invalid");
  const allowedBranches = stringList(policy.allowedBranches);
  if (allowedBranches.length === 0) throw configurationRequired("Linux Worker branch policy is invalid");
  const stages = requireRecord(configuration.workerStageConfigurations, "Linux Worker stage configuration is invalid");
  const workerStageConfigurations = Object.fromEntries(Object.entries(stages).map(([nodeKey, stage]) => {
    const parsed = requireRecord(stage, "Linux Worker stage configuration is invalid");
    const siteId = requiredText(parsed.siteId, "Linux Worker model site", 32);
    if (!/^[a-f0-9]{32}$/u.test(siteId)) throw configurationRequired("Linux Worker model site is invalid");
    return [requiredText(nodeKey, "Linux Worker stage", 96), {
      siteId,
      model: requiredText(parsed.model, "Linux Worker model", 191),
      reasoningEffort: requiredText(parsed.reasoningEffort, "Linux Worker reasoning effort", 16),
    }];
  }));
  if (Object.keys(workerStageConfigurations).length === 0) {
    throw configurationRequired("Linux Worker stage configuration is invalid");
  }
  return {
    workerPoolId,
    workerRepositoryUrl: requiredText(configuration.workerRepositoryUrl, "Linux Worker repository URL", 1024),
    workerBranchPolicy: { allowedBranches },
    workerStageConfigurations,
  };
}

function evaluateLinuxWorkerExecutionReadiness(input: {
  binding: LocalExecutionBinding;
  pool: unknown;
  repositoryConfiguration: unknown;
  now: Date;
}): LocalExecutionReadiness {
  const pool = parseLinuxWorkerPoolReadiness(input.pool, input.now);
  const evidence: LocalExecutionReadiness["evidence"] = {
    bindingId: input.binding.id,
    bindingVersion: input.binding.version,
    // AgentRun currently needs this foreign key for audit. It is not a Linux
    // readiness or routing requirement and is never queried on this path.
    agentProfileId: input.binding.allowedAgentProfileIds[0] ?? null,
    provider: null,
    workerId: pool?.id ? `linux-pool:${pool.id}` : null,
    workerVersion: pool?.lastSeenVersion ?? null,
    deviceId: null,
    runtimeProfileId: null,
    runtimeVersion: null,
    workspaceBindingId: null,
    workspaceConfigurationVersion: null,
    automationGrantId: null,
    automationGrantVersion: null,
  };
  const configurationVersion = readinessConfigurationVersion(evidence);
  const blocked = (reason: LoopConfigurationWaitingReason): LocalExecutionReadiness => ({
    ready: false,
    reason,
    configurationVersion,
    evidence,
  });
  if (input.binding.allowedAgentProfileIds.length === 0) return blocked("profile_not_allowed");
  if (hasUnverifiedRepositoryConfiguration(input.repositoryConfiguration)) {
    return blocked("repository_credential_unverified");
  }
  if (!pool?.hasCapacity) return blocked("worker_offline");
  return { ready: true, reason: null, configurationVersion, evidence };
}

function hasUnverifiedRepositoryConfiguration(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const parsed = projectRepositoryConfigurationSchema.safeParse(value);
  return !parsed.success || parsed.data.verification.status !== "passed";
}

function parseLinuxWorkerPoolReadiness(value: unknown, now: Date): {
  id: string;
  hasCapacity: boolean;
  lastSeenVersion: number | null;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pool = value as Record<string, unknown>;
  const id = typeof pool.id === "string" && /^[a-f0-9]{32}$/u.test(pool.id) ? pool.id : null;
  const maxConcurrentRuns = pool.maxConcurrentRuns;
  if (!id || !Number.isInteger(maxConcurrentRuns) || Number(maxConcurrentRuns) < 1) return null;
  const sessions = Array.isArray(pool.sessions) ? pool.sessions : [];
  const freshAfter = now.getTime() - WORKER_HEARTBEAT_TIMEOUT_MS;
  const active = sessions.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const session = value as Record<string, unknown>;
    const requestedConcurrency = session.requestedConcurrency;
    const lastSeenAt = session.lastSeenAt;
    if (!Number.isInteger(requestedConcurrency) || Number(requestedConcurrency) < 1 || !(lastSeenAt instanceof Date) || lastSeenAt.getTime() < freshAfter) return [];
    const currentRuns = Array.isArray(session.linuxRuns) ? session.linuxRuns.length : 0;
    return [{ requestedConcurrency: Number(requestedConcurrency), currentRuns, lastSeenAt }];
  });
  const capacity = Math.min(Number(maxConcurrentRuns), active.reduce((total, session) => total + session.requestedConcurrency, 0));
  const currentRuns = active.reduce((total, session) => total + session.currentRuns, 0);
  const lastSeenVersion = active.reduce<number | null>((latest, session) => (
    latest === null || session.lastSeenAt.getTime() > latest ? session.lastSeenAt.getTime() : latest
  ), null);
  return { id, hasCapacity: capacity > currentRuns, lastSeenVersion };
}

function parseOptionalProfile(value: unknown): Exclude<LocalExecutionProfile, null> | null {
  if (value === null) return null;
  const profile = requireRecord(value, "Agent Profile readiness is invalid");
  return {
    id: requiredText(profile.id, "Agent Profile id", 96),
    provider: requiredText(profile.provider, "Agent Profile provider", 32),
    status: requiredText(profile.status, "Agent Profile status", 32),
  };
}

function parseWorker(value: unknown): Exclude<LocalExecutionWorker, null> {
  const worker = requireRecord(value, "Agent Worker readiness is invalid");
  return {
    id: requiredText(worker.id, "Agent Worker id", 96),
    localDeviceId: worker.localDeviceId === null
      ? null
      : requiredText(worker.localDeviceId, "Agent Worker device id", 64),
    status: requiredText(worker.status, "Agent Worker status", 32),
    version: positiveNumber(worker.version, "Agent Worker version"),
    lastHeartbeatAt: worker.lastHeartbeatAt instanceof Date ? worker.lastHeartbeatAt : null,
    providers: stringList(worker.capabilities),
  };
}

function parseOptionalRuntime(value: unknown): Exclude<LocalExecutionRuntime, null> | null {
  if (value === null) return null;
  const runtime = requireRecord(value, "Agent runtime readiness is invalid");
  return {
    id: requiredText(runtime.id, "Agent runtime id", 96),
    localDeviceId: requiredText(runtime.localDeviceId, "Agent runtime device id", 64),
    provider: requiredText(runtime.provider, "Agent runtime provider", 32),
    status: requiredText(runtime.status, "Agent runtime status", 32),
    version: positiveNumber(runtime.version, "Agent runtime version"),
  };
}

function parseOptionalWorkspace(value: unknown): Exclude<LocalExecutionWorkspace, null> | null {
  if (value === null) return null;
  const workspace = requireRecord(value, "Project Workspace readiness is invalid");
  return {
    id: requiredText(workspace.id, "Project Workspace id", 96),
    projectId: requiredText(workspace.projectId, "Project Workspace project id", 64),
    localDeviceId: requiredText(workspace.localDeviceId, "Project Workspace device id", 64),
    status: requiredText(workspace.status, "Project Workspace status", 32),
    configurationVersion: positiveNumber(
      workspace.configurationVersion,
      "Project Workspace configuration version",
    ),
  };
}

function parseGrantReadiness(value: unknown): Exclude<LocalExecutionGrant, null> {
  const row = requireRecord(value, "AutomationGrant readiness is invalid");
  const scope = requireRecord(row.scope, "AutomationGrant scope is invalid");
  return {
    id: requiredText(row.id, "AutomationGrant id", 96),
    status: requiredText(row.status, "AutomationGrant status", 32),
    version: positiveNumber(row.version, "AutomationGrant version"),
    workspaceBindingIds: stringList(scope.workspaceBindingIds),
    agentProfileIds: stringList(scope.agentProfileIds),
    providers: stringList(scope.providers),
    deviceIds: stringList(scope.deviceIds),
    workerIds: stringList(scope.workerIds),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() === entry && entry.length > 0);
}

interface WaitingLoopCandidateDb {
  loopNodeAttempt: Pick<typeof prisma.loopNodeAttempt, "findMany">;
}

export async function loadWaitingLoopCandidates(
  limit: number,
  now: Date,
  db: WaitingLoopCandidateDb = prisma,
): Promise<WaitingLoopCandidate[]> {
  const rows = await db.loopNodeAttempt.findMany({
    where: {
      executorType: "platform",
      status: "waiting",
      AND: [
        { checkpoint: { path: "$.waitingReason", equals: "timer" } },
        { checkpoint: { path: "$.wakeAt", lte: now.toISOString() } },
      ],
      loopNodeRun: {
        status: "waiting_input",
        loopRun: {
          engineKind: "graph_v1",
          status: "waiting",
        },
      },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      attempt: true,
      version: true,
      checkpoint: true,
      loopNodeRun: {
        select: {
          id: true,
          loopRunId: true,
          version: true,
          inputSnapshot: true,
        },
      },
    },
  });
  return rows.map((row) => ({
    loopRunId: row.loopNodeRun.loopRunId,
    nodeRunId: row.loopNodeRun.id,
    nodeRunVersion: row.loopNodeRun.version,
    attemptId: row.id,
    attemptNo: row.attempt,
    attemptVersion: row.version,
    inputSnapshot: row.loopNodeRun.inputSnapshot,
    checkpoint: row.checkpoint,
  }));
}

interface RecoveryTransaction {
  agentRun: { updateMany(args: unknown): Promise<{ count: number }> };
  agentWorker: { updateMany(args: unknown): Promise<{ count: number }> };
  outboxMessage: { upsert(args: unknown): Promise<unknown> };
}

interface RecoveryDb {
  $transaction<T>(callback: (tx: RecoveryTransaction) => Promise<T>): Promise<T>;
}

export async function recoverExpiredRunAtomically(
  input: {
    id: string;
    loopRunId: string | null;
    leaseGeneration: number;
    workerId: string | null;
    now: Date;
  },
  db: RecoveryDb = prisma as unknown as RecoveryDb,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const result = await tx.agentRun.updateMany({
      where: {
        id: input.id,
        leaseGeneration: input.leaseGeneration,
        status: { in: ["claimed", "starting", "running", "waiting_approval"] },
        leaseExpiresAt: { lte: input.now },
      },
      data: {
        status: "orphaned",
        finishedAt: input.now,
        exitReason: "lease_expired",
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) return false;
    if (input.workerId) {
      await tx.agentWorker.updateMany({
        where: { id: input.workerId, activeRunCount: { gt: 0 } },
        data: { activeRunCount: { decrement: 1 } },
      });
    }
    if (input.loopRunId) {
      await tx.outboxMessage.upsert({
        where: { id: `recover:${input.id}` },
        create: {
          id: `recover:${input.id}`,
          topic: "run.recover",
          aggregateType: "loop",
          aggregateId: input.loopRunId,
          payload: { loopRunId: input.loopRunId, runId: input.id, reason: "orphaned" },
          availableAt: input.now,
        },
        update: {},
      });
    }
    return true;
  });
}

type ReadyGraphTopology = {
  nodes: ReadonlyArray<{ key: string; nodeId?: string | undefined }>;
  edges: ReadonlyArray<{
    id: string;
    source: string;
    target: string;
    kind: string;
    outcome: string;
    maxTraversals?: number | undefined;
  }>;
};

export function resolveReadyLoopGraph(input: {
  loopVersionId: string;
  runGraphSnapshot: unknown;
  publishedGraph: unknown;
}) {
  // Snapshots intentionally redact executable fields; use their frozen topology
  // to select and validate the version, then retain the published fields needed
  // by platform and local executors.
  const graph = parsePublishedLoopVersionGraph(input.publishedGraph);
  if (input.runGraphSnapshot === null || input.runGraphSnapshot === undefined) return graph;

  const snapshot = isPlainRecord(input.runGraphSnapshot) && input.runGraphSnapshot.schemaVersion === 2
    ? parseRunGraphSnapshotV2(input.runGraphSnapshot)
    : parseRunGraphSnapshot(input.runGraphSnapshot);
  const snapshotVersion = snapshot.loopVersions.find(
    (version) => version.loopVersionId === input.loopVersionId,
  );
  if (!snapshotVersion) {
    throw validationError("Ready NodeRun LoopVersion is outside its immutable graph snapshot");
  }
  assertReadyGraphTopology(snapshotVersion.graph, graph);
  return graph;
}

function assertReadyGraphTopology(
  snapshotGraph: ReadyGraphTopology,
  publishedGraph: ReadyGraphTopology,
): void {
  const nodeIdentity = (node: { key: string; nodeId?: string | undefined }) => `${node.key}\u0000${node.nodeId ?? node.key}`;
  const edgeIdentity = (edge: ReadyGraphTopology["edges"][number]) => JSON.stringify([
    edge.id,
    edge.source,
    edge.target,
    edge.kind,
    edge.outcome,
    edge.maxTraversals ?? null,
  ]);
  const snapshotNodes = snapshotGraph.nodes.map(nodeIdentity).sort();
  const publishedNodes = publishedGraph.nodes.map(nodeIdentity).sort();
  const snapshotEdges = snapshotGraph.edges.map(edgeIdentity).sort();
  const publishedEdges = publishedGraph.edges.map(edgeIdentity).sort();
  if (
    JSON.stringify(snapshotNodes) !== JSON.stringify(publishedNodes)
    || JSON.stringify(snapshotEdges) !== JSON.stringify(publishedEdges)
  ) {
    throw validationError("Ready NodeRun graph snapshot does not match its published LoopVersion topology");
  }
}

async function loadReadyLoopNodes(
  limit: number,
  now: Date,
): Promise<ReadyLoopNodeCandidate[]> {
  const rows = await prisma.loopNodeRun.findMany({
    where: {
      status: "ready",
      loopRun: {
        engineKind: "graph_v1",
        status: { in: ["pending", "running"] },
      },
    },
    orderBy: [{ readyAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      loopRunId: true,
      nodeKey: true,
      activationNo: true,
      attemptCount: true,
      inputSnapshot: true,
      version: true,
      loopRun: {
        select: {
          projectId: true,
          loopVersionId: true,
          runGraphSnapshot: true,
          bindingId: true,
          version: true,
          bindingSnapshot: true,
          grantSnapshot: true,
          project: { select: { spaceId: true } },
          loopVersion: { select: { id: true, graph: true } },
        },
      },
    },
  });
  const candidates: ReadyLoopNodeCandidate[] = [];
  for (const row of rows) {
    if (
      !row.loopRun.projectId
      || !row.loopRun.loopVersionId
      || !row.loopRun.loopVersion
      || row.loopRun.loopVersion.id !== row.loopRun.loopVersionId
      || !row.loopRun.project?.spaceId
    ) {
      throw validationError("Ready graph NodeRun is missing Project or LoopVersion identity");
    }
    const graph = resolveReadyLoopGraph({
      loopVersionId: row.loopRun.loopVersionId,
      runGraphSnapshot: row.loopRun.runGraphSnapshot,
      publishedGraph: row.loopRun.loopVersion.graph,
    });
    const node = graph.nodes.find((candidate) => candidate.key === row.nodeKey);
    if (!node) throw validationError("Ready NodeRun does not exist in its published graph");
    let agentProfileId: string | undefined;
    let localExecutionReadiness: LocalExecutionReadiness | undefined;
    let configurationRecipientUserId: string | undefined;
    if (node.type === "agent_action") {
      const persisted = await loadPersistedLocalExecutionReadiness({
        loopRunId: row.loopRunId,
        nodeRunId: row.id,
        now,
      });
      localExecutionReadiness = persisted.readiness;
      configurationRecipientUserId = persisted.recipientUserId;
      agentProfileId = persisted.readiness.evidence.agentProfileId ?? undefined;
    }
    const authorization = node.type === "platform_action"
      ? await evaluateReadyNodeAuthorization({
          loopRunId: row.loopRunId,
          loopRunVersion: row.loopRun.version,
          nodeRunId: row.id,
          projectId: row.loopRun.projectId,
          spaceId: row.loopRun.project.spaceId,
          bindingId: row.loopRun.bindingId,
          grantSnapshot: row.loopRun.grantSnapshot,
          node,
          agentProfileId: agentProfileId ?? null,
          now,
        })
      : null;
    candidates.push({
      loopRunId: row.loopRunId,
      projectId: row.loopRun.projectId,
      nodeRunId: row.id,
      nodeRunVersion: row.version,
      nodeKey: row.nodeKey,
      activationNo: row.activationNo,
      attemptCount: row.attemptCount,
      inputSnapshot: row.inputSnapshot,
      bindingSnapshot: row.loopRun.bindingSnapshot,
      ...(agentProfileId === undefined ? {} : { agentProfileId }),
      ...(localExecutionReadiness === undefined ? {} : {
        localExecutionReadiness: {
          ...localExecutionReadiness,
          evidence: { ...localExecutionReadiness.evidence },
        },
        ...(configurationRecipientUserId === undefined ? {} : { configurationRecipientUserId }),
      }),
      ...(authorization === null ? {} : {
        policyDecision: authorization.policyDecision,
        actionFingerprint: authorization.actionFingerprint,
      }),
      ...(node.type === "human_gate" ? { humanGateRoutes: deriveHumanGateRoutes(graph, node.key) } : {}),
      node,
    });
  }
  return candidates;
}

async function evaluateReadyNodeAuthorization(input: {
  loopRunId: string;
  loopRunVersion: number;
  nodeRunId: string;
  projectId: string;
  spaceId: string;
  bindingId: string | null;
  grantSnapshot: unknown;
  node: ReadyLoopNodeCandidate["node"];
  agentProfileId: string | null;
  now: Date;
}) {
  if (!input.bindingId) throw validationError("Ready executable node is missing its Loop binding");
  const grantIds = readAutomationGrantIds(input.grantSnapshot);
  const rows = await prisma.automationGrant.findMany({
    where: { id: { in: grantIds } },
    select: {
      id: true,
      spaceId: true,
      projectId: true,
      status: true,
      scope: true,
      policyVersion: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  const grants = reconcileLiveAutomationGrants({
    grantSnapshot: input.grantSnapshot,
    live: rows.map((row) => ({
      id: row.id,
      spaceId: row.spaceId,
      projectId: row.projectId,
      policyVersion: row.policyVersion,
      status: row.status,
      scope: row.scope,
      expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
      revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    })),
  });
  const action = assignmentAutomationAction(input);
  const actionFingerprint = `sha256:${createHash("sha256").update(JSON.stringify(action)).digest("hex")}`;
  let policyDecision = evaluateAutomationGrant({
    action,
    grants,
    now: input.now,
    policyDecision: action.production
      ? { outcome: "deny", reasonCode: "production_target_denied" }
      : { outcome: "allow", reasonCode: "platform_policy_allow" },
  });
  if (policyDecision.outcome === "require_approval") {
    const approvals = await prisma.approvalRequest.findMany({
      where: {
        loopRunId: input.loopRunId,
        loopNodeRunId: input.nodeRunId,
        type: "loop_runtime_safety",
        status: "approved",
      },
      orderBy: [{ decidedAt: "desc" }, { id: "asc" }],
      take: 25,
      select: {
        id: true,
        loopRunId: true,
        loopNodeRunId: true,
        type: true,
        status: true,
        requestPayload: true,
        grantPayload: true,
        expiresAt: true,
      },
    });
    policyDecision = matchReadyNodeRuntimeApproval({
      loopRunId: input.loopRunId,
      nodeRunId: input.nodeRunId,
      actionFingerprint,
      approvals,
      now: input.now,
    }) ?? policyDecision;
  }
  await persistReadyNodeAuthorization({
    loopRunId: input.loopRunId,
    loopRunVersion: input.loopRunVersion,
    nodeRunId: input.nodeRunId,
    projectId: input.projectId,
    actionFingerprint,
    policyVersion: action.policyVersion,
    outcome: policyDecision.outcome,
    reasonCode: policyDecision.reasonCode,
    matchedGrantId: policyDecision.matchedGrantId,
    occurredAt: input.now,
  });
  return {
    policyDecision,
    actionFingerprint,
  };
}

type ReadyNodeRuntimeApproval = {
  id: string;
  loopRunId: string | null;
  loopNodeRunId: string | null;
  type: string;
  status: string;
  requestPayload: unknown;
  grantPayload: unknown;
  expiresAt: Date | null;
};

export function matchReadyNodeRuntimeApproval(input: {
  loopRunId: string;
  nodeRunId: string;
  actionFingerprint: string;
  approvals: ReadyNodeRuntimeApproval[];
  now: Date;
}) {
  for (const approval of input.approvals) {
    if (
      approval.loopRunId !== input.loopRunId
      || approval.loopNodeRunId !== input.nodeRunId
      || approval.type !== "loop_runtime_safety"
      || approval.status !== "approved"
      || !isPlainRecord(approval.requestPayload)
      || approval.requestPayload.actionFingerprint !== input.actionFingerprint
      || !isPlainRecord(approval.grantPayload)
      || approval.grantPayload.kind !== "one_time_action"
      || approval.grantPayload.approvalId !== approval.id
      || approval.grantPayload.actionFingerprint !== input.actionFingerprint
      || typeof approval.grantPayload.expiresAt !== "string"
      || !Number.isFinite(Date.parse(approval.grantPayload.expiresAt))
      || Date.parse(approval.grantPayload.expiresAt) <= input.now.getTime()
      || approval.grantPayload.consumedAt !== null
    ) continue;
    return {
      outcome: "auto_approve" as const,
      reasonCode: "runtime_safety_approval_matched",
      matchedGrantId: approval.id,
    };
  }
  return null;
}

async function persistReadyNodeAuthorization(input: {
  loopRunId: string;
  loopRunVersion: number;
  nodeRunId: string;
  projectId: string;
  actionFingerprint: string;
  policyVersion: string;
  outcome: "deny" | "require_approval" | "auto_approve" | "allow";
  reasonCode: string;
  matchedGrantId: string | null;
  occurredAt: Date;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sequence = await tx.orchestrationAggregateSequence.upsert({
      where: {
        aggregateType_aggregateId: { aggregateType: "loop", aggregateId: input.loopRunId },
      },
      create: { aggregateType: "loop", aggregateId: input.loopRunId, sequence: 1 },
      update: { sequence: { increment: 1 } },
    });
    const eventId = `event:${createHash("sha256")
      .update(`loop.action.authorization_evaluated\0${input.loopRunId}\0${sequence.sequence}`)
      .digest("hex")}`;
    const payload = {
      nodeRunId: input.nodeRunId,
      projectId: input.projectId,
      actionFingerprint: input.actionFingerprint,
      policyVersion: input.policyVersion,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      matchedGrantId: input.matchedGrantId,
    };
    await tx.orchestrationEvent.create({
      data: {
        id: eventId,
        eventType: "loop.action.authorization_evaluated",
        aggregateType: "loop",
        aggregateId: input.loopRunId,
        aggregateVersion: input.loopRunVersion,
        sequence: sequence.sequence,
        correlationId: `loop:${input.loopRunId}`,
        actorType: "system",
        actorId: "loop-scheduler",
        occurredAt: input.occurredAt,
        payload,
      },
    });
    await tx.outboxMessage.create({
      data: {
        id: `outbox:${createHash("sha256").update(eventId).digest("hex")}`,
        topic: "orchestration.event",
        aggregateType: "loop",
        aggregateId: input.loopRunId,
        payload: {
          id: eventId,
          eventType: "loop.action.authorization_evaluated",
          aggregateType: "loop",
          aggregateId: input.loopRunId,
          aggregateVersion: input.loopRunVersion,
          sequence: sequence.sequence,
          correlationId: `loop:${input.loopRunId}`,
          actorType: "system",
          actorId: "loop-scheduler",
          occurredAt: input.occurredAt.toISOString(),
          payload,
        },
        availableAt: input.occurredAt,
      },
    });
  });
}

function assignmentAutomationAction(input: {
  projectId: string;
  spaceId: string;
  bindingId: string | null;
  node: ReadyLoopNodeCandidate["node"];
  agentProfileId: string | null;
}): AutomationAction {
  const riskRequirements = Reflect.get(input.node, "riskRequirements");
  const risk = isPlainRecord(riskRequirements) ? riskRequirements : {};
  return {
    requiresUserGrant: true,
    spaceId: input.spaceId,
    projectId: input.projectId,
    bindingId: requiredText(input.bindingId, "Loop binding id", 96),
    nodeKey: input.node.key,
    executionPlane: input.node.type === "agent_action" ? "local" : "platform",
    deviceId: null,
    workerId: null,
    agentProfileId: input.agentProfileId,
    provider: optionalRiskText(risk.provider),
    workspaceAccess: "none",
    workspaceBindingId: null,
    relativePath: null,
    workspaceContained: null,
    tool: optionalRiskText(risk.tool),
    commandCategory: optionalRiskText(risk.commandCategory),
    operationType: input.node.type === "platform_action"
      ? input.node.action ?? optionalRiskText(risk.operationType)
      : optionalRiskText(risk.operationType),
    networkTarget: optionalRiskText(risk.networkTarget),
    recipient: optionalRiskText(risk.recipient),
    credentialRef: optionalRiskText(risk.credentialRef),
    production: risk.production === true,
    usage: {
      concurrency: positiveRiskInteger(risk.concurrency, 1),
      durationMs: nonNegativeRiskNumber(risk.durationMs),
      tokens: nonNegativeRiskNumber(risk.tokens),
      costUsd: nonNegativeRiskNumber(risk.costUsd),
      toolCalls: nonNegativeRiskNumber(risk.toolCalls),
    },
    policyVersion: LOOP_AUTOMATION_POLICY_VERSION,
  };
}

function readAutomationGrantIds(value: unknown): string[] {
  if (!isPlainRecord(value) || !Array.isArray(value.automationGrantIds)) return [];
  return value.automationGrantIds.filter((id): id is string => typeof id === "string");
}

function optionalRiskText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "Risk requirement", 320);
}

function positiveRiskInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) <= 0) throw validationError("Risk concurrency is invalid");
  return value as number;
}

function nonNegativeRiskNumber(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw validationError("Risk usage is invalid");
  }
  return value;
}

function readRequestedAgentProfileId(bindingSnapshot: unknown): string {
  const binding = requireRecord(bindingSnapshot, "Loop binding snapshot is invalid");
  const overrides = requireRecord(
    binding.parameterOverrides,
    "Loop binding parameter overrides are invalid",
  );
  return requiredText(overrides.agentProfileId, "agentProfileId", 96);
}

function parseRecoverySignal(value: unknown): { loopRunId: string; runId: string } {
  const signal = requireRecord(value, "Run recovery signal is invalid");
  return {
    loopRunId: requiredText(signal.loopRunId, "loopRunId", 96),
    runId: requiredText(signal.runId, "runId", 96),
  };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(message);
  }
  return value as Record<string, unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
  ) throw validationError(`${name} is invalid`);
  return value;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function configurationRequired(message: string): Error & { code: "configuration_required" } {
  return Object.assign(new Error(message), { code: "configuration_required" as const });
}

function policyDenied(message: string): Error {
  return Object.assign(new Error(message), { code: "policy_denied" });
}
