import { createHash } from "node:crypto";
import type {
  AutomationPolicyDecision,
  LoopNodeDefinition,
} from "@humanthread/orchestration-core";

type HumanGateRoutes = {
  pass: string[];
  rework: string[];
  reject: string[];
};

type DispatchReadyNodeInput = {
  loopRunId: string;
  projectId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  node: LoopNodeDefinition;
  policyDecision: AutomationPolicyDecision;
  actionFingerprint?: string;
  humanGateRoutes?: HumanGateRoutes;
  now: Date;
};

type ApprovalCreateInput = {
  id: string;
  projectId: string;
  loopRunId: string;
  loopNodeRunId: string;
  type: "loop_human_gate" | "loop_runtime_safety";
  status: "pending";
  requestedByActor: string;
  requestPayload: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  expiresAt: Date | null;
};

type DispatchReadyNodeDependencies<Transaction = undefined> = {
  transaction?<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T>;
  createAssignment(input: DispatchReadyNodeInput): Promise<unknown>;
  createApproval(input: ApprovalCreateInput, transaction?: Transaction): Promise<unknown>;
  updateNode(input: {
    loopRunId: string;
    nodeRunId: string;
    nodeRunVersion: number;
    status: "waiting_approval";
    waitingReason: "human_gate" | "runtime_safety";
    occurredAt: Date;
  }, transaction?: Transaction): Promise<{ count: number }>;
  updateRun(input: {
    loopRunId: string;
    status: "waiting";
    waitingReason: "human_gate" | "runtime_safety";
    occurredAt: Date;
  }, transaction?: Transaction): Promise<{ count: number }>;
};

export async function dispatchReadyNode<Transaction = undefined>(
  input: DispatchReadyNodeInput,
  dependencies: DispatchReadyNodeDependencies<Transaction>,
): Promise<
  | { status: "assigned" }
  | { status: "waiting_approval"; approvalId: string; approvalType: ApprovalCreateInput["type"] }
> {
  validateInput(input);
  // Agent code runs inside an isolated Local Agent/Linux Worker workspace.
  // Runtime authorization is owned by the platform Loop graph (for example,
  // explicit Human Gate nodes), so execution workers must not wait for a
  // second automation-grant approval.
  const localAgentExecution = input.node.type === "agent_action"
    && (input.node.executionTarget === "local" || input.node.executionTarget === "either");
  if (localAgentExecution || (input.node.type !== "human_gate" && (
    input.policyDecision.outcome === "allow" || input.policyDecision.outcome === "auto_approve"
  ))) {
    await dependencies.createAssignment(input);
    return { status: "assigned" };
  }
  if (input.node.type !== "human_gate" && input.policyDecision.outcome === "deny") {
    throw policyDenied(input.policyDecision.reasonCode);
  }

  const approval = input.node.type === "human_gate"
    ? humanGateApproval(input)
    : runtimeSafetyApproval(input);
  const waitingReason = input.node.type === "human_gate" ? "human_gate" : "runtime_safety";
  const runTransaction = dependencies.transaction
    ?? (async <T>(callback: (transaction: Transaction) => Promise<T>) => callback(undefined as Transaction));
  await runTransaction(async (transaction) => {
    const updated = await callWithTransaction(dependencies.updateNode, {
      loopRunId: input.loopRunId,
      nodeRunId: input.nodeRunId,
      nodeRunVersion: input.nodeRunVersion,
      status: "waiting_approval",
      waitingReason,
      occurredAt: input.now,
    }, transaction);
    if (updated.count !== 1) throw staleLease();
    const run = await callWithTransaction(dependencies.updateRun, {
      loopRunId: input.loopRunId,
      status: "waiting",
      waitingReason,
      occurredAt: input.now,
    }, transaction);
    if (run.count !== 1) throw staleLease();
    await callWithTransaction(dependencies.createApproval, approval, transaction);
  });
  return { status: "waiting_approval", approvalId: approval.id, approvalType: approval.type };
}

function callWithTransaction<Input, Result, Transaction>(
  callback: (input: Input, transaction?: Transaction) => Promise<Result>,
  input: Input,
  transaction: Transaction,
): Promise<Result> {
  return transaction === undefined ? callback(input) : callback(input, transaction);
}

function humanGateApproval(input: DispatchReadyNodeInput): ApprovalCreateInput {
  const routes = parseRoutes(input.humanGateRoutes);
  return {
    id: approvalId(input.nodeRunId, "human_gate"),
    projectId: input.projectId,
    loopRunId: input.loopRunId,
    loopNodeRunId: input.nodeRunId,
    type: "loop_human_gate",
    status: "pending",
    requestedByActor: "system:loop-dispatcher",
    requestPayload: {
      nodeKey: input.node.key,
      prompt: input.node.type === "human_gate" ? input.node.prompt ?? "" : "",
      routes,
    },
    policySnapshot: {
      outcome: input.policyDecision.outcome,
      reasonCode: input.policyDecision.reasonCode,
      matchedGrantId: input.policyDecision.matchedGrantId,
    },
    expiresAt: null,
  };
}

function runtimeSafetyApproval(input: DispatchReadyNodeInput): ApprovalCreateInput {
  const actionFingerprint = requiredText(input.actionFingerprint, "Action fingerprint", 128);
  return {
    id: approvalId(input.nodeRunId, actionFingerprint),
    projectId: input.projectId,
    loopRunId: input.loopRunId,
    loopNodeRunId: input.nodeRunId,
    type: "loop_runtime_safety",
    status: "pending",
    requestedByActor: "system:loop-dispatcher",
    requestPayload: { nodeKey: input.node.key, actionFingerprint },
    policySnapshot: {
      outcome: input.policyDecision.outcome,
      reasonCode: input.policyDecision.reasonCode,
      matchedGrantId: input.policyDecision.matchedGrantId,
    },
    expiresAt: new Date(input.now.getTime() + 3_600_000),
  };
}

function parseRoutes(value: HumanGateRoutes | undefined): HumanGateRoutes {
  if (!value) throw validationError("Human Gate routes are required");
  return {
    pass: routeIds(value.pass, "pass"),
    rework: routeIds(value.rework, "rework"),
    reject: routeIds(value.reject, "reject"),
  };
}

function routeIds(value: unknown, outcome: string): string[] {
  if (!Array.isArray(value) || value.length > 32) throw validationError(`Human Gate ${outcome} routes are invalid`);
  return [...new Set(value.map((edgeId) => requiredText(edgeId, "Human Gate edge id", 96)))].sort();
}

function approvalId(nodeRunId: string, scope: string): string {
  const digest = createHash("sha256").update(`${nodeRunId}\0${scope}`).digest("hex");
  return `approval:${digest}`;
}

function validateInput(input: DispatchReadyNodeInput): void {
  requiredText(input.loopRunId, "LoopRun id", 96);
  requiredText(input.projectId, "Project id", 64);
  requiredText(input.nodeRunId, "NodeRun id", 96);
  if (!Number.isInteger(input.nodeRunVersion) || input.nodeRunVersion <= 0) {
    throw validationError("NodeRun version is invalid");
  }
  if (!Number.isFinite(input.now.getTime())) throw validationError("Dispatch time is invalid");
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function policyDenied(message: string): Error {
  return Object.assign(new Error(message), { code: "policy_denied" });
}

function staleLease(): Error {
  return Object.assign(new Error("Ready NodeRun changed before dispatch"), { code: "stale_lease" });
}
