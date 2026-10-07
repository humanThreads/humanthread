import {
  automationActionSchema,
  automationGrantSchema,
  type AutomationAction,
  type AutomationGrantSnapshot,
} from "@humanthread/shared";

export type AutomationPolicyDecision = {
  outcome: "deny" | "require_approval" | "auto_approve" | "allow";
  reasonCode: string;
  matchedGrantId: string | null;
};

export type LiveAutomationGrantRecord = {
  id: string;
  spaceId: string;
  projectId: string;
  policyVersion: string;
  status: string;
  scope: unknown;
  expiresAt: string | null;
  revokedAt: string | null;
};

export function reconcileLiveAutomationGrant(input: {
  snapshot: unknown;
  live: LiveAutomationGrantRecord;
}): AutomationGrantSnapshot | null {
  const snapshot = automationGrantSchema.safeParse(input.snapshot);
  const storedScope = automationGrantSchema.safeParse(input.live.scope);
  if (!snapshot.success || !storedScope.success) return null;
  if (
    snapshot.data.status !== "active"
    || snapshot.data.revokedAt !== null
    || canonicalJson(snapshot.data) !== canonicalJson(storedScope.data)
    || snapshot.data.id !== input.live.id
    || snapshot.data.spaceId !== input.live.spaceId
    || snapshot.data.projectId !== input.live.projectId
    || snapshot.data.policyVersion !== input.live.policyVersion
    || snapshot.data.expiresAt !== input.live.expiresAt
    || (input.live.status !== "active" && input.live.status !== "revoked")
    || (input.live.status === "active" && input.live.revokedAt !== null)
    || (input.live.status === "revoked" && input.live.revokedAt === null)
    || (input.live.revokedAt !== null && !Number.isFinite(Date.parse(input.live.revokedAt)))
  ) return null;
  return automationGrantSchema.parse({
    ...snapshot.data,
    status: input.live.status,
    revokedAt: input.live.revokedAt,
  });
}

export function reconcileLiveAutomationGrants(input: {
  grantSnapshot: unknown;
  live: LiveAutomationGrantRecord[];
}): AutomationGrantSnapshot[] {
  if (
    !isRecord(input.grantSnapshot)
    || !Array.isArray(input.grantSnapshot.automationGrantIds)
    || !Array.isArray(input.grantSnapshot.grants)
  ) return [];
  const idCounts = countStrings(input.grantSnapshot.automationGrantIds);
  const parsed = input.grantSnapshot.grants.flatMap((grant) => {
    const result = automationGrantSchema.safeParse(grant);
    return result.success ? [result.data] : [];
  });
  const contentCounts = countStrings(parsed.map(({ id }) => id));
  const liveById = new Map(input.live.map((grant) => [grant.id, grant]));
  return parsed.flatMap((snapshot) => {
    if (idCounts.get(snapshot.id) !== 1 || contentCounts.get(snapshot.id) !== 1) return [];
    const live = liveById.get(snapshot.id);
    if (!live) return [];
    const reconciled = reconcileLiveAutomationGrant({ snapshot, live });
    return reconciled ? [reconciled] : [];
  });
}

export function evaluateAutomationGrant(input: {
  action: AutomationAction;
  grants: AutomationGrantSnapshot[];
  now: Date;
  policyDecision: {
    outcome: "allow" | "deny" | "require_approval";
    reasonCode: string;
  };
}): AutomationPolicyDecision {
  const action = automationActionSchema.parse(input.action);
  const grants = input.grants.map((grant) => automationGrantSchema.parse(grant));
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw Object.assign(new Error("Automation policy time is invalid"), { code: "validation_failed" });
  }
  if (input.policyDecision.outcome === "deny") {
    return { outcome: "deny", reasonCode: input.policyDecision.reasonCode, matchedGrantId: null };
  }
  if (input.policyDecision.outcome === "require_approval") {
    return {
      outcome: "require_approval",
      reasonCode: input.policyDecision.reasonCode,
      matchedGrantId: null,
    };
  }
  if (isWorkspaceEscape(action)) {
    return { outcome: "deny", reasonCode: "workspace_scope_denied", matchedGrantId: null };
  }

  const grant = grants.find((candidate) => (
    isActive(candidate, input.now) && coversEveryDimension(candidate, action)
  ));
  if (grant) {
    return {
      outcome: "auto_approve",
      reasonCode: "automation_grant_matched",
      matchedGrantId: grant.id,
    };
  }
  if (action.requiresUserGrant) {
    return {
      outcome: "require_approval",
      reasonCode: "automation_grant_scope_miss",
      matchedGrantId: null,
    };
  }
  return {
    outcome: "allow",
    reasonCode: "low_risk_platform_action",
    matchedGrantId: null,
  };
}

function isActive(grant: AutomationGrantSnapshot, now: Date): boolean {
  return grant.status === "active"
    && grant.revokedAt === null
    && Date.parse(grant.confirmedAt) <= now.getTime()
    && (grant.expiresAt === null || Date.parse(grant.expiresAt) > now.getTime());
}

function coversEveryDimension(
  grant: AutomationGrantSnapshot,
  action: AutomationAction,
): boolean {
  if (
    grant.spaceId !== action.spaceId
    || grant.projectId !== action.projectId
    || !grant.bindingIds.includes(action.bindingId)
    || !grant.nodeKeys.includes(action.nodeKey)
    || !grant.executionPlanes.includes(action.executionPlane)
    || grant.policyVersion !== action.policyVersion
    || !coversOptional(grant.deviceIds, action.deviceId)
    || !coversOptional(grant.workerIds, action.workerId)
    || !coversOptional(grant.agentProfileIds, action.agentProfileId)
    || !coversOptional(grant.providers, action.provider)
    || !coversOptional(grant.tools, action.tool)
    || !coversOptional(grant.commandCategories, action.commandCategory)
    || !coversOptional(grant.operationTypes, action.operationType)
    || !coversOptional(grant.networkTargets, action.networkTarget)
    || !coversOptional(grant.recipients, action.recipient)
    || !coversOptional(grant.credentialRefs, action.credentialRef)
    || (action.production && !grant.allowProduction)
    || action.usage.concurrency > grant.limits.maxConcurrency
    || action.usage.durationMs > grant.limits.maxDurationMs
    || action.usage.tokens > grant.limits.maxTokens
    || action.usage.costUsd > grant.limits.maxCostUsd
    || action.usage.toolCalls > grant.limits.maxToolCalls
  ) return false;

  if (action.workspaceAccess === "none") return true;
  if (
    grant.permission === "none"
    || (action.workspaceAccess === "write" && grant.permission !== "workspace_full")
    || action.workspaceBindingId === null
    || !grant.workspaceBindingIds.includes(action.workspaceBindingId)
    || action.relativePath === null
  ) return false;
  return grant.allowedRelativePathPrefixes.some((prefix) => (
    relativePathContains(prefix, action.relativePath as string)
  ));
}

function coversOptional(allowed: string[], requested: string | null): boolean {
  return requested === null || allowed.includes(requested);
}

function isWorkspaceEscape(action: AutomationAction): boolean {
  if (action.workspaceAccess === "none") return false;
  return action.workspaceContained !== true
    || action.workspaceBindingId === null
    || action.relativePath === null;
}

function relativePathContains(prefix: string, target: string): boolean {
  return prefix === "." || target === prefix || target.startsWith(`${prefix}/`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function countStrings(values: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
