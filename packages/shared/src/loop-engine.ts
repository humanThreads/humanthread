import { z } from "zod";
import { workflowInteractionPolicySchema } from "./workflow-interactions";

const nodeKeySchema = z.string().min(1).max(96);
const nodeLabelSchema = z.string().min(1).max(191);
const nodeResponsibilitySchema = z.string().trim().max(4_000);
const capabilitySchema = z.string().min(1).max(96);
const schemaDefinition = z.unknown();
const runtimeIdSchema = z.string().min(1).max(96);
const runtimeWideIdSchema = z.string().min(1).max(128);
const runtimePathSchema = z.string().min(1).max(1_024).refine((value) => !value.includes("\0"), {
  message: "Path must not contain a null byte",
});
const runtimeRelativePathSchema = runtimePathSchema.refine(
  (value) => (
    !value.startsWith("/")
    && !value.includes("\\")
    && !/^[a-z]:/iu.test(value)
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  ),
  { message: "Path must be relative and use forward slashes" },
);
const runtimeEvidenceReferenceSchema = z.string().max(64).regex(
  /^(?:logs|artifacts|commands|environment|policies)\/[0-9a-f]{32}$/u,
  "Evidence references must be platform-issued opaque locators",
);
const runtimeEventTypeSchema = z.string().min(1).max(96).regex(/^[a-z][a-z0-9._-]*$/u);
const runtimeArtifactRefsSchema = z.array(runtimePathSchema).max(100);
const positiveRuntimeIntegerSchema = z.number().int().positive();
const automationIdSchema = z.string().trim().min(1).max(128);
const automationScopeValuesSchema = z.array(automationIdSchema).max(128)
  .transform((values) => [...new Set(values)].sort());
const pathFingerprintSchema = z.string().regex(/^hmac-sha256:[A-Za-z0-9_-]{6,128}$/u);
const projectRelativePathSchema = z.string().min(1).max(512).refine(
  (value) => value === "." || (
    !value.startsWith("/")
    && !value.includes("\\")
    && !/^[a-z]:/iu.test(value)
    && !/[\0-\x1f\x7f]/u.test(value)
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  ),
  { message: "Path must be project-relative and use forward slashes" },
);
const projectRelativePathValuesSchema = z.array(projectRelativePathSchema).max(128)
  .transform((values) => [...new Set(values)].sort());

export const executionTargetSchema = z.enum(["platform", "local", "either"]);
export const reasoningEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";

/**
 * Events that represent durable Loop state or user-actionable evidence.
 * Provider output chunks and per-tool lifecycle are intentionally excluded:
 * they are useful for a live stream but produce unbounded persistence volume.
 */
const DURABLE_LOOP_AGENT_EVENT_TYPES = new Set([
  "run.started",
  "approval.requested",
  "checkpoint.created",
  "artifact.produced",
  "run.failed",
  "run.completed",
  "run.cancelled",
  "worker.assignment.claimed",
  "worker.stage.started",
  "worker.app_server.started",
  "worker.stage.completed",
  "worker.stage.failed",
  "worker.cleanup.started",
  "worker.cleanup.completed",
  "loop.node.execution_phase_changed",
  "loop.checklist.created",
  "loop.checklist.updated",
]);

export function isDurableLoopAgentEventType(eventType: string): boolean {
  return DURABLE_LOOP_AGENT_EVENT_TYPES.has(eventType);
}

export function isHighFrequencyLoopAgentEventType(eventType: string): boolean {
  return eventType === "worker.app_server.notification"
    || eventType === "agent.message.completed"
    || eventType === "tool.requested"
    || eventType === "tool.started"
    || eventType === "tool.completed";
}

export const offlinePolicySchema = z.enum(["local_capable", "online_required"]);
export const loopDefinitionScopeSchema = z.enum(["task", "project"]);
export const loopDefinitionOriginSchema = z.enum(["space", "platform"]);
export const loopOutcomeSchema = z.enum([
  "success",
  "failure",
  "pass",
  "rework",
  "reject",
  "timeout",
]);

export const loopRetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(20),
  initialDelayMs: z.number().int().min(0).max(300_000).optional(),
  maxDelayMs: z.number().int().min(0).max(3_600_000).optional(),
}).strict().superRefine((policy, context) => {
  if (
    policy.initialDelayMs !== undefined
    && policy.maxDelayMs !== undefined
    && policy.initialDelayMs > policy.maxDelayMs
  ) {
    context.addIssue({
      code: "custom",
      message: "initialDelayMs must not exceed maxDelayMs",
      path: ["initialDelayMs"],
    });
  }
});

export const failureCategorySchema = z.enum([
  "transient_technical",
  "dependency_unavailable",
  "requirement_unclear",
  "permission_or_policy",
  "deterministic_execution",
  "business_validation",
  "cancelled",
  "unknown",
]);

const failureEvidencePrefix = {
  log: "logs",
  artifact: "artifacts",
  command: "commands",
  environment: "environment",
  policy: "policies",
} as const;

const loopFailureEvidenceSchema = z.object({
  kind: z.enum(["log", "artifact", "command", "environment", "policy"]),
  reference: runtimeEvidenceReferenceSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict().superRefine((evidence, context) => {
  if (!evidence.reference.startsWith(`${failureEvidencePrefix[evidence.kind]}/`)) {
    context.addIssue({
      code: "custom",
      message: "Evidence reference prefix must match its kind",
      path: ["reference"],
    });
  }
});

export const loopFailureEnvelopeSchema = z.object({
  status: z.enum(["FAILED", "NEEDS_CLARIFICATION", "TIMEOUT", "OUTPUT_PARSE_FAILED"]),
  code: z.string().trim().min(1).max(96),
  categoryHint: failureCategorySchema.optional(),
  summary: z.string().trim().min(1).max(4_000),
  evidence: z.array(loopFailureEvidenceSchema).max(100),
  retryHint: z.object({
    recommended: z.boolean(),
    reason: z.string().trim().min(1).max(4_000),
    retryAfterMs: z.number().int().min(0).max(3_600_000).optional(),
  }).strict().optional(),
  checkpoint: z.unknown().optional(),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict();

export const gateDecisionSchema = z.object({
  outcome: z.enum(["pass", "rework", "reject"]),
  reasonCode: z.string().min(1).max(96),
  message: z.string().max(4_000),
  evidenceRefs: z.array(z.string().min(1).max(191)),
  selectedEdgeId: z.string().min(1).max(96),
}).strict();

export const loopEdgeDefinitionSchema = z.object({
  id: z.string().min(1).max(96),
  source: z.string().min(1).max(96),
  target: z.string().min(1).max(96),
  kind: z.enum(["normal", "feedback", "compensation"]),
  outcome: loopOutcomeSchema,
  maxTraversals: z.number().int().positive().max(20).optional(),
  condition: z.unknown().optional(),
}).strict().superRefine((edge, context) => {
  if (edge.kind === "feedback" && edge.maxTraversals === undefined) {
    context.addIssue({ code: "custom", message: "Feedback edge requires maxTraversals", path: ["maxTraversals"] });
  }
});

const platformNodeShape = {
  key: nodeKeySchema,
  nodeId: nodeKeySchema.optional(),
  label: nodeLabelSchema,
  offlinePolicy: offlinePolicySchema.optional().default("online_required"),
  requiredCapabilities: z.array(capabilitySchema).optional(),
};

const commonNodeShape = {
  ...platformNodeShape,
  inputSchema: schemaDefinition.optional(),
  outputSchema: schemaDefinition.optional(),
  riskRequirements: z.unknown().optional(),
  retryPolicy: loopRetryPolicySchema.optional(),
  timeoutPolicy: z.unknown().optional(),
};

export const loopNodeDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ ...commonNodeShape, type: z.literal("start") }).strict(),
  z.object({ ...commonNodeShape, type: z.literal("end") }).strict(),
  z.object({
    ...commonNodeShape,
    type: z.literal("agent_action"),
    executionTarget: z.enum(["local", "either"]),
    promptTemplate: z.string().min(1).max(20_000),
    reasoningEffort: reasoningEffortSchema.optional(),
    interactionPolicy: workflowInteractionPolicySchema.optional(),
  }).strict(),
  z.object({
    ...commonNodeShape,
    type: z.literal("platform_action"),
    executionTarget: z.enum(["platform", "either"]),
    action: z.string().min(1).max(191).optional(),
    config: z.unknown().optional(),
  }).strict(),
  z.object({
    ...commonNodeShape,
    type: z.literal("condition"),
    executionTarget: z.literal("platform"),
    expression: z.unknown().optional(),
  }).strict(),
  z.object({
    ...commonNodeShape,
    type: z.literal("policy_gate"),
    executionTarget: z.literal("platform"),
    policy: z.unknown().optional(),
  }).strict(),
  z.object({
    ...commonNodeShape,
    type: z.literal("human_gate"),
    executionTarget: z.literal("platform"),
    prompt: z.string().min(1).max(4_000).optional(),
    interactionPolicy: workflowInteractionPolicySchema.optional(),
  }).strict(),
  z.object({
    ...commonNodeShape,
    type: z.literal("wait_callback"),
    executionTarget: z.literal("platform"),
    callback: z.unknown().optional(),
  }).strict(),
  z.object({
    ...platformNodeShape,
    type: z.literal("subloop_call"),
    executionTarget: z.literal("platform"),
    inputSchema: z.never().optional(),
    outputSchema: z.never().optional(),
    targetLoopDefinitionId: runtimeIdSchema,
    targetLoopVersionId: runtimeIdSchema,
    inputMapping: z.record(z.string(), z.unknown()),
    terminalOutcomeMapping: z.record(z.string(), loopOutcomeSchema),
  }).strict(),
]);

export const loopGraphSchema = z.object({
  schemaVersion: z.literal(1),
  inputSchema: schemaDefinition,
  outputSchema: schemaDefinition,
  retryPolicy: loopRetryPolicySchema.optional(),
  limits: z.object({
    maxStages: z.number().int().positive().max(64),
    maxRepeatCount: z.number().int().positive().max(20),
  }).strict(),
  nodes: z.array(loopNodeDefinitionSchema).min(1).max(64),
  edges: z.array(loopEdgeDefinitionSchema),
}).strict();

const authoringRoutingMetadataSchema = z.object({
  responsibility: nodeResponsibilitySchema,
}).strict();

export const loopGraphV2Schema = z.object({
  schemaVersion: z.literal(2),
  inputSchema: schemaDefinition,
  outputSchema: schemaDefinition,
  retryPolicy: loopRetryPolicySchema.optional(),
  limits: z.object({
    maxStages: z.number().int().positive().max(64),
    maxRepeatCount: z.number().int().positive().max(20),
  }).strict(),
  nodes: z.array(loopNodeDefinitionSchema).min(1).max(64),
  edges: z.array(loopEdgeDefinitionSchema),
  routingMetadata: z.record(nodeKeySchema, authoringRoutingMetadataSchema),
}).strict();

export const loopAuthoringGraphSchema = z.union([loopGraphSchema, loopGraphV2Schema]);

export const platformLoopNodeDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ ...platformNodeShape, type: z.literal("start") }).strict(),
  z.object({ ...platformNodeShape, type: z.literal("end") }).strict(),
  z.object({
    ...platformNodeShape,
    type: z.literal("agent_action"),
    executionTarget: z.enum(["local", "either"]),
    reasoningEffort: reasoningEffortSchema.optional(),
  }).strict(),
  z.object({
    ...platformNodeShape,
    type: z.literal("platform_action"),
    executionTarget: z.enum(["platform", "either"]),
  }).strict(),
  z.object({
    ...platformNodeShape,
    type: z.literal("condition"),
    executionTarget: z.literal("platform"),
  }).strict(),
  z.object({
    ...platformNodeShape,
    type: z.literal("policy_gate"),
    executionTarget: z.literal("platform"),
  }).strict(),
  z.object({
    ...platformNodeShape,
    type: z.literal("human_gate"),
    executionTarget: z.literal("platform"),
  }).strict(),
  z.object({
    ...platformNodeShape,
    type: z.literal("wait_callback"),
    executionTarget: z.literal("platform"),
  }).strict(),
  z.object({
    ...platformNodeShape,
    type: z.literal("subloop_call"),
    executionTarget: z.literal("platform"),
    targetLoopDefinitionId: runtimeIdSchema,
    targetLoopVersionId: runtimeIdSchema,
    inputMapping: z.record(z.string(), z.unknown()),
    terminalOutcomeMapping: z.record(z.string(), loopOutcomeSchema),
  }).strict(),
]);

export const platformLoopEdgeDefinitionSchema = z.object({
  id: runtimeIdSchema,
  source: nodeKeySchema,
  target: nodeKeySchema,
  kind: z.enum(["normal", "feedback", "compensation"]),
  outcome: loopOutcomeSchema,
  maxTraversals: z.number().int().positive().max(20).optional(),
}).strict().superRefine((edge, context) => {
  if (edge.kind === "feedback" && edge.maxTraversals === undefined) {
    context.addIssue({ code: "custom", message: "Feedback edge requires maxTraversals", path: ["maxTraversals"] });
  }
});

export const platformLoopGraphSchema = z.object({
  schemaVersion: z.literal(1),
  limits: z.object({
    maxStages: z.number().int().positive().max(64),
    maxRepeatCount: z.number().int().positive().max(20),
  }).strict(),
  nodes: z.array(platformLoopNodeDefinitionSchema).min(1).max(64),
  edges: z.array(platformLoopEdgeDefinitionSchema),
}).strict();

export const nodeRoutingMetadataSchema = z.object({
  responsibility: nodeResponsibilitySchema.pipe(z.string().min(1)),
  allowedRouteTargets: z.array(nodeKeySchema).max(64)
    .transform((values) => [...new Set(values)]),
}).strict();

const platformRoutingNodeShape = {
  ...platformNodeShape,
  responsibility: nodeRoutingMetadataSchema.shape.responsibility,
  allowedRouteTargets: nodeRoutingMetadataSchema.shape.allowedRouteTargets,
};

export const platformLoopNodeDefinitionV2Schema = z.discriminatedUnion("type", [
  z.object({ ...platformNodeShape, type: z.literal("start") }).strict(),
  z.object({ ...platformNodeShape, type: z.literal("end") }).strict(),
  z.object({
    ...platformRoutingNodeShape,
    type: z.literal("agent_action"),
    executionTarget: z.enum(["local", "either"]),
    reasoningEffort: reasoningEffortSchema.optional(),
  }).strict(),
  z.object({ ...platformRoutingNodeShape, type: z.literal("platform_action"), executionTarget: z.enum(["platform", "either"]) }).strict(),
  z.object({ ...platformRoutingNodeShape, type: z.literal("condition"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...platformRoutingNodeShape, type: z.literal("policy_gate"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...platformRoutingNodeShape, type: z.literal("human_gate"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...platformRoutingNodeShape, type: z.literal("wait_callback"), executionTarget: z.literal("platform") }).strict(),
  z.object({
    ...platformRoutingNodeShape,
    type: z.literal("subloop_call"),
    executionTarget: z.literal("platform"),
    targetLoopDefinitionId: runtimeIdSchema,
    targetLoopVersionId: runtimeIdSchema,
    inputMapping: z.record(z.string(), z.unknown()),
    terminalOutcomeMapping: z.record(z.string(), loopOutcomeSchema),
  }).strict(),
]);

export const platformLoopGraphV2Schema = z.object({
  schemaVersion: z.literal(2),
  limits: z.object({
    maxStages: z.number().int().positive().max(64),
    maxRepeatCount: z.number().int().positive().max(20),
  }).strict(),
  nodes: z.array(platformLoopNodeDefinitionV2Schema).min(1).max(64),
  edges: z.array(platformLoopEdgeDefinitionSchema).max(256),
}).strict().superRefine((graph, context) => {
  const nodesByStableId = new Map(graph.nodes.map((node) => [stableNodeId(node), node]));
  for (const [index, node] of graph.nodes.entries()) {
    if (node.type === "start" || node.type === "end") continue;
    for (const [targetIndex, targetId] of node.allowedRouteTargets.entries()) {
      const target = nodesByStableId.get(targetId);
      if (!target) {
        context.addIssue({
          code: "custom",
          message: `Allowed route target is outside the graph: ${targetId}`,
          path: ["nodes", index, "allowedRouteTargets", targetIndex],
        });
        continue;
      }
      if (!graph.edges.some((edge) => edge.source === node.key && edge.target === target.key)) {
        context.addIssue({
          code: "custom",
          message: `Allowed route target has no graph edge: ${targetId}`,
          path: ["nodes", index, "allowedRouteTargets", targetIndex],
        });
      }
    }
  }
});

export type ExecutionTarget = z.infer<typeof executionTargetSchema>;
export type OfflinePolicy = z.infer<typeof offlinePolicySchema>;
export type LoopRetryPolicy = z.infer<typeof loopRetryPolicySchema>;
export type FailureCategory = z.infer<typeof failureCategorySchema>;
export type LoopFailureEnvelope = z.infer<typeof loopFailureEnvelopeSchema>;
export type GateDecision = z.infer<typeof gateDecisionSchema>;
export type LoopEdgeDefinition = z.infer<typeof loopEdgeDefinitionSchema>;
export type LoopNodeDefinition = z.input<typeof loopNodeDefinitionSchema>;
export type LoopGraph = z.input<typeof loopGraphSchema>;
export type LoopGraphV2 = z.input<typeof loopGraphV2Schema>;
export type LoopAuthoringGraph = z.input<typeof loopAuthoringGraphSchema>;
export type PlatformLoopNodeDefinition = z.infer<typeof platformLoopNodeDefinitionSchema>;
export type PlatformLoopEdgeDefinition = z.infer<typeof platformLoopEdgeDefinitionSchema>;
export type PlatformLoopGraph = z.infer<typeof platformLoopGraphSchema>;
export type PlatformLoopNodeDefinitionV2 = z.infer<typeof platformLoopNodeDefinitionV2Schema>;
export type PlatformLoopGraphV2 = z.infer<typeof platformLoopGraphV2Schema>;

/**
 * Convert any published authoring graph into the stable execution shape.
 * Authoring-only metadata must never become a runtime compatibility gate.
 */
export function parsePublishedLoopGraph(value: unknown): z.output<typeof loopGraphSchema> {
  const legacy = loopGraphSchema.safeParse(value);
  if (legacy.success) return legacy.data;

  const current = loopGraphV2Schema.safeParse(value);
  if (!current.success) {
    throw new Error("Published Loop graph is invalid");
  }

  const { routingMetadata: _routingMetadata, ...executionGraph } = current.data;
  return { ...executionGraph, schemaVersion: 1 };
}

export function stableNodeId(node: { key: string; nodeId?: string | undefined }): string {
  return node.nodeId ?? node.key;
}

const graphDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

// The Router is built into HumanThread, rather than configured per project.
// Its digest is included in V2 assignments so an outdated local Agent fails
// closed instead of submitting a decision under a different contract.
export const builtInDecisionRouterContract = {
  version: 1 as const,
  digest: "sha256:42fdeee7caf3884e105a193f2356af051cddde8992c8640e7af6912ed5a2e241" as const,
};

export const runGraphSnapshotSchema = z.object({
  snapshotId: runtimeWideIdSchema,
  graphDigest: graphDigestSchema,
  rootLoopVersionId: runtimeIdSchema,
  loopVersions: z.array(z.object({
    loopDefinitionId: runtimeIdSchema,
    loopVersionId: runtimeIdSchema,
    scope: loopDefinitionScopeSchema,
    graph: platformLoopGraphSchema,
  }).strict()).min(1).max(64),
  reachableNodeIds: z.array(runtimeIdSchema).max(4_096),
}).strict();

export const runGraphSnapshotV2Schema = z.object({
  schemaVersion: z.literal(2),
  snapshotId: runtimeWideIdSchema,
  graphDigest: graphDigestSchema,
  rootLoopVersionId: runtimeIdSchema,
  loopVersions: z.array(z.object({
    loopDefinitionId: runtimeIdSchema,
    loopVersionId: runtimeIdSchema,
    scope: loopDefinitionScopeSchema,
    graph: platformLoopGraphV2Schema,
  }).strict()).min(1).max(64),
  reachableNodeIds: z.array(runtimeIdSchema).max(4_096),
}).strict();

export const decisionRunGraphSnapshotSchema = z.union([
  runGraphSnapshotV2Schema,
  runGraphSnapshotSchema,
]);

export const localRouteDecisionSchema = z.object({
  decisionId: runtimeWideIdSchema,
  fromNodeId: nodeKeySchema,
  nextNodeId: nodeKeySchema,
  reasonCode: z.string().trim().min(1).max(96),
  summary: z.string().trim().min(1).max(4_000),
  evidence: runtimeArtifactRefsSchema,
  confidence: z.number().min(0).max(1),
  snapshotDigest: graphDigestSchema,
  routerContractVersion: z.literal(1),
  routerContractDigest: graphDigestSchema,
}).strict();

export const offlineContinuationGrantSchema = z.object({
  token: z.string().min(32).max(256),
  validUntil: z.iso.datetime({ offset: true }),
  workerId: runtimeIdSchema,
  agentProfileId: runtimeIdSchema,
  workspaceBindingId: runtimeIdSchema,
  snapshotDigest: graphDigestSchema,
  allowedNodeIds: z.array(nodeKeySchema).max(64),
}).strict();

export type RunGraphSnapshotV2 = z.infer<typeof runGraphSnapshotV2Schema>;
export type LocalRouteDecision = z.infer<typeof localRouteDecisionSchema>;
export type OfflineContinuationGrant = z.infer<typeof offlineContinuationGrantSchema>;

function routeValidationError(message: string): Error {
  return Object.assign(new Error(message), { code: "route_decision_invalid" });
}

export function validateLocalRouteDecision(input: {
  decision: unknown;
  fromNodeId: string;
  allowedRouteTargets: readonly string[];
  snapshotDigest: string;
  routerContractVersion: number;
  routerContractDigest: string;
}): LocalRouteDecision {
  const decision = localRouteDecisionSchema.parse(input.decision);
  if (decision.fromNodeId !== input.fromNodeId) {
    throw routeValidationError("Route decision source node does not match the current node");
  }
  if (!input.allowedRouteTargets.includes(decision.nextNodeId)) {
    throw routeValidationError("Route decision target is outside the allowed route targets");
  }
  if (decision.snapshotDigest !== input.snapshotDigest) {
    throw routeValidationError("Route decision snapshot digest does not match the current run");
  }
  if (
    decision.routerContractVersion !== input.routerContractVersion
    || decision.routerContractDigest !== input.routerContractDigest
  ) {
    throw routeValidationError("Route decision Router contract does not match the assignment");
  }
  return decision;
}

export const routeDecisionSchema = z.object({
  runId: runtimeIdSchema,
  nodeRunId: runtimeIdSchema,
  attemptId: runtimeWideIdSchema,
  assignmentEpoch: positiveRuntimeIntegerSchema,
  graphDigest: graphDigestSchema,
  outcome: loopOutcomeSchema,
  edgeId: runtimeIdSchema,
  targetNodeId: runtimeIdSchema,
}).strict();

export type RunGraphSnapshot = z.infer<typeof runGraphSnapshotSchema>;
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export const loopNodeRunStatusSchema = z.enum([
  "pending",
  "ready",
  "leased",
  "running",
  "waiting_configuration",
  "waiting_approval",
  "waiting_input",
  "retry_scheduled",
  "reconciliation_required",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);

export const loopExecutionPhaseStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export const loopExecutionPhaseSchema = z.object({
  phase: z.string().trim().min(1).max(64),
  status: loopExecutionPhaseStatusSchema,
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  code: z.string().trim().min(1).max(64).nullable(),
  summary: z.string().trim().min(1).max(512).nullable(),
}).strict();

export const loopPlatformWaitingReasonSchema = z.enum(["timer", "callback", "child_loop"]);
export const loopPlatformWaitSchema = z.object({
  waitingReason: loopPlatformWaitingReasonSchema.optional(),
}).strict();
export type LoopPlatformWaitingReason = z.infer<typeof loopPlatformWaitingReasonSchema>;

export const loopConfigurationWaitingReasonSchema = z.enum([
  "workspace_missing",
  "workspace_stale",
  "runtime_missing",
  "runtime_unauthenticated",
  "provider_not_allowed",
  "profile_not_allowed",
  "worker_offline",
  "repository_credential_unverified",
  "grant_missing",
]);
export type LoopConfigurationWaitingReason = z.infer<
  typeof loopConfigurationWaitingReasonSchema
>;

export const LOOP_AUTOMATION_POLICY_VERSION = "policy_v1";

export const localConfigurationRejectionCodeSchema = z.enum([
  "workspace_configuration_stale",
  "runtime_configuration_stale",
]);

export const automationGrantSchema = z.object({
  id: runtimeIdSchema,
  spaceId: runtimeIdSchema,
  projectId: runtimeIdSchema,
  bindingIds: automationScopeValuesSchema,
  nodeKeys: z.array(nodeKeySchema).max(64).transform((values) => [...new Set(values)].sort()),
  executionPlanes: z.array(z.enum(["platform", "local"])).min(1).max(2)
    .transform((values) => [...new Set(values)].sort()),
  deviceIds: automationScopeValuesSchema,
  workerIds: automationScopeValuesSchema,
  agentProfileIds: automationScopeValuesSchema,
  providers: automationScopeValuesSchema,
  permission: z.enum(["none", "read_only", "workspace_full"]),
  workspaceBindingIds: automationScopeValuesSchema,
  allowedRelativePathPrefixes: projectRelativePathValuesSchema,
  tools: automationScopeValuesSchema,
  commandCategories: automationScopeValuesSchema,
  operationTypes: automationScopeValuesSchema,
  networkTargets: automationScopeValuesSchema,
  recipients: automationScopeValuesSchema,
  credentialRefs: automationScopeValuesSchema,
  allowProduction: z.boolean(),
  limits: z.object({
    maxConcurrency: z.number().int().positive().max(128),
    maxDurationMs: z.number().int().positive().max(7 * 24 * 60 * 60 * 1_000),
    maxTokens: z.number().int().nonnegative().max(100_000_000),
    maxCostUsd: z.number().nonnegative().finite().max(1_000_000),
    maxToolCalls: z.number().int().nonnegative().max(1_000_000),
  }).strict(),
  policyVersion: automationIdSchema,
  status: z.enum(["active", "revoked"]),
  confirmedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict().superRefine((grant, context) => {
  const hasWorkspace = grant.workspaceBindingIds.length > 0
    && grant.allowedRelativePathPrefixes.length > 0;
  const declaresWorkspace = grant.workspaceBindingIds.length > 0
    || grant.allowedRelativePathPrefixes.length > 0;
  if (grant.permission === "none" && declaresWorkspace) {
    context.addIssue({ code: "custom", message: "Workspace-free grants cannot declare paths", path: ["permission"] });
  }
  if (grant.permission !== "none" && !hasWorkspace) {
    context.addIssue({ code: "custom", message: "Workspace grants require a binding and relative path allowlist", path: ["workspaceBindingIds"] });
  }
  if (grant.status === "revoked" && grant.revokedAt === null) {
    context.addIssue({ code: "custom", message: "A revoked grant requires revokedAt", path: ["revokedAt"] });
  }
  if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= Date.parse(grant.confirmedAt)) {
    context.addIssue({ code: "custom", message: "Grant expiry must follow confirmation", path: ["expiresAt"] });
  }
});

export const automationActionSchema = z.object({
  requiresUserGrant: z.boolean(),
  spaceId: runtimeIdSchema,
  projectId: runtimeIdSchema,
  bindingId: automationIdSchema,
  nodeKey: nodeKeySchema,
  executionPlane: z.enum(["platform", "local"]),
  deviceId: automationIdSchema.nullable(),
  workerId: automationIdSchema.nullable(),
  agentProfileId: automationIdSchema.nullable(),
  provider: automationIdSchema.nullable(),
  workspaceAccess: z.enum(["none", "read", "write"]),
  workspaceBindingId: automationIdSchema.nullable(),
  relativePath: projectRelativePathSchema.nullable(),
  workspaceContained: z.boolean().nullable(),
  tool: automationIdSchema.nullable(),
  commandCategory: automationIdSchema.nullable(),
  operationType: automationIdSchema.nullable(),
  networkTarget: automationIdSchema.nullable(),
  recipient: z.string().trim().min(1).max(320).nullable(),
  credentialRef: automationIdSchema.nullable(),
  production: z.boolean(),
  usage: z.object({
    concurrency: z.number().int().positive().max(64),
    durationMs: z.number().int().nonnegative().max(7 * 24 * 60 * 60 * 1_000),
    tokens: z.number().int().nonnegative().max(100_000_000),
    costUsd: z.number().nonnegative().finite().max(1_000_000),
    toolCalls: z.number().int().nonnegative().max(1_000_000),
  }).strict(),
  policyVersion: automationIdSchema,
}).strict().superRefine((action, context) => {
  const workspaceFields = [action.workspaceBindingId, action.relativePath, action.workspaceContained];
  if (action.workspaceAccess === "none" && workspaceFields.some((value) => value !== null)) {
    context.addIssue({ code: "custom", message: "Workspace-free actions cannot declare Workspace fields", path: ["workspaceAccess"] });
  }
  if (action.workspaceAccess !== "none" && workspaceFields.some((value) => value === null)) {
    context.addIssue({ code: "custom", message: "Workspace actions require binding and containment fields", path: ["workspaceBindingId"] });
  }
});

export type AutomationGrantSnapshot = z.infer<typeof automationGrantSchema>;
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const loopAssignmentSchema = z.object({
  id: runtimeWideIdSchema,
  agentRunId: runtimeIdSchema,
  loopRunId: runtimeIdSchema,
  loopNodeRunId: runtimeIdSchema,
  loopNodeAttemptId: runtimeWideIdSchema,
  attemptNo: positiveRuntimeIntegerSchema,
  leaseGeneration: positiveRuntimeIntegerSchema,
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  acceptedThroughSequence: z.number().int().nonnegative(),
  stageRef: z.object({
    loopDefinitionId: runtimeIdSchema,
    loopVersionId: runtimeIdSchema,
    nodeId: runtimeIdSchema,
    subloopId: runtimeIdSchema,
  }).strict().optional(),
  node: loopNodeDefinitionSchema,
  graph: loopGraphSchema,
  inputSnapshot: z.unknown(),
  policySnapshot: z.unknown(),
  grantSnapshot: z.unknown(),
  runtime: z.object({
    agentProfileId: runtimeIdSchema,
    provider: z.enum(["codex", "claude"]),
    runtimeProfileId: runtimeIdSchema,
    configurationVersion: positiveRuntimeIntegerSchema,
  }).strict(),
  workspace: z.object({
    bindingId: runtimeIdSchema,
    configurationVersion: positiveRuntimeIntegerSchema,
    pathFingerprint: pathFingerprintSchema,
  }).strict(),
  prompt: z.string().min(1).max(20_000),
  resultSchemaPath: runtimeRelativePathSchema,
  checkpointSnapshot: z.unknown().optional(),
  liveSession: z.object({
    sessionId: z.string().regex(/^[a-f0-9]{32}$/u),
    relayUrl: z.string().url(),
    authorization: z.string().trim().min(1).max(4_096),
    initialCols: z.number().int().min(1).max(1_000),
    initialRows: z.number().int().min(1).max(500),
  }).strict().optional(),
}).strict();

export const loopAssignmentV2Schema = loopAssignmentSchema.extend({
  contractVersion: z.literal(2),
  runGraphSnapshot: decisionRunGraphSnapshotSchema,
  routerContract: z.object({
    version: z.literal(1),
    digest: graphDigestSchema,
  }).strict(),
  offlineContinuation: offlineContinuationGrantSchema.nullable(),
});

export const loopAgentEventSchema = z.object({
  eventId: runtimeWideIdSchema,
  loopRunId: runtimeIdSchema,
  loopNodeRunId: runtimeIdSchema,
  loopNodeAttemptId: runtimeWideIdSchema,
  attemptNo: positiveRuntimeIntegerSchema,
  leaseGeneration: positiveRuntimeIntegerSchema,
  sequence: positiveRuntimeIntegerSchema,
  eventType: runtimeEventTypeSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  payloadSummary: z.unknown(),
  artifactRefs: runtimeArtifactRefsSchema,
}).strict().superRefine((event, context) => {
  if (event.eventType === "loop.checklist.created") {
    const parsed = loopChecklistCreatedPayloadSchema.safeParse(event.payloadSummary);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: "Invalid checklist.created payload", path: ["payloadSummary"] });
    }
  }
  if (event.eventType === "loop.checklist.updated") {
    const parsed = loopChecklistUpdatedPayloadSchema.safeParse(event.payloadSummary);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: "Invalid checklist.updated payload", path: ["payloadSummary"] });
    }
  }
});

/**
 * Runtime-generated work items are deliberately separate from the static
 * Stage Package checklist.  The provider may discover the concrete work at
 * execution time, while the platform owns the finite state machine and
 * lease-scoped identity.
 */
export const loopChecklistStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "succeeded",
  "failed",
  "skipped",
]);
export type LoopChecklistStatus = z.infer<typeof loopChecklistStatusSchema>;

const loopChecklistItemIdSchema = runtimeWideIdSchema;
const loopChecklistReasonSchema = z.string().trim().min(1).max(4_000);

export const loopChecklistItemSchema = z.object({
  id: loopChecklistItemIdSchema,
  title: z.string().trim().min(1).max(512),
  status: loopChecklistStatusSchema,
  reason: loopChecklistReasonSchema.optional(),
  evidenceRefs: runtimeArtifactRefsSchema,
}).strict().superRefine((item, context) => {
  if ((item.status === "failed" || item.status === "skipped") && item.reason === undefined) {
    context.addIssue({
      code: "custom",
      message: "Failed and skipped checklist items require a reason",
      path: ["reason"],
    });
  }
});

export const loopChecklistBindingSchema = z.object({
  loopRunId: runtimeIdSchema,
  loopNodeRunId: runtimeIdSchema,
  loopNodeAttemptId: runtimeWideIdSchema,
  attemptNo: positiveRuntimeIntegerSchema,
  leaseGeneration: positiveRuntimeIntegerSchema,
}).strict();

export const loopChecklistCreatedPayloadSchema = loopChecklistBindingSchema.extend({
  checklist: z.array(loopChecklistItemSchema).min(1).max(128),
}).strict().superRefine((payload, context) => {
  const ids = payload.checklist.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Checklist item IDs must be unique", path: ["checklist"] });
  }
});

export const loopChecklistUpdatedPayloadSchema = loopChecklistBindingSchema.extend({
  itemId: loopChecklistItemIdSchema,
  status: loopChecklistStatusSchema,
  reason: loopChecklistReasonSchema.optional(),
  evidenceRefs: runtimeArtifactRefsSchema,
}).strict().superRefine((payload, context) => {
  if ((payload.status === "failed" || payload.status === "skipped") && payload.reason === undefined) {
    context.addIssue({ code: "custom", message: "Failed and skipped checklist updates require a reason", path: ["reason"] });
  }
});

export const loopChecklistEventTypeSchema = z.enum([
  "loop.checklist.created",
  "loop.checklist.updated",
]);

export type LoopChecklistItem = z.infer<typeof loopChecklistItemSchema>;
export type LoopChecklistBinding = z.infer<typeof loopChecklistBindingSchema>;
export type LoopChecklistCreatedPayload = z.infer<typeof loopChecklistCreatedPayloadSchema>;
export type LoopChecklistUpdatedPayload = z.infer<typeof loopChecklistUpdatedPayloadSchema>;

const CHECKLIST_TRANSITIONS: Record<LoopChecklistStatus, readonly LoopChecklistStatus[]> = {
  // A provider can fail before it reaches its first checklist item. The
  // platform failure finalizer must still be able to close that item.
  not_started: ["not_started", "in_progress", "failed", "skipped"],
  in_progress: ["in_progress", "succeeded", "failed", "skipped"],
  succeeded: ["succeeded"],
  failed: ["failed", "in_progress"],
  skipped: ["skipped", "in_progress"],
};

export function isValidLoopChecklistTransition(
  from: LoopChecklistStatus,
  to: LoopChecklistStatus,
): boolean {
  return CHECKLIST_TRANSITIONS[from].includes(to);
}

export function validateLoopChecklistTransition(
  from: LoopChecklistStatus,
  to: LoopChecklistStatus,
): void {
  if (!isValidLoopChecklistTransition(from, to)) {
    throw new Error(`Invalid checklist status transition: ${from} -> ${to}`);
  }
}

export type LoopChecklistClosure = {
  closed: boolean;
  reason?: "missing_checklist" | "items_incomplete" | "missing_reason";
  incompleteItemIds: string[];
};

/** A node may only complete after every AI-generated item has a terminal state. */
export function evaluateLoopChecklistClosure(
  checklist: readonly LoopChecklistItem[],
): LoopChecklistClosure {
  if (checklist.length === 0) {
    return { closed: false, reason: "missing_checklist", incompleteItemIds: [] };
  }
  const incompleteItemIds = checklist
    .filter((item) => item.status === "not_started" || item.status === "in_progress")
    .map((item) => item.id);
  if (incompleteItemIds.length > 0) {
    return { closed: false, reason: "items_incomplete", incompleteItemIds };
  }
  if (checklist.some((item) => (item.status === "failed" || item.status === "skipped") && !item.reason)) {
    return {
      closed: false,
      reason: "missing_reason",
      incompleteItemIds: checklist
        .filter((item) => (item.status === "failed" || item.status === "skipped") && !item.reason)
        .map((item) => item.id),
    };
  }
  return { closed: true, incompleteItemIds: [] };
}

export const loopAgentEventBatchSchema = z.object({
  agentRunId: runtimeIdSchema,
  workerId: runtimeIdSchema,
  leaseGeneration: positiveRuntimeIntegerSchema,
  events: z.array(loopAgentEventSchema).min(1).max(100),
}).strict().superRefine((batch, context) => {
  batch.events.forEach((event, index) => {
    if (event.leaseGeneration !== batch.leaseGeneration) {
      context.addIssue({
        code: "custom",
        message: "Event leaseGeneration must match its batch",
        path: ["events", index, "leaseGeneration"],
      });
    }
  });
});

export const loopNodeResultSchema = z.object({
  outcome: loopOutcomeSchema,
  output: z.unknown(),
  artifactRefs: runtimeArtifactRefsSchema,
  effectReceipts: z.array(z.unknown()).max(100),
  failure: loopFailureEnvelopeSchema.optional(),
}).strict().superRefine((result, context) => {
  if (result.failure !== undefined && result.outcome !== "failure") {
    context.addIssue({
      code: "custom",
      message: "Failure details require failure outcome",
      path: ["failure"],
    });
  }
});

export const loopTransitionCountersSchema = z.object({
  transitions: z.number().int().nonnegative().max(1_024),
  repeats: z.number().int().nonnegative().max(20),
  edgeTraversals: z.record(
    z.string().min(1).max(96),
    z.number().int().nonnegative().max(1_024),
  ),
}).strict();

export const loopRuntimeBudgetSchema = z.object({
  maxStages: z.number().int().positive().max(64).optional(),
  maxRepeatCount: z.number().int().positive().max(20),
  maxTransitions: z.number().int().positive().max(1_024),
}).strict();

export type LoopAssignment = z.infer<typeof loopAssignmentSchema>;
export type LoopAssignmentV2 = z.infer<typeof loopAssignmentV2Schema>;
export type LoopAgentEvent = z.infer<typeof loopAgentEventSchema>;
export type LoopAgentEventBatch = z.infer<typeof loopAgentEventBatchSchema>;
export type LoopNodeResult = z.infer<typeof loopNodeResultSchema>;
export type LoopTransitionCounters = z.infer<typeof loopTransitionCountersSchema>;
export type LoopRuntimeBudget = z.infer<typeof loopRuntimeBudgetSchema>;
export type LoopExecutionPhaseStatus = z.infer<typeof loopExecutionPhaseStatusSchema>;
export type LoopExecutionPhase = z.infer<typeof loopExecutionPhaseSchema>;
