import { createHash } from "node:crypto";
import { LOOP_PLATFORM_CAPS } from "./loop-graph";

type JsonRecord = Record<string, unknown>;

interface PublishedVersionLimits {
  id: string;
  status: string;
  maxStages: number;
  maxRepeatCount: number;
  platformMaxTransitions: number;
}

export type LoopTriggerType = "manual" | "task_event" | "milestone_event" | "child_loop" | "scheduled" | "catch_up";

export interface LoopTriggerBinding {
  id: string;
  projectId: string;
  loopDefinitionId: string;
  activeVersionId: string;
  status: "enabled" | "disabled";
  version: number;
  createdByUserId: string;
  triggerPolicy: {
    manual: boolean;
    taskEvents: string[];
    milestoneEvents: string[];
  };
  parameterOverrides: JsonRecord;
  notificationPolicy: JsonRecord;
  automationGrantIds: string[];
  allowedAgentProfileIds: string[];
  allowedProviders: Array<"codex" | "claude">;
  versionPolicy: "latest" | "pinned";
  workerExecution?: WorkerExecutionBindingConfiguration;
  activeVersion: {
    id: string;
    status: string;
    maxStages: number;
    maxRepeatCount: number;
    platformMaxTransitions: number;
  };
  latestPublishedVersion?: PublishedVersionLimits;
}

export interface LoopTriggerSnapshots {
  budgetSnapshot: {
    maxStages: number;
    maxRepeatCount: number;
    maxTransitions: number;
  };
  bindingSnapshot: {
    id: string;
    projectId: string;
    loopDefinitionId: string;
    activeVersionId: string;
    versionPolicy: "latest" | "pinned";
    status: "enabled" | "disabled";
    version: number;
    createdByUserId: string;
    parameterOverrides: JsonRecord;
    allowedAgentProfileIds: string[];
    allowedProviders: Array<"codex" | "claude">;
    workerExecution?: WorkerExecutionBindingConfiguration;
  };
  policySnapshot: {
    triggerPolicy: LoopTriggerBinding["triggerPolicy"];
    notificationPolicy: JsonRecord;
  };
  grantSnapshot: {
    automationGrantIds: string[];
  };
}

export interface WorkerExecutionBindingConfiguration {
  workerPoolId: string;
  workerRepositoryUrl: string;
  workerBranchPolicy: JsonRecord;
  workerStageConfigurations: JsonRecord;
}

export type LoopExecutionTarget =
  | { type: "local_agent"; agentProfileId: string; profileDisplayName: string; provider: "codex" | "claude" }
  | { type: "linux_worker_pool"; workerPoolId: string; poolDisplayName: string };

export interface LoopExecutionSnapshot {
  target: LoopExecutionTarget;
  workerExecution?: WorkerExecutionBindingConfiguration;
  resolvedAt: string;
}

export function resolveLoopExecutionSnapshot(input: {
  target: LoopExecutionTarget;
  bindingSnapshot: LoopTriggerSnapshots["bindingSnapshot"];
  resolvedAt: Date;
}): LoopExecutionSnapshot {
  if (!(input.resolvedAt instanceof Date) || Number.isNaN(input.resolvedAt.valueOf())) {
    throw validationError("Loop execution target time is invalid");
  }
  if (input.target.type === "local_agent") {
    if (!input.bindingSnapshot.allowedAgentProfileIds.includes(input.target.agentProfileId)) {
      throw validationError("Selected Local Agent is not allowed by this Loop binding");
    }
    if (!input.bindingSnapshot.allowedProviders.includes(input.target.provider)) {
      throw validationError("Selected Local Agent Provider is not allowed by this Loop binding");
    }
    return {
      target: {
        type: "local_agent",
        agentProfileId: requiredId(input.target.agentProfileId, "agentProfileId", 96),
        profileDisplayName: requiredId(input.target.profileDisplayName, "profileDisplayName", 191),
        provider: input.target.provider,
      },
      resolvedAt: input.resolvedAt.toISOString(),
    };
  }
  const workerExecution = input.bindingSnapshot.workerExecution;
  if (!workerExecution || workerExecution.workerPoolId !== input.target.workerPoolId) {
    throw validationError("Selected Linux Worker Pool is not configured for this Loop binding");
  }
  return {
    target: {
      type: "linux_worker_pool",
      workerPoolId: requiredId(input.target.workerPoolId, "workerPoolId", 32),
      poolDisplayName: requiredId(input.target.poolDisplayName, "poolDisplayName", 191),
    },
    workerExecution: {
      workerPoolId: workerExecution.workerPoolId,
      workerRepositoryUrl: workerExecution.workerRepositoryUrl,
      workerBranchPolicy: cloneJsonRecord(workerExecution.workerBranchPolicy, "workerBranchPolicy"),
      workerStageConfigurations: cloneJsonRecord(workerExecution.workerStageConfigurations, "workerStageConfigurations"),
    },
    resolvedAt: input.resolvedAt.toISOString(),
  };
}

export function buildLoopTriggerIdentity(input: {
  bindingId: string;
  triggerType: LoopTriggerType;
  sourceEventId: string;
}): { runId: string; triggerReceiptId: string } {
  const bindingId = requiredId(input.bindingId, "bindingId", 96);
  const sourceEventId = requiredId(input.sourceEventId, "sourceEventId", 128);
  if (
    input.triggerType !== "manual"
    && input.triggerType !== "task_event"
    && input.triggerType !== "milestone_event"
    && input.triggerType !== "child_loop"
    && input.triggerType !== "scheduled"
    && input.triggerType !== "catch_up"
  ) {
    throw validationError("Invalid Loop trigger type");
  }
  const parts = [bindingId, input.triggerType, sourceEventId] as const;
  return {
    runId: `loop_run:${digest(["run", ...parts])}`,
    triggerReceiptId: `trigger_receipt:${digest(["receipt", ...parts])}`,
  };
}

export function bindingMatchesTaskEvent(binding: unknown, eventType: string): boolean {
  const parsed = parseLoopTriggerBinding(binding);
  return parsed.status === "enabled"
    && parsed.triggerPolicy.taskEvents.includes(requiredId(eventType, "eventType", 96));
}

export function bindingMatchesMilestoneEvent(binding: unknown, eventType: string): boolean {
  const parsed = parseLoopTriggerBinding(binding);
  return parsed.status === "enabled"
    && parsed.triggerPolicy.milestoneEvents.includes(requiredId(eventType, "eventType", 96));
}

export function resolveLoopTriggerSnapshots(binding: unknown): LoopTriggerSnapshots {
  const parsed = parseLoopTriggerBinding(binding);
  // Definition activation is the sole current-version selector. Binding
  // versions are retained only to read historical data and audit old Runs.
  const effectiveVersion = parsed.latestPublishedVersion ?? parsed.activeVersion;
  const published = {
    maxStages: effectiveVersion.maxStages,
    maxRepeatCount: effectiveVersion.maxRepeatCount,
    maxTransitions: effectiveVersion.platformMaxTransitions,
  };
  const nestedLimitsValue = parsed.parameterOverrides.limits;
  if (nestedLimitsValue !== undefined && !isRecord(nestedLimitsValue)) {
    throw validationError("Binding limits must be an object");
  }
  const nestedLimits = nestedLimitsValue ?? {};
  const budgetSnapshot = {
    maxStages: resolveLimit(parsed.parameterOverrides, nestedLimits, "maxStages", published.maxStages),
    maxRepeatCount: resolveLimit(
      parsed.parameterOverrides,
      nestedLimits,
      "maxRepeatCount",
      published.maxRepeatCount,
    ),
    maxTransitions: resolveLimit(
      parsed.parameterOverrides,
      nestedLimits,
      "maxTransitions",
      published.maxTransitions,
    ),
  };

  return {
    budgetSnapshot,
    bindingSnapshot: {
      id: parsed.id,
      projectId: parsed.projectId,
      loopDefinitionId: parsed.loopDefinitionId,
      activeVersionId: effectiveVersion.id,
      versionPolicy: "latest",
      status: parsed.status,
      version: parsed.version,
      createdByUserId: parsed.createdByUserId,
      parameterOverrides: cloneJsonRecord(parsed.parameterOverrides, "parameterOverrides"),
      allowedAgentProfileIds: [...parsed.allowedAgentProfileIds],
      allowedProviders: [...parsed.allowedProviders],
      ...(parsed.workerExecution === undefined ? {} : {
        workerExecution: {
          workerPoolId: parsed.workerExecution.workerPoolId,
          workerRepositoryUrl: parsed.workerExecution.workerRepositoryUrl,
          workerBranchPolicy: cloneJsonRecord(parsed.workerExecution.workerBranchPolicy, "workerBranchPolicy"),
          workerStageConfigurations: cloneJsonRecord(parsed.workerExecution.workerStageConfigurations, "workerStageConfigurations"),
        },
      }),
    },
    policySnapshot: {
      triggerPolicy: {
        manual: parsed.triggerPolicy.manual,
        taskEvents: [...parsed.triggerPolicy.taskEvents],
        milestoneEvents: [...parsed.triggerPolicy.milestoneEvents],
      },
      notificationPolicy: cloneJsonRecord(parsed.notificationPolicy, "notificationPolicy"),
    },
    grantSnapshot: {
      automationGrantIds: [...parsed.automationGrantIds],
    },
  };
}

function parseLoopTriggerBinding(value: unknown): LoopTriggerBinding {
  const binding = requireRecord(value, "Loop binding state is invalid");
  const status = binding.status;
  if (status !== "enabled" && status !== "disabled") {
    throw validationError("Loop binding status is invalid");
  }
  const triggerPolicy = requireRecord(binding.triggerPolicy, "Loop trigger policy is invalid");
  if (typeof triggerPolicy.manual !== "boolean" || !Array.isArray(triggerPolicy.taskEvents)) {
    throw validationError("Loop trigger policy is invalid");
  }
  const taskEvents = triggerPolicy.taskEvents.map((eventType) => requiredId(eventType, "task event", 96));
  if (taskEvents.length > 32) throw validationError("Loop trigger policy has too many Task events");
  const milestoneEvents = triggerPolicy.milestoneEvents === undefined
    ? []
    : Array.isArray(triggerPolicy.milestoneEvents)
      ? triggerPolicy.milestoneEvents.map((eventType) => requiredId(eventType, "milestone event", 96))
      : (() => { throw validationError("Loop milestone events are invalid"); })();
  if (milestoneEvents.length > 32) throw validationError("Loop trigger policy has too many milestone events");

  const activeVersion = requireRecord(binding.activeVersion, "Loop active version is invalid");
  const activeVersionId = requiredId(binding.activeVersionId, "activeVersionId", 96);
  const parsedActiveVersionId = requiredId(activeVersion.id, "activeVersion.id", 96);
  if (parsedActiveVersionId !== activeVersionId || activeVersion.status !== "published") {
    throw validationError("Loop binding requires its published active version");
  }

  const parameterOverrides = cloneJsonRecord(
    requireRecord(binding.parameterOverrides, "Loop parameter overrides are invalid"),
    "parameterOverrides",
  );
  const versionPolicy = parameterOverrides.versionPolicy === undefined
    ? "latest"
    : parameterOverrides.versionPolicy === "latest" || parameterOverrides.versionPolicy === "pinned"
      ? parameterOverrides.versionPolicy
      : (() => { throw validationError("Loop version policy is invalid"); })();
  const latestPublishedVersion = parseLatestPublishedVersion(binding);
  const notificationPolicy = cloneJsonRecord(
    requireRecord(binding.notificationPolicy, "Loop notification policy is invalid"),
    "notificationPolicy",
  );
  if (!Array.isArray(binding.automationGrantIds) || binding.automationGrantIds.length > 32) {
    throw validationError("Loop automation grants are invalid");
  }
  const allowedAgentProfileIds = parseScopeIds(
    binding.allowedAgentProfileIds,
    "allowedAgentProfileIds",
    32,
  );
  const allowedProviders = parseScopeIds(binding.allowedProviders, "allowedProviders", 2)
    .map((provider) => {
      if (provider !== "codex" && provider !== "claude") {
        throw validationError("Loop allowed Provider is invalid");
      }
      return provider;
    });
  const workerExecution = parseWorkerExecutionBinding(binding);

  return {
    id: requiredId(binding.id, "binding.id", 96),
    projectId: requiredId(binding.projectId, "binding.projectId", 96),
    loopDefinitionId: requiredId(binding.loopDefinitionId, "binding.loopDefinitionId", 96),
    activeVersionId,
    status,
    version: positiveInteger(binding.version, "binding.version"),
    createdByUserId: requiredId(binding.createdByUserId, "binding.createdByUserId", 64),
    triggerPolicy: { manual: triggerPolicy.manual, taskEvents, milestoneEvents },
    parameterOverrides,
    notificationPolicy,
    automationGrantIds: binding.automationGrantIds.map((grantId) => requiredId(grantId, "automationGrantId", 96)),
    allowedAgentProfileIds,
    allowedProviders,
    versionPolicy,
    ...(workerExecution === undefined ? {} : { workerExecution }),
    activeVersion: {
      id: parsedActiveVersionId,
      status: "published",
      maxStages: boundedPositiveInteger(activeVersion.maxStages, "maxStages", LOOP_PLATFORM_CAPS.maxStages),
      maxRepeatCount: boundedPositiveInteger(
        activeVersion.maxRepeatCount,
        "maxRepeatCount",
        LOOP_PLATFORM_CAPS.maxRepeatCount,
      ),
      platformMaxTransitions: boundedPositiveInteger(
        activeVersion.platformMaxTransitions,
        "platformMaxTransitions",
        LOOP_PLATFORM_CAPS.maxTransitions,
      ),
    },
    ...(latestPublishedVersion === undefined ? {} : { latestPublishedVersion }),
  };
}

function parseLatestPublishedVersion(binding: JsonRecord): PublishedVersionLimits | undefined {
  const loopDefinition = binding.loopDefinition;
  if (loopDefinition === undefined || loopDefinition === null) return undefined;
  const definition = requireRecord(loopDefinition, "Loop definition is invalid");
  const latest = definition.latestPublishedVersion;
  if (latest === undefined || latest === null) return undefined;
  const parsed = requireRecord(latest, "Loop latest published version is invalid");
  const id = requiredId(parsed.id, "latestPublishedVersion.id", 96);
  if (parsed.status !== "published") throw validationError("Loop latest published version is not published");
  return {
    id,
    status: "published",
    maxStages: boundedPositiveInteger(parsed.maxStages, "latestPublishedVersion.maxStages", LOOP_PLATFORM_CAPS.maxStages),
    maxRepeatCount: boundedPositiveInteger(parsed.maxRepeatCount, "latestPublishedVersion.maxRepeatCount", LOOP_PLATFORM_CAPS.maxRepeatCount),
    platformMaxTransitions: boundedPositiveInteger(parsed.platformMaxTransitions, "latestPublishedVersion.platformMaxTransitions", LOOP_PLATFORM_CAPS.maxTransitions),
  };
}

function parseWorkerExecutionBinding(binding: JsonRecord): WorkerExecutionBindingConfiguration | undefined {
  const projectResource = binding.projectWorkerResource ?? binding.project;
  const hasCompleteProjectResource = isRecord(projectResource)
    && projectResource.workerPoolId !== null && projectResource.workerPoolId !== undefined
    && projectResource.workerRepositoryUrl !== null && projectResource.workerRepositoryUrl !== undefined
    && projectResource.workerBranchPolicy !== null && projectResource.workerBranchPolicy !== undefined;
  if (hasCompleteProjectResource) {
    const resource = requireRecord(projectResource, "projectWorkerResource is invalid");
    const stages = binding.workerStageConfigurations;
    if (stages === undefined || stages === null) return undefined;
    const workerPoolId = requiredId(resource.workerPoolId, "projectWorkerResource.workerPoolId", 32);
    if (!/^[a-f0-9]{32}$/u.test(workerPoolId)) throw validationError("projectWorkerResource.workerPoolId is invalid");
    return {
      workerPoolId,
      workerRepositoryUrl: requiredId(resource.workerRepositoryUrl, "projectWorkerResource.workerRepositoryUrl", 1024),
      workerBranchPolicy: cloneJsonRecord(
        requireRecord(resource.workerBranchPolicy, "projectWorkerResource.workerBranchPolicy is invalid"),
        "projectWorkerResource.workerBranchPolicy",
      ),
      workerStageConfigurations: cloneJsonRecord(
        requireRecord(stages, "workerStageConfigurations is invalid"),
        "workerStageConfigurations",
      ),
    };
  }
  const configured = [
    binding.workerPoolId,
    binding.workerRepositoryUrl,
    binding.workerBranchPolicy,
    binding.workerStageConfigurations,
  ];
  if (configured.every((value) => value === undefined || value === null)) return undefined;
  if (configured.some((value) => value === undefined || value === null)) {
    throw validationError("Loop Worker execution configuration is incomplete");
  }
  const workerPoolId = requiredId(binding.workerPoolId, "workerPoolId", 32);
  if (!/^[a-f0-9]{32}$/u.test(workerPoolId)) throw validationError("workerPoolId is invalid");
  return {
    workerPoolId,
    workerRepositoryUrl: requiredId(binding.workerRepositoryUrl, "workerRepositoryUrl", 1024),
    workerBranchPolicy: cloneJsonRecord(
      requireRecord(binding.workerBranchPolicy, "workerBranchPolicy is invalid"),
      "workerBranchPolicy",
    ),
    workerStageConfigurations: cloneJsonRecord(
      requireRecord(binding.workerStageConfigurations, "workerStageConfigurations is invalid"),
      "workerStageConfigurations",
    ),
  };
}

function parseScopeIds(value: unknown, name: string, limit: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > limit) {
    throw validationError(`Loop ${name} is invalid`);
  }
  return [...new Set(value.map((entry) => requiredId(entry, name, 96)))].sort();
}

function resolveLimit(
  overrides: JsonRecord,
  nestedLimits: JsonRecord,
  key: "maxStages" | "maxRepeatCount" | "maxTransitions",
  publishedLimit: number,
): number {
  const topLevel = overrides[key];
  const nested = nestedLimits[key];
  if (topLevel !== undefined && nested !== undefined && topLevel !== nested) {
    throw validationError(`Binding ${key} declarations conflict`);
  }
  const override = nested ?? topLevel;
  if (override === undefined) return publishedLimit;
  const value = positiveInteger(override, `binding.${key}`);
  if (value > publishedLimit) {
    throw validationError(`Binding ${key} cannot exceed its published limit`);
  }
  return value;
}

function requiredId(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw validationError(`${name} must be a positive integer`);
  }
  return value as number;
}

function boundedPositiveInteger(value: unknown, name: string, ceiling: number): number {
  const parsed = positiveInteger(value, name);
  if (parsed > ceiling) throw validationError(`${name} exceeds the platform limit`);
  return parsed;
}

function cloneJsonRecord(value: JsonRecord, name: string): JsonRecord {
  return cloneJson(value, name) as JsonRecord;
}

function cloneJson(value: unknown, name: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, name));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item, name)]));
  }
  throw validationError(`${name} must contain JSON values`);
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) throw validationError(message);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
