import { z } from "zod";
import { reasoningEffortSchema } from "@humanthread/shared";

const boundedId = z.string().trim().min(1).max(128);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const relativePath = z.string().min(1).max(1_024).refine((value) => (
  !value.startsWith("/")
  && !value.includes("\\")
  && !/^[a-z]:/iu.test(value)
  && value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
), "Path must be project-relative");
const nodeKey = z.string().trim().min(1).max(96);
const executionId = z.string().trim().min(1).max(96).regex(/^[A-Za-z0-9_-]+$/u);
const skillKey = z.string().trim().min(1).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const boundedText = z.string().max(10_000);
const scopePath = relativePath;
const nodeBase = {
  key: nodeKey,
  nodeId: nodeKey.optional(),
  label: z.string().trim().min(1).max(191),
  offlinePolicy: z.enum(["local_capable", "online_required"]),
  requiredCapabilities: z.array(z.string().trim().min(1).max(96)).optional(),
};
const platformNodeSchema = z.discriminatedUnion("type", [
  z.object({ ...nodeBase, type: z.literal("start") }).strict(),
  z.object({ ...nodeBase, type: z.literal("end") }).strict(),
  z.object({ ...nodeBase, type: z.literal("agent_action"), executionTarget: z.enum(["local", "either"]), reasoningEffort: reasoningEffortSchema.optional() }).strict(),
  z.object({ ...nodeBase, type: z.literal("platform_action"), executionTarget: z.enum(["platform", "either"]) }).strict(),
  z.object({ ...nodeBase, type: z.literal("condition"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...nodeBase, type: z.literal("policy_gate"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...nodeBase, type: z.literal("human_gate"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...nodeBase, type: z.literal("wait_callback"), executionTarget: z.literal("platform") }).strict(),
  z.object({
    ...nodeBase,
    type: z.literal("subloop_call"),
    executionTarget: z.literal("platform"),
    targetLoopDefinitionId: boundedId,
    targetLoopVersionId: boundedId,
    inputMapping: z.record(z.string(), z.unknown()),
    terminalOutcomeMapping: z.record(z.string(), z.enum(["success", "failure", "pass", "rework", "reject", "timeout"])),
  }).strict(),
]);
const platformLoopGraphSchema = z.object({
  schemaVersion: z.literal(1),
  limits: z.object({
    maxStages: z.number().int().positive().max(64),
    maxRepeatCount: z.number().int().positive().max(20),
  }).strict(),
  nodes: z.array(platformNodeSchema).min(1).max(64),
  edges: z.array(z.object({
    id: boundedId,
    source: nodeKey,
    target: nodeKey,
    kind: z.enum(["normal", "feedback", "compensation"]),
    outcome: z.enum(["success", "failure", "pass", "rework", "reject", "timeout"]),
    maxTraversals: z.number().int().positive().max(20).optional(),
  }).strict()).max(256),
}).strict();

const routingNodeShape = {
  responsibility: z.string().trim().min(1).max(4_000),
  allowedRouteTargets: z.array(nodeKey).min(1).max(64),
};
const platformNodeV2Schema = z.discriminatedUnion("type", [
  z.object({ ...nodeBase, type: z.literal("start") }).strict(),
  z.object({ ...nodeBase, type: z.literal("end") }).strict(),
  z.object({ ...nodeBase, ...routingNodeShape, type: z.literal("agent_action"), executionTarget: z.enum(["local", "either"]), reasoningEffort: reasoningEffortSchema.optional() }).strict(),
  z.object({ ...nodeBase, ...routingNodeShape, type: z.literal("platform_action"), executionTarget: z.enum(["platform", "either"]) }).strict(),
  z.object({ ...nodeBase, ...routingNodeShape, type: z.literal("condition"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...nodeBase, ...routingNodeShape, type: z.literal("policy_gate"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...nodeBase, ...routingNodeShape, type: z.literal("human_gate"), executionTarget: z.literal("platform") }).strict(),
  z.object({ ...nodeBase, ...routingNodeShape, type: z.literal("wait_callback"), executionTarget: z.literal("platform") }).strict(),
  z.object({
    ...nodeBase,
    ...routingNodeShape,
    type: z.literal("subloop_call"),
    executionTarget: z.literal("platform"),
    targetLoopDefinitionId: boundedId,
    targetLoopVersionId: boundedId,
    inputMapping: z.record(z.string(), z.unknown()),
    terminalOutcomeMapping: z.record(z.string(), z.enum(["success", "failure", "pass", "rework", "reject", "timeout"])),
  }).strict(),
]);

const platformLoopGraphV2Schema = z.object({
  schemaVersion: z.literal(2),
  limits: z.object({
    maxStages: z.number().int().positive().max(64),
    maxRepeatCount: z.number().int().positive().max(20),
  }).strict(),
  nodes: z.array(platformNodeV2Schema).min(1).max(64),
  edges: platformLoopGraphSchema.shape.edges,
}).strict().superRefine((graph, context) => {
  const nodesByStableId = new Map(graph.nodes.map((node) => [node.nodeId ?? node.key, node]));
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    if (node.type === "start" || node.type === "end") continue;
    if (new Set(node.allowedRouteTargets).size !== node.allowedRouteTargets.length) {
      context.addIssue({ code: "custom", message: "Route targets must be unique", path: ["nodes", nodeIndex, "allowedRouteTargets"] });
    }
    for (const [targetIndex, targetId] of node.allowedRouteTargets.entries()) {
      const target = nodesByStableId.get(targetId);
      if (!target || !graph.edges.some((edge) => edge.source === node.key && edge.target === target.key)) {
        context.addIssue({
          code: "custom",
          message: "Route target must reference an outgoing graph edge",
          path: ["nodes", nodeIndex, "allowedRouteTargets", targetIndex],
        });
      }
    }
  }
});

export const projectLoopCatalogSchema = z.object({
  projectId: boundedId,
  catalogVersion: digest,
  projectBindings: z.array(z.object({
    id: boundedId,
    loopDefinitionId: boundedId,
    activeVersionId: boundedId,
    status: z.string().trim().min(1).max(32),
    bindingRole: z.string().trim().min(1).max(64).nullable(),
    version: z.number().int().positive(),
  }).strict()).max(128),
  publishedLoops: z.array(z.object({
    loopDefinitionId: boundedId,
    spaceId: boundedId,
    name: z.string().trim().min(1).max(191),
    description: z.string().max(4_000).nullable(),
    scope: z.enum(["project", "task"]),
    origin: z.enum(["platform", "space"]),
    readOnly: z.boolean(),
    latestPublishedVersionId: boundedId.nullable(),
    publishedVersions: z.array(z.object({
      loopVersionId: boundedId,
      versionNumber: z.number().int().positive(),
      graph: platformLoopGraphSchema,
    }).strict()).min(1).max(128),
  }).strict()).max(256),
}).strict();

export const projectLoopCatalogV2Schema = z.object({
  contractVersion: z.literal(2),
  projectId: boundedId,
  catalogVersion: digest,
  projectBindings: projectLoopCatalogSchema.shape.projectBindings,
  publishedLoops: z.array(z.object({
    loopDefinitionId: boundedId,
    spaceId: boundedId,
    name: z.string().trim().min(1).max(191),
    description: z.string().max(4_000).nullable(),
    scope: z.enum(["project", "task"]),
    origin: z.enum(["platform", "space"]),
    readOnly: z.boolean(),
    latestPublishedVersionId: boundedId.nullable(),
    publishedVersions: z.array(z.object({
      loopVersionId: boundedId,
      versionNumber: z.number().int().positive(),
      graph: platformLoopGraphV2Schema,
    }).strict()).min(1).max(128),
  }).strict()).max(256),
}).strict();

export const stageInputScopeSchema = z.object({
  codeAccess: z.boolean(),
  writeAccess: z.boolean(),
  include: z.array(scopePath).max(256),
  exclude: z.array(scopePath).max(256),
  allowedCommands: z.array(z.string().trim().min(1).max(2_048)).max(128),
  blockedPaths: z.array(scopePath).max(256),
}).strict();

export const stageResourceScopeSchema = z.object({
  prompts: z.boolean(),
  resources: z.boolean(),
  rules: z.boolean(),
  schemas: z.boolean(),
  skills: z.boolean(),
  templates: z.boolean(),
}).strict();

export const stageChecklistItemSchema = z.object({
  id: executionId,
  title: z.string().trim().min(1).max(191),
  fingerprintInputs: z.array(scopePath).max(128),
  evidence: z.array(relativePath).max(128),
  reusePolicy: z.enum(["AUTO", "VERIFY", "NEVER"]),
}).strict();

export const stageQualityGateSchema = z.object({
  checks: z.array(z.string().trim().min(1).max(2_048)).max(128),
  commands: z.array(z.string().trim().min(1).max(2_048)).max(32).optional(),
  requiredArtifacts: z.array(relativePath).max(128),
  minConfidence: z.number().min(0).max(1),
}).strict();

export const stageAutoRecoverySchema = z.object({
  maxAttempts: z.literal(1),
  issueTypes: z.array(
    z.string().trim().min(1).max(96).regex(/^[A-Z][A-Z0-9_]*$/u),
  ).min(1).max(32),
  commands: z.array(z.string().trim().min(1).max(2_048)).min(1).max(16),
}).strict().superRefine((value, context) => {
  if (new Set(value.issueTypes).size !== value.issueTypes.length) {
    context.addIssue({ code: "custom", message: "Auto-recovery issue types must be unique", path: ["issueTypes"] });
  }
  if (new Set(value.commands).size !== value.commands.length) {
    context.addIssue({ code: "custom", message: "Auto-recovery commands must be unique", path: ["commands"] });
  }
});

export const stageConfigurationSchema = z.object({
  schemaVersion: z.literal(2),
  loopId: boundedId,
  subloopId: boundedId,
  configured: z.boolean(),
  businessGoal: boundedText,
  inputScope: stageInputScopeSchema,
  resourceScope: stageResourceScopeSchema,
  checklist: z.array(stageChecklistItemSchema).max(128),
  qualityGate: stageQualityGateSchema,
  autoRecovery: stageAutoRecoverySchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.autoRecovery && !value.inputScope.writeAccess) {
    context.addIssue({ code: "custom", message: "Auto-recovery requires Workspace write access", path: ["autoRecovery"] });
  }
  const allowed = new Set(value.inputScope.allowedCommands);
  value.autoRecovery?.commands.forEach((command, index) => {
    if (!allowed.has(command)) {
      context.addIssue({
        code: "custom",
        message: "Auto-recovery commands must be declared in inputScope.allowedCommands",
        path: ["autoRecovery", "commands", index],
      });
    }
  });
  value.qualityGate.commands?.forEach((command, index) => {
    if (!allowed.has(command)) {
      context.addIssue({
        code: "custom",
        message: "Quality gate commands must be declared in inputScope.allowedCommands",
        path: ["qualityGate", "commands", index],
      });
    }
  });
});

const stageExecRunSchema = z.object({
  execId: executionId,
  role: z.enum(["primary", "reviewer", "validator"]),
  resumePolicy: z.enum(["CHECKPOINT", "NEW_SESSION"]),
}).strict();

export const stageAgentsSchema = z.object({
  schemaVersion: z.literal(1),
  executionMode: z.literal("SINGLE_WRITER"),
  execRuns: z.array(stageExecRunSchema).min(1).max(16),
}).strict().superRefine((value, context) => {
  const ids = value.execRuns.map(({ execId }) => execId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "execId values must be unique", path: ["execRuns"] });
  }
  if (value.execRuns.filter(({ role }) => role === "primary").length !== 1) {
    context.addIssue({ code: "custom", message: "Exactly one primary exec run is required", path: ["execRuns"] });
  }
});

export const stageSkillIndexSchema = z.discriminatedUnion("mode", [
  z.object({ schemaVersion: z.literal(1), mode: z.literal("all") }).strict(),
  z.object({ schemaVersion: z.literal(1), mode: z.literal("none") }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    mode: z.literal("include"),
    skills: z.array(skillKey).min(1).max(128),
  }).strict().superRefine((value, context) => {
    if (new Set(value.skills).size !== value.skills.length) {
      context.addIssue({ code: "custom", message: "Skill references must be unique", path: ["skills"] });
    }
  }),
]);

export const projectLoopManifestSchema = projectLoopCatalogSchema.extend({
  schemaVersion: z.literal(1),
  synchronizedAt: z.iso.datetime({ offset: true }),
}).strict();

export const projectLoopManifestV2Schema = projectLoopCatalogV2Schema.extend({
  schemaVersion: z.literal(2),
  synchronizedAt: z.iso.datetime({ offset: true }),
}).strict();

export const localLifecycleStateSchema = z.enum([
  "active",
  "unconfigured",
  "missing",
  "orphaned",
  "migration_required",
]);

const materializedEntrySchema = z.object({
  stableId: boundedId,
  path: relativePath,
  materialized: z.boolean(),
  expectedFiles: z.array(relativePath).max(16),
  localContractVersion: z.number().int().positive(),
  platformContractVersion: z.number().int().positive(),
  state: localLifecycleStateSchema,
  parentLoopId: boundedId.optional(),
}).strict();

export const projectLoopLockSchema = z.object({
  schemaVersion: z.literal(1),
  loops: z.record(z.string(), materializedEntrySchema),
  nodes: z.record(z.string(), materializedEntrySchema),
}).strict();

const materializedSubloopEntrySchema = materializedEntrySchema.extend({
  parentLoopId: boundedId,
}).strict();

const migrationStateSchema = z.object({
  fromVersion: z.literal(1),
  toVersion: z.literal(2),
  status: z.enum(["completed", "migration_required"]),
}).strict();

export const projectLoopLockV2Schema = z.object({
  schemaVersion: z.literal(2),
  loops: z.record(z.string(), materializedEntrySchema),
  subloops: z.record(z.string(), materializedSubloopEntrySchema),
  migrations: z.record(z.string(), migrationStateSchema),
}).strict();

export type ProjectLoopCatalog = z.infer<typeof projectLoopCatalogSchema>;
export type ProjectLoopCatalogV2 = z.infer<typeof projectLoopCatalogV2Schema>;
export type ProjectLoopManifest = z.infer<typeof projectLoopManifestSchema>;
export type ProjectLoopManifestV2 = z.infer<typeof projectLoopManifestV2Schema>;
export type LocalLifecycleState = z.infer<typeof localLifecycleStateSchema>;
export type MaterializedEntry = z.infer<typeof materializedEntrySchema>;
export type ProjectLoopLock = z.infer<typeof projectLoopLockSchema>;
export type ProjectLoopLockV2 = z.infer<typeof projectLoopLockV2Schema>;
export type StageInputScope = z.infer<typeof stageInputScopeSchema>;
export type StageResourceScope = z.infer<typeof stageResourceScopeSchema>;
export type StageChecklistItem = z.infer<typeof stageChecklistItemSchema>;
export type StageQualityGate = z.infer<typeof stageQualityGateSchema>;
export type StageAutoRecovery = z.infer<typeof stageAutoRecoverySchema>;
export type StageConfiguration = z.infer<typeof stageConfigurationSchema>;
export type StageAgents = z.infer<typeof stageAgentsSchema>;
export type StageSkillSelection = z.infer<typeof stageSkillIndexSchema>;

export type ProjectLoopStageContract = {
  loopId: string;
  subloopId: string;
  stagePath: string;
  configured: boolean;
  businessGoal: string;
  inputScope: StageInputScope;
  resourceScope: StageResourceScope;
  checklist: StageChecklistItem[];
  qualityGate: StageQualityGate;
  autoRecovery?: StageAutoRecovery;
  agents: StageAgents;
  skillSelection: StageSkillSelection;
  outputSchema: Record<string, unknown>;
  fingerprint: `sha256:${string}`;
};

export type LocalFileInventory = { files: string[]; contents?: Record<string, string> };

export type LoopSyncDiagnostic = {
  code: "node_unconfigured" | "node_file_missing" | "node_contract_migration_required" | "active_subloop_unreachable" | "migration_required";
  message: string;
  loopId?: string;
  nodeId?: string;
  subloopId?: string;
};

export type LoopSyncPlan = {
  manifest: ProjectLoopManifest;
  lock: ProjectLoopLock;
  createDirectories: string[];
  createFiles: Array<{ path: string; content: string }>;
  modifyFiles: never[];
  deletePaths: never[];
  diagnostics: LoopSyncDiagnostic[];
  blockingIssues: LoopSyncDiagnostic[];
};

export type LoopSyncPlanV2 = {
  kind: "ready" | "blocked";
  transactionId: string;
  manifest: ProjectLoopManifestV2;
  lock: ProjectLoopLockV2;
  createDirectories: string[];
  generatedWrites: Array<{ path: string; content: string }>;
  projectOwnedCreates: Array<{ path: string; content: string }>;
  migrationMoves: Array<{ from: string; to: string }>;
  diagnostics: LoopSyncDiagnostic[];
  blockingIssues: LoopSyncDiagnostic[];
};

export interface ProjectLoopSyncFilesystem {
  readText(relativePath: string): Promise<string | null>;
  listTree(relativePath: string): Promise<string[]>;
  mkdir(relativePath: string): Promise<void>;
  writeTextExclusive(relativePath: string, content: string): Promise<void>;
  writeTextAtomic(relativePath: string, content: string): Promise<void>;
  renameExclusive(from: string, to: string): Promise<void>;
  removeTransactionTree(relativePath: string): Promise<void>;
}
