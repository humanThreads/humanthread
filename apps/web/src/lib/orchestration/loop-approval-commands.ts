import { createHash } from "node:crypto";
import {
  deriveHumanGateRoutes,
  loopAuthoringGraphSchema,
  type HumanGateRoutes,
} from "@humanthread/orchestration-core";
import {
  assertCanWriteProject,
  prisma,
  routeGateDecision,
  type LoopGateRoutingDb,
} from "@humanthread/db";
import { expirePendingApproval } from "./approval-visibility";

export type LoopApprovalDecision = "approved" | "changes_requested" | "rejected";

export type LoopApprovalRecord = {
  id: string;
  projectId: string;
  loopRunId: string | null;
  loopNodeRunId: string | null;
  automationGrantId?: string | null;
  type: string;
  status: string;
  requestPayload: unknown;
  policySnapshot: unknown;
  expiresAt: Date | null;
  loopNodeRun?: {
    nodeKey: string;
    loopRun: { loopVersion: { graph: unknown } | null };
  } | null;
};

type ApprovalCreateDependencies = {
  create(input: Record<string, unknown>): Promise<unknown>;
};

const CREATE_DEFAULTS: ApprovalCreateDependencies = {
  create: (data) => prisma.approvalRequest.create({ data: data as never }),
};

export async function openHumanGateApproval(input: {
  approvalId: string;
  projectId: string;
  loopRunId: string;
  loopNodeRunId: string;
  requestedByActor: string;
  prompt: string;
  routes: HumanGateRoutes;
  policySnapshot: unknown;
}, dependencies: ApprovalCreateDependencies = CREATE_DEFAULTS) {
  const routes = parseRoutes(input.routes);
  return dependencies.create({
    id: requiredText(input.approvalId, "Approval id", 96),
    projectId: requiredText(input.projectId, "Project id", 64),
    loopRunId: requiredText(input.loopRunId, "LoopRun id", 96),
    loopNodeRunId: requiredText(input.loopNodeRunId, "NodeRun id", 96),
    type: "loop_human_gate",
    status: "pending",
    requestedByActor: requiredText(input.requestedByActor, "Requested actor", 191),
    requestPayload: { prompt: boundedText(input.prompt, "Human Gate prompt", 4_000), routes },
    policySnapshot: requireRecord(input.policySnapshot, "Policy snapshot is invalid"),
    expiresAt: null,
  });
}

export async function openRuntimeSafetyApproval(input: {
  approvalId: string;
  projectId: string;
  loopRunId: string;
  loopNodeRunId: string;
  requestedByActor: string;
  actionFingerprint: string;
  action: unknown;
  policySnapshot: unknown;
  now: Date;
}, dependencies: ApprovalCreateDependencies = CREATE_DEFAULTS) {
  assertValidDate(input.now, "Approval time");
  return dependencies.create({
    id: requiredText(input.approvalId, "Approval id", 96),
    projectId: requiredText(input.projectId, "Project id", 64),
    loopRunId: requiredText(input.loopRunId, "LoopRun id", 96),
    loopNodeRunId: requiredText(input.loopNodeRunId, "NodeRun id", 96),
    type: "loop_runtime_safety",
    status: "pending",
    requestedByActor: requiredText(input.requestedByActor, "Requested actor", 191),
    requestPayload: {
      actionFingerprint: requiredText(input.actionFingerprint, "Action fingerprint", 128),
      action: input.action,
    },
    policySnapshot: requireRecord(input.policySnapshot, "Policy snapshot is invalid"),
    expiresAt: new Date(input.now.getTime() + 3_600_000),
  });
}

export type LoopApprovalDecisionInput = {
  approvalId: string;
  actorUserId: string;
  decision: LoopApprovalDecision;
  reason: string;
  selectedEdgeId?: string;
  now: Date;
};

export type LoopApprovalDecisionResult = {
  approvalId: string;
  status: string;
  [key: string]: unknown;
};

export type LoopApprovalDependencies = {
  loadForDecision(id: string): Promise<LoopApprovalRecord | null>;
  expireApproval?(input: { approvalId: string; now: Date }): Promise<{ count: number }>;
  authorize(input: { userId: string; projectId: string }): Promise<unknown>;
  routeHumanGate(input: {
    approval: LoopApprovalRecord;
    actorUserId: string;
    decision: LoopApprovalDecision;
    outcome: "pass" | "rework" | "reject";
    selectedEdgeId: string;
    message: string;
    now: Date;
  }): Promise<unknown>;
  failOrCancelWaitingAction(input: {
    approval: LoopApprovalRecord;
    actorUserId: string;
    reason: string;
    now: Date;
  }): Promise<unknown>;
  reEvaluateRuntimeSafety?(input: {
    approval: LoopApprovalRecord;
    actionFingerprint: string;
    now: Date;
  }): Promise<void>;
  resumeWithOneTimeActionGrant(input: {
    approval: LoopApprovalRecord;
    actorUserId: string;
    reason: string;
    actionFingerprint: string;
    expiresAt: Date;
    now: Date;
  }): Promise<unknown>;
};

export async function applyLoopApprovalDecision(
  input: LoopApprovalDecisionInput,
  dependencies: LoopApprovalDependencies = DEFAULTS,
): Promise<LoopApprovalDecisionResult> {
  assertValidDate(input.now, "Approval decision time");
  const approval = await dependencies.loadForDecision(requiredText(input.approvalId, "Approval id", 96));
  if (!approval) throw notFound("Approval not found");
  await dependencies.authorize({ userId: input.actorUserId, projectId: approval.projectId });
  if (approval.status === "pending" && approval.expiresAt !== null && approval.expiresAt <= input.now) {
    await dependencies.expireApproval?.({ approvalId: approval.id, now: input.now });
    throw versionConflict("Approval already decided or expired");
  }
  if (approval.status !== "pending") {
    throw versionConflict("Approval already decided or expired");
  }

  if (approval.type === "loop_human_gate") {
    const outcome = decisionOutcome(input.decision);
    const selectedEdgeId = requiredText(input.selectedEdgeId, "Human Gate selected edge", 96);
    const routes = resolveHumanGateRoutes(approval);
    if (!routes[outcome].includes(selectedEdgeId)) {
      throw validationError("Human Gate selected edge does not match its decision outcome");
    }
    if (input.decision !== "approved" && !input.reason.trim()) {
      throw validationError("Human Gate feedback reason is required");
    }
    const routed = await dependencies.routeHumanGate({
      approval,
      actorUserId: input.actorUserId,
      decision: input.decision,
      outcome,
      selectedEdgeId,
      message: input.reason.trim(),
      now: input.now,
    });
    return { approvalId: approval.id, status: input.decision, outcome, selectedEdgeId, routed };
  }

  if (approval.type !== "loop_runtime_safety") {
    throw validationError("Approval is not a Loop approval");
  }
  if (input.decision === "changes_requested") {
    throw validationError("Runtime safety approvals do not support changes_requested");
  }
  if (input.decision === "rejected") {
    if (!input.reason.trim()) throw validationError("Rejection reason is required");
    const failed = await dependencies.failOrCancelWaitingAction({
      approval,
      actorUserId: input.actorUserId,
      reason: input.reason.trim(),
      now: input.now,
    });
    return { approvalId: approval.id, status: "rejected", failed };
  }

  const request = requireRecord(approval.requestPayload, "Runtime safety request is invalid");
  const actionFingerprint = requiredText(request.actionFingerprint, "Action fingerprint", 128);
  await dependencies.reEvaluateRuntimeSafety?.({ approval, actionFingerprint, now: input.now });
  const expiresAt = new Date(input.now.getTime() + 3_600_000);
  const resumed = await dependencies.resumeWithOneTimeActionGrant({
    approval,
    actorUserId: input.actorUserId,
    reason: input.reason.trim(),
    actionFingerprint,
    expiresAt,
    now: input.now,
  });
  return {
    approvalId: approval.id,
    status: "approved",
    grant: { approvalId: approval.id, actionFingerprint, expiresAt: expiresAt.toISOString() },
    resumed,
  };
}

const DEFAULTS: LoopApprovalDependencies = {
  loadForDecision: (id) => prisma.approvalRequest.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      loopRunId: true,
      loopNodeRunId: true,
      automationGrantId: true,
      type: true,
      status: true,
      requestPayload: true,
      policySnapshot: true,
      expiresAt: true,
      loopNodeRun: {
        select: {
          nodeKey: true,
          loopRun: { select: { loopVersion: { select: { graph: true } } } },
        },
      },
    },
  }),
  expireApproval: ({ approvalId, now }) => expirePendingApproval({ approvalId, now, updateMany: (args) => prisma.approvalRequest.updateMany(args) }),
  authorize: (input) => assertCanWriteProject(input),
  routeHumanGate: (input) => routeHumanGateWithPrisma(input),
  failOrCancelWaitingAction: (input) => failRuntimeSafetyWithPrisma(input),
  reEvaluateRuntimeSafety: (input) => reEvaluateRuntimeSafetyWithPrisma(input),
  resumeWithOneTimeActionGrant: (input) => resumeRuntimeSafetyWithPrisma(input),
};

async function routeHumanGateWithPrisma(
  input: Parameters<LoopApprovalDependencies["routeHumanGate"]>[0],
) {
  const approval = requireLoopIdentity(input.approval);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.approvalRequest.updateMany({
      where: { id: approval.id, status: "pending" },
      data: {
        status: input.decision,
        decidedByUserId: input.actorUserId,
        decisionReason: input.message,
        decidedAt: input.now,
      },
    });
    if (updated.count !== 1) throw versionConflict("Approval decision conflict");
    return routeGateDecision({
      command: {
        commandId: decisionCommandId(approval.id, input.decision, input.selectedEdgeId),
        correlationId: `loop:${approval.loopRunId}`,
        actor: { type: "user", id: input.actorUserId },
        payload: { approvalId: approval.id, decision: input.decision },
        issuedAt: input.now,
      },
      loopRunId: approval.loopRunId,
      loopNodeRunId: approval.loopNodeRunId,
      decision: {
        outcome: input.outcome,
        reasonCode: `human_gate_${input.decision}`,
        message: input.message,
        evidenceRefs: [`approval:${approval.id}`],
        selectedEdgeId: input.selectedEdgeId,
      },
    }, { db: { $transaction: (callback) => callback(tx as unknown as Parameters<Parameters<LoopGateRoutingDb["$transaction"]>[0]>[0]) } });
  });
}

async function reEvaluateRuntimeSafetyWithPrisma(input: {
  approval: LoopApprovalRecord;
  actionFingerprint: string;
  now: Date;
}): Promise<void> {
  const policy = requireRecord(input.approval.policySnapshot, "Runtime safety policy snapshot is invalid");
  if (policy.outcome === "deny") throw policyDenied("Current platform policy denies this action");
  if (!input.approval.automationGrantId) return;
  const grant = await prisma.automationGrant.findUnique({
    where: { id: input.approval.automationGrantId },
    select: { status: true, revokedAt: true, expiresAt: true },
  });
  if (
    !grant
    || grant.status !== "active"
    || grant.revokedAt !== null
    || (grant.expiresAt !== null && grant.expiresAt <= input.now)
  ) throw policyDenied("AutomationGrant is no longer active");
}

async function failRuntimeSafetyWithPrisma(
  input: Parameters<LoopApprovalDependencies["failOrCancelWaitingAction"]>[0],
) {
  const approval = requireLoopIdentity(input.approval);
  return prisma.$transaction(async (tx) => {
    const decided = await tx.approvalRequest.updateMany({
      where: { id: approval.id, status: "pending" },
      data: {
        status: "rejected",
        decidedByUserId: input.actorUserId,
        decisionReason: input.reason,
        decidedAt: input.now,
      },
    });
    if (decided.count !== 1) throw versionConflict("Approval decision conflict");
    const node = await tx.loopNodeRun.updateMany({
      where: { id: approval.loopNodeRunId, loopRunId: approval.loopRunId, status: "waiting_approval" },
      data: { status: "failed", waitingReason: null, finishedAt: input.now, version: { increment: 1 } },
    });
    if (node.count !== 1) throw versionConflict("Waiting Loop node changed");
    const run = await tx.loopRun.updateMany({
      where: { id: approval.loopRunId, status: "waiting" },
      data: {
        status: "failed",
        statusReason: "runtime_safety_rejected",
        finishedAt: input.now,
        version: { increment: 1 },
        projectionVersion: { increment: 1 },
      },
    });
    if (run.count !== 1) throw versionConflict("Waiting LoopRun changed");
    return { status: "failed" };
  });
}

async function resumeRuntimeSafetyWithPrisma(
  input: Parameters<LoopApprovalDependencies["resumeWithOneTimeActionGrant"]>[0],
) {
  const approval = requireLoopIdentity(input.approval);
  return prisma.$transaction(async (tx) => {
    const decided = await tx.approvalRequest.updateMany({
      where: { id: approval.id, status: "pending" },
      data: {
        status: "approved",
        decidedByUserId: input.actorUserId,
        decisionReason: input.reason,
        decidedAt: input.now,
        grantPayload: {
          kind: "one_time_action",
          approvalId: approval.id,
          actionFingerprint: input.actionFingerprint,
          expiresAt: input.expiresAt.toISOString(),
          consumedAt: null,
        },
      },
    });
    if (decided.count !== 1) throw versionConflict("Approval decision conflict");
    const node = await tx.loopNodeRun.updateMany({
      where: { id: approval.loopNodeRunId, loopRunId: approval.loopRunId, status: "waiting_approval" },
      data: { status: "ready", waitingReason: null, readyAt: input.now, version: { increment: 1 } },
    });
    if (node.count !== 1) throw versionConflict("Waiting Loop node changed");
    const run = await tx.loopRun.updateMany({
      where: { id: approval.loopRunId, status: "waiting" },
      data: { status: "running", version: { increment: 1 }, projectionVersion: { increment: 1 } },
    });
    if (run.count !== 1) throw versionConflict("Waiting LoopRun changed");
    return { status: "ready" };
  });
}

function requireLoopIdentity(approval: LoopApprovalRecord): LoopApprovalRecord & {
  loopRunId: string;
  loopNodeRunId: string;
} {
  if (!approval.loopRunId || !approval.loopNodeRunId) throw validationError("Loop approval identity is incomplete");
  return approval as LoopApprovalRecord & { loopRunId: string; loopNodeRunId: string };
}

function decisionOutcome(decision: LoopApprovalDecision): "pass" | "rework" | "reject" {
  if (decision === "approved") return "pass";
  if (decision === "changes_requested") return "rework";
  return "reject";
}

function parseRoutes(value: unknown): HumanGateRoutes {
  const routes = requireRecord(value, "Human Gate routes are invalid");
  return {
    pass: edgeIds(routes.pass),
    rework: edgeIds(routes.rework),
    reject: edgeIds(routes.reject),
  };
}

function resolveHumanGateRoutes(approval: LoopApprovalRecord): HumanGateRoutes {
  const stored = parseRoutes(requireRecord(approval.requestPayload, "Human Gate request is invalid").routes);
  if (stored.pass.length || stored.rework.length || stored.reject.length) return stored;
  const context = approval.loopNodeRun;
  if (!context?.loopRun.loopVersion) throw validationError("Human Gate has no recoverable routes");
  return deriveHumanGateRoutes(
    loopAuthoringGraphSchema.parse(context.loopRun.loopVersion.graph),
    context.nodeKey,
  );
}

function edgeIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) throw validationError("Human Gate edge list is invalid");
  return value.map((edgeId) => requiredText(edgeId, "Human Gate edge", 96));
}

function decisionCommandId(approvalId: string, decision: string, edgeId: string): string {
  return `approval:${createHash("sha256").update(`${approvalId}\0${decision}\0${edgeId}`).digest("hex")}`;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validationError(message);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function boundedText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) throw validationError(`${name} is invalid`);
  return value;
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw validationError(`${name} is invalid`);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}

function versionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "version_conflict" });
}

function policyDenied(message: string): Error {
  return Object.assign(new Error(message), { code: "policy_denied" });
}
