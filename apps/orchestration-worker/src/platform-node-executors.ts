import {
  gateDecisionSchema,
  type GateDecision,
  type LoopNodeDefinition,
  type LoopNodeResult,
} from "@humanthread/orchestration-core";
import * as jsonLogic from "json-logic-js";

type JsonRecord = Record<string, unknown>;

export interface PlatformNodeExecutorDependencies {
  assertCanWriteProject(input: { userId: string; projectId: string }): Promise<unknown>;
  loadDocumentTarget(documentId: string): Promise<{ id: string; projectId: string | null } | null>;
  updateDocumentIdempotently(input: {
    commandId: string;
    documentId: string;
    expectedVersion: number;
    title: string;
    contentMarkdown: string;
    actorUserId: string;
    source: "system";
  }): Promise<{ id: string; version: number }>;
  invokeTaskScopedChildLoop?(input: {
    projectId: string;
    taskId?: string;
    parent: { loopRunId: string; nodeRunId: string; attemptId: string };
    inputSnapshot: unknown;
    correlationId: string;
    actorUserId: string;
    targetLoopDefinitionId?: string;
    targetLoopVersionId?: string;
  }): Promise<{ childLoopRunId: string }>;
}

export interface PlatformActionExecutorInput {
  effectKey: string;
  projectId: string;
  actorUserId: string;
  config: unknown;
  input: unknown;
  loopRunId?: string;
  nodeRunId?: string;
  attemptId?: string;
  taskId?: string | null;
  correlationId?: string;
}

export type PlatformActionExecutor = (
  input: PlatformActionExecutorInput,
  dependencies: PlatformNodeExecutorDependencies,
) => Promise<LoopNodeResult>;

export type PlatformNodeExecutorRegistry = Readonly<Record<string, PlatformActionExecutor>>;

export const PLATFORM_NODE_EXECUTORS: PlatformNodeExecutorRegistry = {
  // Release plans and milestone-triggered releases create their immutable
  // snapshot before the graph starts. The graph node is the common boundary
  // for both paths, so it must preserve that snapshot as the next node input.
  "milestone.release.snapshot": async (input) => ({
    outcome: "success",
    output: input.input,
    artifactRefs: [],
    effectReceipts: [],
  }),
  "project_document.write": async (input, dependencies) => {
    const config = parseDocumentWriteConfig(input.config);
    await dependencies.assertCanWriteProject({
      userId: input.actorUserId,
      projectId: input.projectId,
    });
    const document = await dependencies.loadDocumentTarget(config.documentId);
    if (!document || document.projectId !== input.projectId) {
      throw validationError("Project document does not belong to the Loop Project");
    }
    const result = await dependencies.updateDocumentIdempotently({
      commandId: input.effectKey,
      documentId: config.documentId,
      expectedVersion: config.expectedVersion,
      title: config.title,
      contentMarkdown: config.contentMarkdown,
      actorUserId: input.actorUserId,
      source: "system",
    });
    return {
      outcome: "success",
      output: { documentId: result.id, version: result.version },
      artifactRefs: [],
      effectReceipts: [{
        effectKey: input.effectKey,
        documentId: result.id,
        version: result.version,
      }],
    };
  },
};

export type PlatformNodeExecution =
  | { status: "completed"; result: LoopNodeResult; gateDecision?: GateDecision }
  | { status: "waiting"; waitingReason: "timer"; wakeAt: Date }
  | { status: "waiting"; waitingReason: "callback"; callbackSecretHash: string }
  | { status: "waiting"; waitingReason: "child_loop"; childLoopRunId: string };

export async function executePlatformNode(
  input: {
    node: LoopNodeDefinition;
    input: unknown;
    projectId: string;
    actorUserId: string;
    taskId?: string | null;
    loopRunId?: string;
    nodeRunId?: string;
    attemptId?: string;
    correlationId?: string;
    effectKey?: string;
    now: Date;
  },
  dependencies: PlatformNodeExecutorDependencies,
): Promise<PlatformNodeExecution> {
  if (!Number.isFinite(input.now.getTime())) throw validationError("Platform execution time is invalid");
  switch (input.node.type) {
    case "start":
    case "end":
      return { status: "completed", result: successfulResult(input.input) };
    case "condition": {
      const matches = Boolean(jsonLogic.apply(input.node.expression as jsonLogic.RulesLogic, input.input));
      return {
        status: "completed",
        result: { ...successfulResult(input.input), outcome: matches ? "success" : "failure" },
      };
    }
    case "policy_gate": {
      const decision = parseGateDecision(input.input);
      return {
        status: "completed",
        gateDecision: decision,
        result: {
          outcome: decision.outcome,
          output: input.input,
          artifactRefs: [...decision.evidenceRefs],
          effectReceipts: [],
        },
      };
    }
    case "platform_action": {
      const action = requiredText(input.node.action, "Platform action key", 191);
      if (action === "task_loop.invoke") {
        return invokeChildLoop(input, dependencies);
      }
      const executor = PLATFORM_NODE_EXECUTORS[action];
      if (!executor) throw validationError(`Unregistered platform action: ${action}`);
      return {
        status: "completed",
        result: await executor({
          effectKey: requiredText(input.effectKey, "Effect key", 191),
          projectId: requiredText(input.projectId, "Project id", 64),
          actorUserId: requiredText(input.actorUserId, "Actor user id", 64),
          config: input.node.config,
          input: input.input,
          ...(input.loopRunId === undefined ? {} : { loopRunId: input.loopRunId }),
          ...(input.nodeRunId === undefined ? {} : { nodeRunId: input.nodeRunId }),
          ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        }, dependencies),
      };
    }
    case "subloop_call":
      return invokeChildLoop(input, dependencies, {
        targetLoopDefinitionId: requiredText(input.node.targetLoopDefinitionId, "Target Loop definition id", 96),
        targetLoopVersionId: requiredText(input.node.targetLoopVersionId, "Target Loop version id", 96),
      });
    case "wait_callback":
      return resolveWait(input.node.callback, input.now);
    case "human_gate":
      throw policyDenied("Human Gate execution is not enabled in the platform runtime slice");
    case "agent_action":
      throw validationError("Agent actions cannot execute on the platform node executor");
  }
}

async function invokeChildLoop(
  input: Parameters<typeof executePlatformNode>[0],
  dependencies: PlatformNodeExecutorDependencies,
  target?: { targetLoopDefinitionId: string; targetLoopVersionId: string },
): Promise<Extract<PlatformNodeExecution, { waitingReason: "child_loop" }>> {
  const invoke = dependencies.invokeTaskScopedChildLoop;
  if (!invoke) throw configurationRequired("Task-scoped Loop binding is not configured");
  const child = await invoke({
    projectId: requiredText(input.projectId, "Project id", 64),
    ...(input.taskId === undefined || input.taskId === null ? {} : { taskId: input.taskId }),
    parent: {
      loopRunId: requiredText(input.loopRunId, "Parent LoopRun id", 96),
      nodeRunId: requiredText(input.nodeRunId, "Parent NodeRun id", 96),
      attemptId: requiredText(input.attemptId, "Parent attempt id", 128),
    },
    inputSnapshot: input.input,
    correlationId: requiredText(input.correlationId, "Correlation id", 128),
    actorUserId: requiredText(input.actorUserId, "Actor user id", 64),
    ...target,
  });
  return {
    status: "waiting",
    waitingReason: "child_loop",
    childLoopRunId: requiredText(child.childLoopRunId, "Child LoopRun id", 96),
  };
}

function successfulResult(output: unknown): LoopNodeResult {
  return { outcome: "success", output, artifactRefs: [], effectReceipts: [] };
}

function parseGateDecision(value: unknown): GateDecision {
  const candidate = isRecord(value) && value.gateDecision !== undefined ? value.gateDecision : value;
  const parsed = gateDecisionSchema.safeParse(candidate);
  if (!parsed.success) throw validationError("Policy Gate input does not contain a valid GateDecision");
  return parsed.data;
}

function parseDocumentWriteConfig(value: unknown): {
  documentId: string;
  expectedVersion: number;
  title: string;
  contentMarkdown: string;
} {
  const config = requireRecord(value, "Document write config is invalid");
  const allowed = new Set(["documentId", "expectedVersion", "title", "contentMarkdown"]);
  if (Object.keys(config).some((key) => !allowed.has(key))) {
    throw validationError("Document write config contains unknown fields");
  }
  if (!Number.isInteger(config.expectedVersion) || (config.expectedVersion as number) <= 0) {
    throw validationError("Document expectedVersion must be a positive integer");
  }
  return {
    documentId: requiredText(config.documentId, "Document id", 96),
    expectedVersion: config.expectedVersion as number,
    title: requiredText(config.title, "Document title", 191),
    contentMarkdown: documentContent(config.contentMarkdown),
  };
}

function documentContent(value: unknown): string {
  if (typeof value !== "string" || value.length > 1_000_000) {
    throw validationError("Document content is invalid");
  }
  return value;
}

function resolveWait(value: unknown, now: Date): Extract<PlatformNodeExecution, { status: "waiting" }> {
  const callback = requireRecord(value, "Wait callback config is invalid");
  const allowed = new Set(["delayMs", "wakeAt", "secretHash"]);
  if (Object.keys(callback).some((key) => !allowed.has(key))) {
    throw validationError("Wait callback config contains unknown fields");
  }
  if (callback.secretHash !== undefined) {
    if (callback.delayMs !== undefined || callback.wakeAt !== undefined) {
      throw validationError("Callback wait cannot include timer fields");
    }
    if (typeof callback.secretHash !== "string" || !/^[a-f0-9]{64}$/u.test(callback.secretHash)) {
      throw validationError("Callback secretHash is invalid");
    }
    return { status: "waiting", waitingReason: "callback", callbackSecretHash: callback.secretHash };
  }
  if (callback.delayMs !== undefined && callback.wakeAt !== undefined) {
    throw validationError("Wait callback must declare delayMs or wakeAt, not both");
  }
  let wakeAt: Date;
  if (callback.delayMs !== undefined) {
    if (
      !Number.isInteger(callback.delayMs)
      || (callback.delayMs as number) <= 0
      || (callback.delayMs as number) > 31_536_000_000
    ) throw validationError("Wait delayMs is invalid");
    wakeAt = new Date(now.getTime() + (callback.delayMs as number));
  } else {
    const text = requiredText(callback.wakeAt, "Wait wakeAt", 64);
    wakeAt = new Date(text);
  }
  if (!Number.isFinite(wakeAt.getTime()) || wakeAt <= now) {
    throw validationError("Wait wakeAt must be a future timestamp");
  }
  return { status: "waiting", waitingReason: "timer", wakeAt };
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

function requiredText(value: unknown, name: string, maxLength: number, trim = true): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || (trim && value !== value.trim())
  ) throw validationError(`${name} is invalid`);
  return value;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function policyDenied(message: string): Error {
  return Object.assign(new Error(message), { code: "policy_denied" });
}

function configurationRequired(message: string): Error {
  return Object.assign(new Error(message), { code: "configuration_required" });
}
