import { createHash } from "node:crypto";
import {
  automationActionSchema,
  automationGrantSchema,
  evaluateAutomationGrant,
  type AutomationAction,
  type AutomationGrantSnapshot,
  type AutomationPolicyDecision,
} from "@humanthread/orchestration-core";

export type LoopAuthorizationAssignment = {
  projectId: string;
  spaceId: string;
  bindingId: string;
  loopRunId: string;
  loopRunVersion: number;
  nodeRunId: string;
  workerId: string | null;
  grantSnapshot: unknown;
};

export type LoopActionAuthorizationInput = {
  assignment: LoopAuthorizationAssignment;
  action: AutomationAction;
  actionKey?: string;
  fingerprintContext?: unknown;
  now: Date;
};

export type LoopAuthorizationAuditEvent = {
  loopRunId: string;
  loopRunVersion: number;
  nodeRunId: string;
  projectId: string;
  actionFingerprint: string;
  policyVersion: string;
  outcome: AutomationPolicyDecision["outcome"];
  reasonCode: string;
  matchedGrantId: string | null;
  occurredAt: Date;
};

export type LoopActionAuthorizationDependencies = {
  assertResourceAccess(input: {
    projectId: string;
    workerId: string | null;
  }): Promise<void>;
  assertLease(assignment: LoopAuthorizationAssignment): Promise<void>;
  evaluatePlatformPolicy(action: AutomationAction): Promise<{
    outcome: "allow" | "deny" | "require_approval";
    reasonCode: string;
  }>;
  consumeOneTimeActionGrant?(input: {
    assignment: LoopAuthorizationAssignment;
    action: AutomationAction;
    actionFingerprint: string;
    actionKey: string;
    now: Date;
  }): Promise<{ approvalId: string } | null>;
  appendAuditEvent(event: LoopAuthorizationAuditEvent): Promise<void>;
};

export type LoopActionAuthorizationResult = AutomationPolicyDecision & {
  actionFingerprint: string;
};

export function authorizeLoopAssignment(
  input: LoopActionAuthorizationInput,
  dependencies: LoopActionAuthorizationDependencies,
): Promise<LoopActionAuthorizationResult> {
  return authorizeLoopAction(input, dependencies);
}

export function authorizeLoopToolRequest(
  input: LoopActionAuthorizationInput,
  dependencies: LoopActionAuthorizationDependencies,
): Promise<LoopActionAuthorizationResult> {
  return authorizeLoopAction(input, dependencies);
}

export function authorizeLoopEffectRequest(
  input: LoopActionAuthorizationInput,
  dependencies: LoopActionAuthorizationDependencies,
): Promise<LoopActionAuthorizationResult> {
  return authorizeLoopAction(input, dependencies);
}

async function authorizeLoopAction(
  input: LoopActionAuthorizationInput,
  dependencies: LoopActionAuthorizationDependencies,
): Promise<LoopActionAuthorizationResult> {
  const action = automationActionSchema.parse(input.action);
  assertValidDate(input.now);
  assertAssignmentMatchesAction(input.assignment, action);
  await dependencies.assertResourceAccess({
    projectId: input.assignment.projectId,
    workerId: input.assignment.workerId,
  });
  await dependencies.assertLease(input.assignment);
  const policyDecision = await dependencies.evaluatePlatformPolicy(action);
  let decision = evaluateAutomationGrant({
    action,
    grants: readGrantSnapshot(input.assignment.grantSnapshot),
    now: input.now,
    policyDecision,
  });
  const actionFingerprint = fingerprintAction(action, input.fingerprintContext);
  if (
    decision.outcome === "require_approval"
    && input.actionKey
    && dependencies.consumeOneTimeActionGrant
  ) {
    const oneTimeGrant = await dependencies.consumeOneTimeActionGrant({
      assignment: input.assignment,
      action,
      actionFingerprint,
      actionKey: input.actionKey,
      now: input.now,
    });
    if (oneTimeGrant) {
      decision = {
        outcome: "auto_approve",
        reasonCode: "runtime_safety_approval_matched",
        matchedGrantId: oneTimeGrant.approvalId,
      };
    }
  }
  await dependencies.appendAuditEvent({
    loopRunId: input.assignment.loopRunId,
    loopRunVersion: input.assignment.loopRunVersion,
    nodeRunId: input.assignment.nodeRunId,
    projectId: input.assignment.projectId,
    actionFingerprint,
    policyVersion: action.policyVersion,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
    matchedGrantId: decision.matchedGrantId,
    occurredAt: input.now,
  });
  return { ...decision, actionFingerprint };
}

function readGrantSnapshot(value: unknown): AutomationGrantSnapshot[] {
  if (
    !isRecord(value)
    || !Array.isArray(value.automationGrantIds)
    || !Array.isArray(value.grants)
  ) return [];
  const allowedIds = new Set(
    value.automationGrantIds.filter((id): id is string => typeof id === "string"),
  );
  return value.grants
    .map((grant) => automationGrantSchema.parse(grant))
    .filter((grant) => allowedIds.has(grant.id));
}

function assertAssignmentMatchesAction(
  assignment: LoopAuthorizationAssignment,
  action: AutomationAction,
): void {
  if (
    assignment.projectId !== action.projectId
    || assignment.spaceId !== action.spaceId
    || assignment.bindingId !== action.bindingId
    || assignment.workerId !== action.workerId
  ) {
    throw validationError("Automation action does not match its Loop assignment");
  }
}

function fingerprintAction(action: AutomationAction, context: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson([action, context ?? null]))
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw validationError("Automation authorization time is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
