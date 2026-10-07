import { createHash } from "node:crypto";
import { buildEffectKey, prisma, reserveEffectExecution, resolveEffectExecution } from "@humanthread/db";
import {
  LOOP_AUTOMATION_POLICY_VERSION,
  reconcileLiveAutomationGrants,
  type AutomationAction,
} from "@humanthread/orchestration-core";
import { buildLocalAgentWorkerId } from "../../../../../packages/shared/src/index";
import {
  authorizeLoopEffectRequest,
  type LoopActionAuthorizationResult,
  type LoopAuthorizationAuditEvent,
} from "./loop-action-authorization";

export type LoopEffectStatus =
  | "prepared"
  | "executing"
  | "succeeded"
  | "failed"
  | "reconciliation_required";

export type PrepareLoopEffectInput = {
  id: string;
  commandId: string;
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
  loopRunId: string;
  nodeRunId: string;
  attemptId?: string | null;
  operationType: string;
  requestFingerprint: string;
  providerIdempotencyKey?: string | null;
  request: unknown;
  networkTarget?: string | null;
  claimToken?: string;
  now: Date;
};

export type EffectReservation = {
  effectKey: string;
  status: LoopEffectStatus;
  providerIdempotencyKey: string;
  execute: boolean;
};

export type LoopEffectDependencies = {
  authorize: (
    input: PrepareLoopEffectInput | RecordLoopEffectReceiptInput,
  ) => Promise<void | LoopActionAuthorizationResult>;
  waitForApproval?: (
    input: PrepareLoopEffectInput,
    decision: LoopActionAuthorizationResult,
  ) => Promise<{ approvalId: string; status: "waiting_approval" }>;
  loadEffect: (effectKey: string) => Promise<EffectRecord | null>;
  createEffect: (input: {
    id: string;
    effectKey: string;
    loopRunId: string;
    nodeRunId: string;
    attemptId?: string | null;
    operationType: string;
    requestFingerprint: string;
    providerIdempotencyKey: string;
    claimToken?: string;
    actorId: string;
    leaseGeneration: number;
    occurredAt: Date;
  }) => Promise<EffectRecord>;
  resolveEffect: (input: {
    effectKey: string;
    loopRunId: string;
    nodeRunId: string;
    attemptId?: string | null;
    operationType: string;
    requestFingerprint: string;
    status: Exclude<LoopEffectStatus, "prepared" | "executing">;
    providerReceipt?: unknown;
    resultFingerprint?: string;
    claimToken?: string;
    actorId: string;
    leaseGeneration: number;
    resolvedAt: Date;
  }) => Promise<void>;
};

export type EffectRecord = {
  id: string;
  effectKey: string;
  loopRunId: string;
  nodeRunId: string;
  attemptId?: string | null;
  operationType: string;
  requestFingerprint: string;
  providerIdempotencyKey?: string | null;
  status: LoopEffectStatus;
};

export type RecordLoopEffectReceiptInput = Omit<PrepareLoopEffectInput, "id" | "request"> & {
  effectKey: string;
  status: Exclude<LoopEffectStatus, "prepared" | "executing">;
  providerReceipt?: unknown;
  resultFingerprint?: string;
};

type LoopEffectApprovalTransaction = {
  agentRun: {
    findUnique(input: unknown): Promise<{
      projectId: string | null;
      loopRunId: string | null;
      loopNodeRunId: string | null;
    } | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  loopNodeAttempt: { updateMany(input: unknown): Promise<{ count: number }> };
  loopNodeRun: { updateMany(input: unknown): Promise<{ count: number }> };
  loopRun: { updateMany(input: unknown): Promise<{ count: number }> };
  approvalRequest: {
    findUnique(input: unknown): Promise<{
      id: string;
      status: string;
      requestPayload: unknown;
    } | null>;
    create(input: unknown): Promise<unknown>;
  };
};

type LoopEffectApprovalDb = {
  $transaction<T>(callback: (transaction: LoopEffectApprovalTransaction) => Promise<T>): Promise<T>;
};

type LoopActionApprovalRecord = {
  id: string;
  loopRunId: string | null;
  loopNodeRunId: string | null;
  type: string;
  status: string;
  requestPayload: unknown;
  grantPayload: unknown;
  expiresAt: Date | null;
};

type LoopActionApprovalDb = {
  $transaction<T>(callback: (transaction: {
    approvalRequest: {
      findUnique(input: unknown): Promise<LoopActionApprovalRecord | null>;
      updateMany(input: unknown): Promise<{ count: number }>;
    };
  }) => Promise<T>): Promise<T>;
};

export async function prepareLoopEffect(
  input: PrepareLoopEffectInput,
  dependencies: LoopEffectDependencies,
): Promise<EffectReservation> {
  assertPrepareInput(input);
  assertSafeEffectPayload(input.request, "Effect request");
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) throw staleLeaseError();
  await assertPrepareAuthorizationOutcome(
    input,
    await dependencies.authorize(input),
    dependencies,
  );

  const effectKey = buildEffectKey(input);
  const existing = await dependencies.loadEffect(effectKey);
  if (existing) {
    assertMatchingReservation(existing, input);
    return toReservation(existing);
  }

  const providerIdempotencyKey = input.providerIdempotencyKey?.trim() || effectKey;
  const created = await dependencies.createEffect({
    id: input.id,
    effectKey,
    loopRunId: input.loopRunId,
    nodeRunId: input.nodeRunId,
    ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
    operationType: input.operationType,
    requestFingerprint: input.requestFingerprint,
    providerIdempotencyKey,
    ...(input.claimToken === undefined ? {} : { claimToken: input.claimToken }),
    actorId: input.workerId,
    leaseGeneration: input.leaseGeneration,
    occurredAt: input.now,
  });
  assertMatchingReservation(created, input);
  return toReservation(created);
}

export async function recordLoopEffectReceipt(
  input: RecordLoopEffectReceiptInput,
  dependencies: LoopEffectDependencies,
): Promise<{ effectKey: string; status: Exclude<LoopEffectStatus, "prepared" | "executing"> }> {
  assertReceiptInput(input);
  if (input.providerReceipt !== undefined) {
    assertSafeEffectPayload(input.providerReceipt, "Effect provider receipt");
  }
  if (input.workerId !== buildLocalAgentWorkerId(input.deviceId)) throw staleLeaseError();
  assertAuthorizationOutcome(await dependencies.authorize(input));
  const effect = await dependencies.loadEffect(input.effectKey);
  if (!effect) throw staleEffectError();
  assertMatchingReceipt(effect, input);
  await dependencies.resolveEffect({
    effectKey: input.effectKey,
    loopRunId: input.loopRunId,
    nodeRunId: input.nodeRunId,
    ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
    operationType: input.operationType,
    requestFingerprint: input.requestFingerprint,
    status: input.status,
    ...(input.providerReceipt === undefined ? {} : { providerReceipt: input.providerReceipt }),
    ...(input.resultFingerprint === undefined ? {} : { resultFingerprint: input.resultFingerprint }),
    ...(input.claimToken === undefined ? {} : { claimToken: input.claimToken }),
    actorId: input.workerId,
    leaseGeneration: input.leaseGeneration,
    resolvedAt: input.now,
  });
  return { effectKey: input.effectKey, status: input.status };
}

function assertAuthorizationOutcome(
  decision: void | LoopActionAuthorizationResult,
): void {
  if (!decision || decision.outcome === "allow" || decision.outcome === "auto_approve") return;
  if (decision.outcome === "deny") {
    throw Object.assign(new Error(decision.reasonCode), { code: "policy_denied" });
  }
  throw Object.assign(new Error(decision.reasonCode), {
    code: "approval_required",
    actionFingerprint: decision.actionFingerprint,
  });
}

async function assertPrepareAuthorizationOutcome(
  input: PrepareLoopEffectInput,
  decision: void | LoopActionAuthorizationResult,
  dependencies: LoopEffectDependencies,
): Promise<void> {
  if (!decision || decision.outcome !== "require_approval") {
    assertAuthorizationOutcome(decision);
    return;
  }
  const waiting = await dependencies.waitForApproval?.(input, decision);
  throw Object.assign(new Error(decision.reasonCode), {
    code: "approval_required",
    actionFingerprint: decision.actionFingerprint,
    ...(waiting === undefined ? {} : { approvalId: waiting.approvalId }),
  });
}

export async function markLoopEffectUnknown(
  input: Omit<RecordLoopEffectReceiptInput, "status" | "providerReceipt" | "resultFingerprint"> & { reason: string },
  dependencies: LoopEffectDependencies,
): Promise<{ effectKey: string; status: "reconciliation_required" }> {
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 512) {
    throw validationError("Effect reconciliation reason is invalid");
  }
  await recordLoopEffectReceipt({
    ...input,
    status: "reconciliation_required",
  }, dependencies);
  return { effectKey: input.effectKey, status: "reconciliation_required" };
}

export function createPrismaLoopEffectDependencies(): LoopEffectDependencies {
  return {
    authorize: authorizeLoopEffectWithPrisma,
    waitForApproval: (input, decision) => pauseLoopEffectForApproval(input, decision),
    loadEffect: async (effectKey) => prisma.effectExecution.findUnique({ where: { effectKey } }) as Promise<EffectRecord | null>,
    createEffect: async (input) => reserveEffectExecution({
      id: input.id,
      loopRunId: input.loopRunId,
      nodeRunId: input.nodeRunId,
      ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
      operationType: input.operationType,
      requestFingerprint: input.requestFingerprint,
      providerIdempotencyKey: input.providerIdempotencyKey,
      workerId: input.actorId,
      leaseGeneration: input.leaseGeneration,
      ...(input.claimToken === undefined ? {} : { claimToken: input.claimToken }),
      occurredAt: input.occurredAt,
      correlationId: `loop:${input.loopRunId}`,
      actor: { type: "worker", id: input.actorId },
    }) as Promise<EffectRecord>,
    resolveEffect: async (input) => {
      await resolveEffectExecution({
        ...input,
        workerId: input.actorId,
        resolvedAt: input.resolvedAt,
        correlationId: `loop:${input.loopRunId}`,
        actor: { type: "worker", id: input.actorId },
      });
    },
  };
}

export async function pauseLoopEffectForApproval(
  input: PrepareLoopEffectInput,
  decision: LoopActionAuthorizationResult,
  db: LoopEffectApprovalDb = prisma as unknown as LoopEffectApprovalDb,
): Promise<{ approvalId: string; status: "waiting_approval" }> {
  if (decision.outcome !== "require_approval") {
    throw validationError("Runtime safety wait requires an approval decision");
  }
  assertText(input.attemptId, "Loop attempt id", 128);
  const attemptId = input.attemptId;
  const approvalId = runtimeSafetyApprovalId(input.nodeRunId, decision.actionFingerprint);

  return db.$transaction(async (tx) => {
    const existing = await tx.approvalRequest.findUnique({
      where: { id: approvalId },
      select: { id: true, status: true, requestPayload: true },
    });
    if (isMatchingPendingApproval(existing, decision.actionFingerprint)) {
      return { approvalId, status: "waiting_approval" };
    }
    if (existing) throw staleLeaseError();

    const assignment = await tx.agentRun.findUnique({
      where: { id: input.agentRunId },
      select: { projectId: true, loopRunId: true, loopNodeRunId: true },
    });
    if (
      !assignment?.projectId
      || assignment.loopRunId !== input.loopRunId
      || assignment.loopNodeRunId !== input.nodeRunId
    ) throw staleLeaseError();

    const agentRun = await tx.agentRun.updateMany({
      where: {
        id: input.agentRunId,
        workerId: input.workerId,
        leaseGeneration: input.leaseGeneration,
        status: { in: ["claimed", "starting", "running"] },
        leaseExpiresAt: { gt: input.now },
      },
      data: {
        status: "cancelled",
        exitReason: "runtime_safety_approval_required",
        leaseExpiresAt: input.now,
        finishedAt: input.now,
        version: { increment: 1 },
      },
    });
    if (agentRun.count !== 1) throw staleLeaseError();

    const attempt = await tx.loopNodeAttempt.updateMany({
      where: { id: attemptId, agentRunId: input.agentRunId, status: "running" },
      data: {
        status: "cancelled",
        error: {
          code: "runtime_safety_approval_required",
          actionFingerprint: decision.actionFingerprint,
        },
        finishedAt: input.now,
        version: { increment: 1 },
      },
    });
    if (attempt.count !== 1) throw staleLeaseError();

    const node = await tx.loopNodeRun.updateMany({
      where: { id: input.nodeRunId, loopRunId: input.loopRunId, status: "running" },
      data: {
        status: "waiting_approval",
        waitingReason: "runtime_safety",
        version: { increment: 1 },
      },
    });
    if (node.count !== 1) throw staleLeaseError();

    const run = await tx.loopRun.updateMany({
      where: { id: input.loopRunId, status: "running" },
      data: {
        status: "waiting",
        statusReason: "runtime_safety",
        version: { increment: 1 },
        projectionVersion: { increment: 1 },
      },
    });
    if (run.count !== 1) throw staleLeaseError();

    await tx.approvalRequest.create({
      data: {
        id: approvalId,
        projectId: assignment.projectId,
        loopRunId: input.loopRunId,
        loopNodeRunId: input.nodeRunId,
        agentRunId: input.agentRunId,
        type: "loop_runtime_safety",
        status: "pending",
        requestedByActor: input.workerId,
        requestPayload: {
          actionFingerprint: decision.actionFingerprint,
          actionKey: buildRuntimeApprovalActionKey(input),
          effectId: input.id,
          operationType: input.operationType,
          requestFingerprint: input.requestFingerprint,
          networkTarget: input.networkTarget ?? null,
        },
        policySnapshot: {
          outcome: decision.outcome,
          reasonCode: decision.reasonCode,
          matchedGrantId: decision.matchedGrantId,
        },
        expiresAt: new Date(input.now.getTime() + 3_600_000),
      },
    });
    return { approvalId, status: "waiting_approval" };
  });
}

export async function consumeLoopActionApproval(input: {
  assignment: {
    loopRunId: string;
    nodeRunId: string;
  };
  actionFingerprint: string;
  actionKey: string;
  now: Date;
}, db: LoopActionApprovalDb = prisma as unknown as LoopActionApprovalDb): Promise<{
  approvalId: string;
} | null> {
  const approvalId = runtimeSafetyApprovalId(
    input.assignment.nodeRunId,
    input.actionFingerprint,
  );
  return db.$transaction(async (tx) => {
    const load = () => tx.approvalRequest.findUnique({
      where: { id: approvalId },
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
    const approval = await load();
    const grant = matchingOneTimeActionGrant(approval, input);
    if (!grant) return null;
    if (grant.consumedAt !== null) {
      return grant.actionKey === input.actionKey ? { approvalId: grant.approvalId } : null;
    }
    const consumed = {
      ...grant.payload,
      actionKey: input.actionKey,
      consumedAt: input.now.toISOString(),
    };
    const updated = await tx.approvalRequest.updateMany({
      where: {
        id: grant.approvalId,
        status: "approved",
        grantPayload: { equals: grant.payload },
      },
      data: { grantPayload: consumed },
    });
    if (updated.count === 1) return { approvalId: grant.approvalId };
    const winner = matchingOneTimeActionGrant(await load(), input);
    return winner?.actionKey === input.actionKey
      ? { approvalId: winner.approvalId }
      : null;
  });
}

function matchingOneTimeActionGrant(
  approval: LoopActionApprovalRecord | null,
  input: {
    assignment: { loopRunId: string; nodeRunId: string };
    actionFingerprint: string;
    actionKey: string;
    now: Date;
  },
): {
  approvalId: string;
  payload: Record<string, unknown>;
  actionKey: string | null;
  consumedAt: string | null;
} | null {
  if (
    !approval
    || approval.type !== "loop_runtime_safety"
    || approval.status !== "approved"
    || approval.loopRunId !== input.assignment.loopRunId
    || approval.loopNodeRunId !== input.assignment.nodeRunId
    || !isRecord(approval.requestPayload)
    || approval.requestPayload.actionFingerprint !== input.actionFingerprint
    || approval.requestPayload.actionKey !== input.actionKey
    || !isRecord(approval.grantPayload)
    || approval.grantPayload.kind !== "one_time_action"
    || approval.grantPayload.approvalId !== approval.id
    || approval.grantPayload.actionFingerprint !== input.actionFingerprint
    || typeof approval.grantPayload.expiresAt !== "string"
    || !Number.isFinite(Date.parse(approval.grantPayload.expiresAt))
    || Date.parse(approval.grantPayload.expiresAt) <= input.now.getTime()
  ) return null;
  const actionKey = typeof approval.grantPayload.actionKey === "string"
    ? approval.grantPayload.actionKey
    : null;
  const consumedAt = typeof approval.grantPayload.consumedAt === "string"
    ? approval.grantPayload.consumedAt
    : null;
  if (approval.grantPayload.consumedAt !== null && consumedAt === null) return null;
  return {
    approvalId: approval.id,
    payload: approval.grantPayload,
    actionKey,
    consumedAt,
  };
}

function buildRuntimeApprovalActionKey(input: PrepareLoopEffectInput): string {
  return `effect-action:${createHash("sha256").update(JSON.stringify([
    input.loopRunId,
    input.nodeRunId,
    input.operationType,
    input.id,
    input.requestFingerprint,
  ])).digest("hex")}`;
}

function runtimeSafetyApprovalId(nodeRunId: string, actionFingerprint: string): string {
  return `approval:${createHash("sha256")
    .update(`${nodeRunId}\0${actionFingerprint}`)
    .digest("hex")}`;
}

function isMatchingPendingApproval(
  approval: { status: string; requestPayload: unknown } | null,
  actionFingerprint: string,
): boolean {
  if (!approval || approval.status !== "pending" || !isRecord(approval.requestPayload)) return false;
  return approval.requestPayload.actionFingerprint === actionFingerprint;
}

async function authorizeLoopEffectWithPrisma(
  input: PrepareLoopEffectInput | RecordLoopEffectReceiptInput,
): Promise<LoopActionAuthorizationResult> {
  const assignment = await prisma.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: {
      taskId: true,
      workerId: true,
      leaseGeneration: true,
      leaseExpiresAt: true,
      status: true,
      projectId: true,
      agentProfileId: true,
      loopRunId: true,
      loopNodeRunId: true,
      attempt: true,
      worker: { select: { localDeviceId: true, status: true } },
      project: { select: { spaceId: true } },
      loopNodeRun: { select: { nodeKey: true } },
      loopNodeAttempt: {
        select: { id: true, agentRunId: true, executorType: true, status: true },
      },
      loopRun: {
        select: {
          engineKind: true,
          bindingId: true,
          version: true,
          grantSnapshot: true,
        },
      },
    },
  });
  const attempt = assignment?.loopNodeAttempt;
  const loopRun = assignment?.loopRun;
  if (
    !assignment
    || assignment.taskId !== null
    || assignment.workerId !== input.workerId
    || assignment.leaseGeneration !== input.leaseGeneration
    || !assignment.leaseExpiresAt
    || assignment.leaseExpiresAt <= input.now
    || !["claimed", "starting", "running", "waiting_approval"].includes(assignment.status)
    || assignment.loopRunId !== input.loopRunId
    || assignment.loopNodeRunId !== input.nodeRunId
    || !attempt
    || attempt.id !== input.attemptId
    || attempt.agentRunId !== input.agentRunId
    || attempt.executorType !== "local"
    || attempt.status !== "running"
    || assignment.worker?.localDeviceId !== input.deviceId
    || assignment.worker.status !== "online"
    || !loopRun
    || loopRun.engineKind !== "graph_v1"
  ) throw staleLeaseError();
  if (
    !assignment.projectId
    || !assignment.project?.spaceId
    || !assignment.loopNodeRun?.nodeKey
    || !loopRun.bindingId
  ) throw authorizationError();
  const grantIds = readGrantIds(loopRun.grantSnapshot);
  const grants = await prisma.automationGrant.findMany({
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
  const liveGrants = reconcileLiveAutomationGrants({
    grantSnapshot: loopRun.grantSnapshot,
    live: grants.map((grant) => ({
      id: grant.id,
      spaceId: grant.spaceId,
      projectId: grant.projectId,
      policyVersion: grant.policyVersion,
      status: grant.status,
      scope: grant.scope,
      expiresAt: grant.expiresAt === null ? null : grant.expiresAt.toISOString(),
      revokedAt: grant.revokedAt === null ? null : grant.revokedAt.toISOString(),
    })),
  });
  const action = effectAutomationAction({
    input,
    assignment: {
      spaceId: assignment.project.spaceId,
      projectId: assignment.projectId,
      bindingId: loopRun.bindingId,
      nodeKey: assignment.loopNodeRun.nodeKey,
      workerId: assignment.workerId,
      agentProfileId: assignment.agentProfileId,
    },
  });
  return authorizeLoopEffectRequest({
    assignment: {
      projectId: assignment.projectId,
      spaceId: assignment.project.spaceId,
      bindingId: loopRun.bindingId,
      loopRunId: input.loopRunId,
      loopRunVersion: loopRun.version,
      nodeRunId: input.nodeRunId,
      workerId: input.workerId,
      grantSnapshot: { automationGrantIds: grantIds, grants: liveGrants },
    },
    action,
    ...("request" in input ? { actionKey: buildRuntimeApprovalActionKey(input) } : {}),
    fingerprintContext: "request" in input
      ? { effectId: input.id, requestFingerprint: input.requestFingerprint }
      : { effectKey: input.effectKey, requestFingerprint: input.requestFingerprint },
    now: input.now,
  }, {
    assertResourceAccess: async () => undefined,
    assertLease: async () => undefined,
    evaluatePlatformPolicy: async (candidate) => candidate.production
      ? { outcome: "deny", reasonCode: "production_target_denied" }
      : { outcome: "allow", reasonCode: "platform_policy_allow" },
    consumeOneTimeActionGrant: (grantInput) => consumeLoopActionApproval(grantInput),
    appendAuditEvent: (event) => persistAuthorizationAuditEvent(event, input.workerId),
  });
}

export function effectAutomationAction(input: {
  input: PrepareLoopEffectInput | RecordLoopEffectReceiptInput;
  assignment: {
    spaceId: string;
    projectId: string;
    bindingId: string;
    nodeKey: string;
    workerId: string | null;
    agentProfileId: string;
  };
}): AutomationAction {
  const requestValue = "request" in input.input ? input.input.request : undefined;
  const request = isRecord(requestValue) ? requestValue : {};
  return {
    requiresUserGrant: "request" in input.input,
    spaceId: input.assignment.spaceId,
    projectId: input.assignment.projectId,
    bindingId: input.assignment.bindingId,
    nodeKey: input.assignment.nodeKey,
    executionPlane: "local",
    deviceId: input.input.deviceId,
    workerId: input.assignment.workerId,
    agentProfileId: input.assignment.agentProfileId,
    provider: textOrNull(request.provider),
    workspaceAccess: "none",
    workspaceBindingId: null,
    relativePath: null,
    workspaceContained: null,
    tool: textOrNull(request.tool),
    commandCategory: textOrNull(request.commandCategory),
    operationType: input.input.operationType,
    networkTarget: input.input.networkTarget ?? null,
    recipient: textOrNull(request.recipient ?? request.to),
    credentialRef: null,
    production: request.production === true,
    usage: {
      concurrency: 1,
      durationMs: numberOrZero(request.durationMs),
      tokens: numberOrZero(request.tokens),
      costUsd: numberOrZero(request.costUsd),
      toolCalls: 1,
    },
    policyVersion: LOOP_AUTOMATION_POLICY_VERSION,
  };
}

function textOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value !== value.trim()) {
    throw validationError("Effect authorization text dimension is invalid");
  }
  return value;
}

function numberOrZero(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw validationError("Effect authorization usage is invalid");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function persistAuthorizationAuditEvent(
  event: LoopAuthorizationAuditEvent,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sequence = await tx.orchestrationAggregateSequence.upsert({
      where: {
        aggregateType_aggregateId: {
          aggregateType: "loop",
          aggregateId: event.loopRunId,
        },
      },
      create: { aggregateType: "loop", aggregateId: event.loopRunId, sequence: 1 },
      update: { sequence: { increment: 1 } },
    });
    const eventId = `event:${createHash("sha256")
      .update(`loop.action.authorization_evaluated\0${event.loopRunId}\0${sequence.sequence}`)
      .digest("hex")}`;
    const payload = {
      nodeRunId: event.nodeRunId,
      projectId: event.projectId,
      actionFingerprint: event.actionFingerprint,
      policyVersion: event.policyVersion,
      outcome: event.outcome,
      reasonCode: event.reasonCode,
      matchedGrantId: event.matchedGrantId,
    };
    await tx.orchestrationEvent.create({
      data: {
        id: eventId,
        eventType: "loop.action.authorization_evaluated",
        aggregateType: "loop",
        aggregateId: event.loopRunId,
        aggregateVersion: event.loopRunVersion,
        sequence: sequence.sequence,
        correlationId: `loop:${event.loopRunId}`,
        actorType: "worker",
        actorId,
        occurredAt: event.occurredAt,
        payload,
      },
    });
    await tx.outboxMessage.create({
      data: {
        id: `outbox:${createHash("sha256").update(eventId).digest("hex")}`,
        topic: "orchestration.event",
        aggregateType: "loop",
        aggregateId: event.loopRunId,
        payload: {
          id: eventId,
          eventType: "loop.action.authorization_evaluated",
          aggregateType: "loop",
          aggregateId: event.loopRunId,
          aggregateVersion: event.loopRunVersion,
          sequence: sequence.sequence,
          correlationId: `loop:${event.loopRunId}`,
          actorType: "worker",
          actorId,
          occurredAt: event.occurredAt.toISOString(),
          payload,
        },
        availableAt: event.occurredAt,
      },
    });
  });
}

type LoopEffectGrantRecord = {
  id: string;
  spaceId?: string;
  projectId: string;
  status: string;
  scope: unknown;
  policyVersion?: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export function matchLoopEffectGrant(input: {
  grantIds: string[];
  grants: LoopEffectGrantRecord[];
  projectId: string;
  operationType: string,
  networkTarget?: string | null;
  now: Date;
}): string | null {
  const allowedIds = new Set(input.grantIds);
  for (const grant of input.grants) {
    if (
      !allowedIds.has(grant.id)
      || grant.projectId !== input.projectId
      || !["active", "approved", "enabled"].includes(grant.status)
      || grant.revokedAt !== null
      || (grant.expiresAt !== null && grant.expiresAt <= input.now)
    ) continue;
    const scopes = effectScopes(grant.scope);
    for (const scope of scopes) {
      const operations = firstStringArray(scope.operationTypes, scope.allowedOperations, scope.operations);
      if (!operations || (!operations.includes(input.operationType) && !operations.includes("*"))) continue;
      const targets = firstStringArray(scope.networkTargets);
      if (targets && targets.length > 0) {
        if (!input.networkTarget || (!targets.includes(input.networkTarget) && !targets.includes("*"))) continue;
      } else if (input.networkTarget) continue;
      return grant.id;
    }
  }
  return null;
}

function readGrantIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return firstStringArray((value as Record<string, unknown>).automationGrantIds) ?? [];
}

function effectScopes(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const scope = value as Record<string, unknown>;
  return [scope, scope.effect, scope.effects]
    .filter((candidate): candidate is Record<string, unknown> => (
      Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate)
    ));
}

function firstStringArray(...values: unknown[]): string[] | null {
  for (const value of values) {
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  }
  return null;
}

function toReservation(effect: EffectRecord): EffectReservation {
  assertEffectStatus(effect.status);
  const providerIdempotencyKey = String(effect.providerIdempotencyKey ?? effect.effectKey);
  return {
    effectKey: effect.effectKey,
    status: effect.status,
    providerIdempotencyKey,
    execute: effect.status === "prepared",
  };
}

function assertMatchingReservation(effect: EffectRecord, input: PrepareLoopEffectInput): void {
  if (
    effect.id !== input.id
    || effect.effectKey !== buildEffectKey(input)
    || effect.loopRunId !== input.loopRunId
    || effect.nodeRunId !== input.nodeRunId
    || (effect.attemptId ?? null) !== (input.attemptId ?? null)
    || effect.operationType !== input.operationType
    || effect.requestFingerprint !== input.requestFingerprint
    || (effect.providerIdempotencyKey ?? effect.effectKey)
      !== (input.providerIdempotencyKey?.trim() || effect.effectKey)
  ) throw validationError("Effect reservation conflicts with its persisted identity or request fingerprint");
}

function assertMatchingReceipt(effect: EffectRecord, input: RecordLoopEffectReceiptInput): void {
  if (
    effect.effectKey !== input.effectKey
    || effect.loopRunId !== input.loopRunId
    || effect.nodeRunId !== input.nodeRunId
    || (effect.attemptId ?? null) !== (input.attemptId ?? null)
    || effect.operationType !== input.operationType
    || effect.requestFingerprint !== input.requestFingerprint
  ) throw validationError("Effect receipt conflicts with its reservation identity or request fingerprint");
}

function assertEffectStatus(value: unknown): asserts value is LoopEffectStatus {
  if (!["prepared", "executing", "succeeded", "failed", "reconciliation_required"].includes(String(value))) {
    throw validationError("Effect status is invalid");
  }
}

function assertSafeEffectPayload(value: unknown, name: string): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw validationError(`${name} is not JSON serializable`);
  }
  if (
    serialized === undefined
    || new TextEncoder().encode(serialized).byteLength > 64 * 1_024
  ) throw validationError(`${name} exceeds 64 KiB`);
  assertNoCredentialKeys(value, name);
}

function assertNoCredentialKeys(value: unknown, name: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoCredentialKeys(item, name);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (
      normalized.includes("accesstoken")
      || normalized.includes("refreshtoken")
      || normalized.includes("apitoken")
      || normalized.includes("password")
      || normalized.includes("secret")
      || normalized.includes("cookie")
      || normalized.includes("credential")
      || normalized.includes("authorization")
      || normalized.includes("browsersession")
    ) throw validationError(`${name} contains credential material`);
    assertNoCredentialKeys(nested, name);
  }
}

function assertPrepareInput(input: PrepareLoopEffectInput): void {
  for (const [value, name, max] of [
    [input.id, "Effect id", 128],
    [input.commandId, "Effect command id", 128],
    [input.agentRunId, "AgentRun id", 96],
    [input.workerId, "Worker id", 96],
    [input.deviceId, "Device id", 96],
    [input.loopRunId, "LoopRun id", 96],
    [input.nodeRunId, "NodeRun id", 96],
    [input.operationType, "Effect operation type", 96],
    [input.requestFingerprint, "Effect request fingerprint", 128],
  ] as const) {
    assertText(value, name, max);
  }
  if (!Number.isInteger(input.leaseGeneration) || input.leaseGeneration <= 0) throw validationError("Effect lease generation is invalid");
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw validationError("Effect time is invalid");
  if (input.networkTarget !== undefined && input.networkTarget !== null) assertText(input.networkTarget, "Effect network target", 191);
}

function assertReceiptInput(input: RecordLoopEffectReceiptInput): void {
  for (const [value, name, max] of [
    [input.effectKey, "Effect key", 191],
    [input.commandId, "Effect command id", 128],
    [input.agentRunId, "AgentRun id", 96],
    [input.workerId, "Worker id", 96],
    [input.deviceId, "Device id", 96],
    [input.loopRunId, "LoopRun id", 96],
    [input.nodeRunId, "NodeRun id", 96],
  ] as const) assertText(value, name, max);
  if (!Number.isInteger(input.leaseGeneration) || input.leaseGeneration <= 0) throw validationError("Effect lease generation is invalid");
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw validationError("Effect time is invalid");
  if (!["succeeded", "failed", "reconciliation_required"].includes(input.status)) throw validationError("Effect receipt status is invalid");
  if (input.resultFingerprint !== undefined) assertText(input.resultFingerprint, "Effect result fingerprint", 128);
}

function assertText(value: unknown, name: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw validationError(`${name} is invalid`);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function staleLeaseError(): Error {
  return Object.assign(new Error("Stale or expired graph assignment lease"), { code: "stale_lease" });
}

function staleEffectError(): Error {
  return Object.assign(new Error("Effect reservation was not found"), { code: "stale_effect" });
}

function authorizationError(): Error {
  return Object.assign(new Error("Automation grant does not authorize this external effect"), {
    code: "authorization_denied",
  });
}
