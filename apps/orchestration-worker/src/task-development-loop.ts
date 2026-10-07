import { createHash } from "node:crypto";

import { executeTaskCommand, prisma } from "@humanthread/db";
import {
  evaluateTaskDevelopmentEvidence,
  type TaskDevelopmentEvidenceDecision,
  type TaskDevelopmentEvidenceInput,
} from "@humanthread/orchestration-core";

type TaskDevelopmentContext = {
  loopRunId: string;
  nodeRunId: string;
  attemptId: string;
  agentRunId?: string | null;
  nodeKey: string;
  task: {
    id: string;
    projectId: string;
    version: number;
    statusCategory: string;
    taskBranch: string;
    requiredRequirementIds: string[];
    requiredCheckNames: string[];
  };
  project: {
    developmentTemplateKey: string;
    stagingBranch: string;
  };
  result: unknown;
};

type PushEffect = {
  id: string;
  effectKey: string;
  operationType: "git.push";
  requestFingerprint: string;
  status: "succeeded" | "failed" | "reconciliation_required";
  providerReceipt: TaskDevelopmentEvidenceInput["pushReceipt"];
};

type PersistDecisionInput = {
  commandId: string;
  occurredAt: Date;
  context: TaskDevelopmentContext;
  report: TaskDevelopmentEvidenceInput["report"];
  knowledgeRefs: TaskDevelopmentEvidenceInput["knowledgeRefs"];
  effect: PushEffect;
  decision: TaskDevelopmentEvidenceDecision;
  completeTask: boolean;
};

export interface TaskDevelopmentLoopDependencies {
  loadContext(input: { loopRunId: string; attemptId: string }): Promise<TaskDevelopmentContext | null>;
  persistDecision(input: PersistDecisionInput): Promise<unknown>;
}

const defaultDependencies: TaskDevelopmentLoopDependencies = {
  loadContext: loadTaskDevelopmentContext,
  persistDecision: persistTaskDevelopmentDecision,
};

export async function handleTaskDevelopmentLoopEvent(
  input: unknown,
  dependencies: TaskDevelopmentLoopDependencies = defaultDependencies,
): Promise<{
  handled: boolean;
  outcome?: TaskDevelopmentEvidenceDecision["outcome"];
  reasonCode?: string;
  taskCompleted?: boolean;
}> {
  const event = parseNodeCompletedEvent(input);
  if (!event) return { handled: false };
  const context = await dependencies.loadContext({
    loopRunId: event.loopRunId,
    attemptId: event.attemptId,
  });
  if (!context) return { handled: false };

  const parsed = parseTaskDevelopmentEvidence(context);
  if (!parsed) return { handled: false };
  const { evidence, decision } = parsed;
  const effect = buildPushEffect(evidence.pushReceipt);
  const completeTask = decision.outcome === "pass";
  await dependencies.persistDecision({
    commandId: `task-development:${context.loopRunId}:${context.attemptId}`,
    occurredAt: event.occurredAt,
    context,
    report: evidence.report,
    knowledgeRefs: evidence.knowledgeRefs,
    effect,
    decision,
    completeTask,
  });
  return {
    handled: true,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
    taskCompleted: completeTask,
  };
}

type PersistedEvidence = TaskDevelopmentEvidenceInput;

function parseTaskDevelopmentEvidence(context: TaskDevelopmentContext): {
  evidence: PersistedEvidence;
  decision: TaskDevelopmentEvidenceDecision;
} | null {
  const delivery = parseWorkerDeliveryEvidence(context);
  if (delivery) {
    // The current Worker protocol reports Git delivery separately from the
    // app-server output. It is sufficient for tasks without additional
    // requirement/check evidence; tasks with explicit acceptance policy must
    // continue through the legacy report protocol instead of being auto-passed.
    if (context.task.requiredRequirementIds.length > 0 || context.task.requiredCheckNames.length > 0) return null;
    const evidence = deliveryEvidence(context, delivery);
    return { evidence, decision: evaluateWorkerDeliveryEvidence(delivery, evidence) };
  }
  if (context.nodeKey !== "verify_and_push") return null;
  const evidence = parsePersistedEvidence(context);
  return { evidence, decision: evaluateTaskDevelopmentEvidence(evidence) };
}

type WorkerDeliveryEvidence = {
  branch: string;
  baseCommit: string;
  headCommit: string;
  remoteHeadCommit: string;
  commits: Array<{ sha: string; subject: string }>;
  changedFiles: string[];
  clean: boolean;
};

function parseWorkerDeliveryEvidence(context: TaskDevelopmentContext): WorkerDeliveryEvidence | null {
  const result = optionalRecord(context.result);
  const output = optionalRecord(result?.output);
  const delivery = optionalRecord(output?.delivery);
  if (delivery?.required !== true) return null;
  const evidence = optionalRecord(delivery.evidence);
  if (!evidence) return null;
  const branch = optionalText(evidence.branch, 191);
  const baseCommit = optionalCommit(evidence.baseCommit);
  const headCommit = optionalCommit(evidence.headCommit);
  const remoteHeadCommit = optionalCommit(evidence.remoteHeadCommit);
  const commits = Array.isArray(evidence.commits) && evidence.commits.length <= 100
    ? evidence.commits.flatMap((value) => {
        const commit = optionalRecord(value);
        const sha = optionalCommit(commit?.sha);
        const subject = optionalText(commit?.subject, 512);
        return sha && subject ? [{ sha, subject }] : [];
      })
    : [];
  const changedFiles = Array.isArray(evidence.changedFiles) && evidence.changedFiles.length <= 500
    ? evidence.changedFiles.flatMap((value) => (
        typeof value === "string"
        && value.length > 0
        && value.length <= 1_024
        && !value.startsWith("/")
        && !value.includes("\\")
        && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
          ? [value]
          : []
      ))
    : [];
  if (!branch || !baseCommit || !headCommit || !remoteHeadCommit || typeof evidence.clean !== "boolean") return null;
  return { branch, baseCommit, headCommit, remoteHeadCommit, commits, changedFiles, clean: evidence.clean };
}

function deliveryEvidence(
  context: TaskDevelopmentContext,
  delivery: WorkerDeliveryEvidence,
): PersistedEvidence {
  const evidenceRef = `git-delivery:${delivery.headCommit}`;
  return {
    taskId: context.task.id,
    branch: context.task.taskBranch,
    requiredRequirementIds: [],
    requiredCheckNames: [],
    report: {
      taskId: context.task.id,
      branch: context.task.taskBranch,
      commit: delivery.headCommit,
      status: "passed",
      requirements: [],
      checks: [{ name: "git-delivery", status: "passed", evidenceRefs: [evidenceRef] }],
    },
    knowledgeRefs: [],
    pushReceipt: {
      status: "succeeded",
      branch: delivery.branch,
      remoteHeadCommit: delivery.remoteHeadCommit,
    },
  };
}

function evaluateWorkerDeliveryEvidence(
  deliveryEvidence: WorkerDeliveryEvidence,
  evidence: PersistedEvidence,
): TaskDevelopmentEvidenceDecision {
  const delivery = evidence.pushReceipt;
  if (delivery.branch !== evidence.branch) return { outcome: "reject", reasonCode: "evidence_identity_mismatch" };
  if (!deliveryEvidence.clean) return { outcome: "rework", reasonCode: "delivery_worktree_dirty" };
  if (deliveryEvidence.commits.length === 0 || deliveryEvidence.changedFiles.length === 0) {
    return { outcome: "rework", reasonCode: "delivery_no_changes" };
  }
  if (deliveryEvidence.headCommit !== deliveryEvidence.remoteHeadCommit) {
    return { outcome: "rework", reasonCode: "delivery_commit_mismatch" };
  }
  if (delivery.status !== "succeeded" || delivery.remoteHeadCommit === null) {
    return { outcome: "rework", reasonCode: "delivery_not_pushed" };
  }
  if (evidence.report.commit !== delivery.remoteHeadCommit) {
    return { outcome: "rework", reasonCode: "delivery_commit_mismatch" };
  }
  return { outcome: "pass", reasonCode: "worker_delivery_verified" };
}

function parsePersistedEvidence(context: TaskDevelopmentContext): PersistedEvidence {
  const result = record(context.result, "Persisted Loop result is invalid");
  if (result.outcome !== "success") throw validationError("Task verification attempt did not succeed");
  const output = record(result.output, "Persisted Task development output is invalid");
  const report = parseReport(output.report);
  const knowledgeRefs = parseKnowledgeRefs(output.knowledgeRefs);
  const pushReceipt = parsePushReceipt(output.pushReceipt);
  return {
    taskId: context.task.id,
    branch: context.task.taskBranch,
    requiredRequirementIds: context.task.requiredRequirementIds,
    requiredCheckNames: context.task.requiredCheckNames,
    report,
    knowledgeRefs,
    pushReceipt,
  };
}

function parseReport(value: unknown): TaskDevelopmentEvidenceInput["report"] {
  const report = record(value, "Task test report is invalid");
  const requirements = array(report.requirements, "Task report requirements are invalid").map((value) => {
    const requirement = record(value, "Task requirement result is invalid");
    return {
      requirementId: text(requirement.requirementId, "requirementId", 128),
      status: evidenceStatus(requirement.status),
      evidenceRefs: stringArray(requirement.evidenceRefs, "requirement evidenceRefs"),
    };
  });
  const checks = array(report.checks, "Task report checks are invalid").map((value) => {
    const check = record(value, "Task check result is invalid");
    return {
      name: text(check.name, "check name", 191),
      status: evidenceStatus(check.status),
      evidenceRefs: stringArray(check.evidenceRefs, "check evidenceRefs"),
    };
  });
  const status = report.status;
  if (status !== "passed" && status !== "failed") throw validationError("Task report status is invalid");
  return {
    taskId: text(report.taskId, "report taskId", 96),
    branch: text(report.branch, "report branch", 191),
    commit: commit(report.commit, "report commit"),
    status,
    requirements,
    checks,
  };
}

function parseKnowledgeRefs(value: unknown): TaskDevelopmentEvidenceInput["knowledgeRefs"] {
  return array(value, "Task knowledge references are invalid").map((value) => {
    const reference = record(value, "Task knowledge reference is invalid");
    return {
      path: text(reference.path, "knowledge path", 512),
      commit: commit(reference.commit, "knowledge commit"),
    };
  });
}

function parsePushReceipt(value: unknown): TaskDevelopmentEvidenceInput["pushReceipt"] {
  const receipt = record(value, "Task push receipt is invalid");
  const status = receipt.status;
  if (status !== "succeeded" && status !== "failed" && status !== "unknown") {
    throw validationError("Task push status is invalid");
  }
  return {
    status,
    branch: text(receipt.branch, "push branch", 191),
    remoteHeadCommit: receipt.remoteHeadCommit === null
      ? null
      : commit(receipt.remoteHeadCommit, "remote head commit"),
  };
}

function buildPushEffect(pushReceipt: TaskDevelopmentEvidenceInput["pushReceipt"]): PushEffect {
  const head = pushReceipt.remoteHeadCommit ?? "unknown";
  const identity = `${pushReceipt.branch}:${head}`;
  return {
    id: boundedId("git-push-effect", [identity], 128),
    effectKey: boundedId("git.push", [identity], 191),
    operationType: "git.push",
    requestFingerprint: fingerprint({ branch: pushReceipt.branch, head }),
    status: pushReceipt.status === "unknown" ? "reconciliation_required" : pushReceipt.status,
    providerReceipt: pushReceipt,
  };
}

async function loadTaskDevelopmentContext(input: {
  loopRunId: string;
  attemptId: string;
}): Promise<TaskDevelopmentContext | null> {
  const attempt = await prisma.loopNodeAttempt.findUnique({
    where: { id: input.attemptId },
    select: {
      id: true,
      agentRunId: true,
      result: true,
      loopNodeRun: {
        select: {
          id: true,
          nodeKey: true,
          loopRun: {
            select: {
              id: true,
              taskId: true,
              projectId: true,
              task: {
                select: {
                  id: true,
                  projectId: true,
                  version: true,
                  statusCategory: true,
                  taskBranch: true,
                  acceptancePolicy: true,
                  project: {
                    select: {
                      developmentTemplateKey: true,
                      stagingBranch: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const run = attempt?.loopNodeRun.loopRun;
  const task = run?.task;
  const project = task?.project;
  if (
    !attempt
    || !run
    || run.id !== input.loopRunId
    || !run.taskId
    || !run.projectId
    || !task
    || task.id !== run.taskId
    || task.projectId !== run.projectId
    || !task.taskBranch
    || !project?.developmentTemplateKey
    || !project.stagingBranch
  ) return null;
  const policy = optionalRecord(task.acceptancePolicy);
  return {
    loopRunId: run.id,
    nodeRunId: attempt.loopNodeRun.id,
    attemptId: attempt.id,
    agentRunId: attempt.agentRunId,
    nodeKey: attempt.loopNodeRun.nodeKey,
    task: {
      id: task.id,
      projectId: task.projectId,
      version: task.version,
      statusCategory: task.statusCategory,
      taskBranch: task.taskBranch,
      requiredRequirementIds: optionalStringArray(policy?.requiredRequirementIds),
      requiredCheckNames: optionalStringArray(policy?.requiredChecks),
    },
    project: {
      developmentTemplateKey: project.developmentTemplateKey,
      stagingBranch: project.stagingBranch,
    },
    result: attempt.result,
  };
}

async function persistTaskDevelopmentDecision(input: PersistDecisionInput): Promise<unknown> {
  const evidenceId = boundedId("task-test-report", [input.context.loopRunId, input.context.attemptId], 128);
  const definitionId = boundedId("task-development-check", [input.context.task.id], 128);
  const result = {
    taskId: input.context.task.id,
    evidenceId,
    decision: input.decision,
    version: input.context.task.version + 1,
  };
  return executeTaskCommand({
    command: {
      actor: { type: "system", id: "task-development-loop" },
      commandId: input.commandId,
      correlationId: `loop:${input.context.loopRunId}`,
      causationId: input.context.attemptId,
      expectedVersion: input.context.task.version,
      issuedAt: input.occurredAt,
      payload: { decision: input.decision },
    },
    taskId: input.context.task.id,
    eventType: input.completeTask ? "task.completed" : "task.development_evidence_recorded",
    eventPayload: {
      loopRunId: input.context.loopRunId,
      attemptId: input.context.attemptId,
      evidenceId,
      branch: input.context.task.taskBranch,
      remoteHeadCommit: input.effect.providerReceipt.remoteHeadCommit,
      decision: input.decision,
    },
    activity: {
      id: boundedId("activity", [input.commandId], 128),
      type: input.completeTask ? "task_development_completed" : "task_development_rework",
      actorType: "system",
      message: input.completeTask ? "Task branch and evidence are ready" : "Task development requires rework",
      payload: { evidenceId, decision: input.decision },
    },
    persist: async (baseTx) => {
      const tx = baseTx as typeof baseTx & {
        effectExecution: {
          findUnique(args: unknown): Promise<Record<string, unknown> | null>;
          create(args: unknown): Promise<unknown>;
        };
      };
      const existingEffect = await tx.effectExecution.findUnique({
        where: { effectKey: input.effect.effectKey },
      });
      if (existingEffect) {
        if (
          existingEffect.loopRunId !== input.context.loopRunId
          || existingEffect.nodeRunId !== input.context.nodeRunId
          || existingEffect.attemptId !== input.context.attemptId
          || existingEffect.requestFingerprint !== input.effect.requestFingerprint
        ) throw validationError("Git push effect identity is already bound to different evidence");
      } else {
        await tx.effectExecution.create({
          data: {
            ...input.effect,
            loopRunId: input.context.loopRunId,
            nodeRunId: input.context.nodeRunId,
            attemptId: input.context.attemptId,
            providerReceipt: input.effect.providerReceipt,
            resultFingerprint: fingerprint(input.effect.providerReceipt),
            resolvedAt: input.occurredAt,
          },
        });
      }
      await tx.checkDefinition.upsert({
        where: { id: definitionId },
        create: {
          id: definitionId,
          projectId: input.context.task.projectId,
          taskId: input.context.task.id,
          milestoneId: null,
          type: "development",
          name: "task-development-report",
          required: true,
          configuration: { checkKey: "task-development-report" },
          timeoutSeconds: null,
        },
        update: { required: true },
      });
      await tx.checkResult.create({
        data: {
          id: evidenceId,
          checkDefinitionId: definitionId,
          taskId: input.context.task.id,
          agentRunId: input.context.agentRunId ?? null,
          status: input.completeTask ? "passed" : "failed",
          summary: input.decision.reasonCode,
          artifactId: null,
          evidence: {
            source: "automation",
            loopRunId: input.context.loopRunId,
            attemptId: input.context.attemptId,
            report: input.report,
            knowledgeRefs: input.knowledgeRefs,
            pushReceipt: input.effect.providerReceipt,
            effectKey: input.effect.effectKey,
            decision: input.decision,
          },
          startedAt: input.occurredAt,
          finishedAt: input.occurredAt,
        },
      });
      const updated = await tx.task.updateMany({
        where: { id: input.context.task.id, version: input.context.task.version },
        data: {
          version: { increment: 1 },
          ...(input.completeTask ? {
            statusCategory: "completed",
            status: "completed",
            completedAt: input.occurredAt,
          } : {}),
        },
      });
      return { rows: updated.count, result };
    },
  });
}

function parseNodeCompletedEvent(input: unknown): {
  loopRunId: string;
  attemptId: string;
  occurredAt: Date;
} | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (Reflect.get(input, "eventType") !== "loop.node.completed") return null;
  const payload = record(Reflect.get(input, "payload"), "Loop completion payload is invalid");
  const occurredAt = new Date(text(Reflect.get(input, "occurredAt"), "occurredAt", 64));
  if (Number.isNaN(occurredAt.getTime())) throw validationError("Loop completion occurredAt is invalid");
  return {
    loopRunId: text(payload.loopRunId, "loopRunId", 96),
    attemptId: text(payload.attemptId, "attemptId", 128),
    occurredAt,
  };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validationError(message);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value === value.trim()
    ? value
    : null;
}

function optionalCommit(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value) ? value : null;
}

function array(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value) || value.length > 200) throw validationError(message);
  return value;
}

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function commit(value: unknown, name: string): string {
  const normalized = text(value, name, 64);
  if (!/^[a-f0-9]{40}$/u.test(normalized)) throw validationError(`${name} is invalid`);
  return normalized;
}

function evidenceStatus(value: unknown): "passed" | "failed" | "inconclusive" | "skipped" {
  if (value === "passed" || value === "failed" || value === "inconclusive" || value === "skipped") return value;
  throw validationError("Evidence status is invalid");
}

function stringArray(value: unknown, name: string): string[] {
  return array(value, `${name} is invalid`).map((item) => text(item, name, 191));
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
}

function boundedId(prefix: string, parts: string[], maxLength: number): string {
  const readable = `${prefix}:${parts.join(":")}`;
  return readable.length <= maxLength
    ? readable
    : `${prefix}:${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
