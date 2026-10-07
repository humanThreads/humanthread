import {
  applyTransitionBudget,
  calculateMaxTransitions,
  createEventEnvelope,
  parseRunGraphSnapshot as parseVerifiedRunGraphSnapshot,
  parseRunGraphSnapshotV2 as parseVerifiedRunGraphSnapshotV2,
  selectNextEdge,
  transitionLoopNode,
  validateJsonSchemaValue,
} from "@humanthread/orchestration-core";
import type { TransitionCounters, TransitionExhaustionReason } from "@humanthread/orchestration-core";
import {
  gateDecisionSchema,
  loopAgentEventBatchSchema,
  loopChecklistCreatedPayloadSchema,
  loopChecklistUpdatedPayloadSchema,
  evaluateLoopChecklistClosure,
  validateLoopChecklistTransition,
  loopGraphSchema,
  loopGraphV2Schema,
  loopExecutionPhaseSchema,
  loopNodeResultSchema,
  loopRuntimeBudgetSchema,
  loopTransitionCountersSchema,
  parsePublishedLoopGraph,
  localRouteDecisionSchema,
  isHighFrequencyLoopAgentEventType,
  runGraphSnapshotSchema,
  runGraphSnapshotV2Schema,
  stableNodeId,
} from "@humanthread/shared";
import type {
  GateDecision,
  LoopAgentEvent,
  LoopEdgeDefinition,
  LoopGraph,
  LoopNodeDefinition,
  LoopNodeResult,
  LoopChecklistItem,
  LoopChecklistStatus,
  LoopChecklistCreatedPayload,
  LoopChecklistUpdatedPayload,
  LoopConfigurationWaitingReason,
  OrchestrationActor,
  OrchestrationEventEnvelope,
  RunGraphSnapshot,
  RunGraphSnapshotV2,
} from "@humanthread/shared";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAgentRunRecord } from "./agent-orchestration";
import { boundedPersistenceId } from "./bounded-id";
import { decideLoopFailure, effectiveMaxRetries, type FailureDecision } from "./loop-failure-decision";
import { createLoopNotificationIntentInTransaction } from "./loop-notifications";
import { prisma } from "./prisma";
import {
  appendWorkflowInteractionMessageRecord,
  closeWorkflowInteraction,
  createWorkflowInteractionRecord,
} from "./workflow-interactions";

type JsonRecord = Record<string, unknown>;

function parseChildRecoveryRunGraphSnapshot(value: unknown) {
  const v2 = runGraphSnapshotV2Schema.safeParse(value);
  if (v2.success) return v2.data;

  const v1 = runGraphSnapshotSchema.safeParse(value);
  if (v1.success) return v1.data;

  throw validationError("Child Loop recovery graph snapshot is invalid");
}

function isRunGraphSnapshotV2(
  value: RunGraphSnapshot | RunGraphSnapshotV2,
): value is RunGraphSnapshotV2 {
  return Reflect.get(value, "schemaVersion") === 2;
}

type RuntimeTx = Pick<Prisma.TransactionClient,
  | "commandReceipt"
  | "agentRun"
  | "agentWorker"
  | "effectExecution"
  | "loopNodeAttempt"
  | "loopNodeRun"
  | "loopRun"
  | "loopVersion"
  | "notificationIntent"
  | "orchestrationAggregateSequence"
  | "orchestrationEvent"
  | "outboxMessage"
  | "projectLoopBinding"
  | "projectScheduledTaskRun"
  | "triggerReceipt"
  | "workflowInteraction"
  | "workflowInteractionMessage"
  | "workflowInteractionAttachment"
  | "workflowInteractionMention"
>;

interface RuntimeDb {
  $transaction<T>(
    callback: (tx: RuntimeTx) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>;
  effectExecution?: Pick<PrismaClient["effectExecution"], "findUnique">;
  loopRun: Pick<PrismaClient["loopRun"], "findUnique">;
  triggerReceipt?: Pick<PrismaClient["triggerReceipt"], "findUnique">;
}

interface RuntimeDependencies {
  db: RuntimeDb;
  now?: () => Date;
  failureDecisionRollout?: LoopFailureDecisionRollout;
  recordFailureDecision?: (event: string, metadata: Record<string, unknown>) => void;
}

export interface LoopFailureDecisionRollout {
  shadowClassification: boolean;
  enforceFailureDecision: boolean;
  enforceMobileSourceIntervention: boolean;
}

const DEFAULTS: RuntimeDependencies = { db: prisma, now: () => new Date() };
const SUBLOOP_ATTEMPT_LIMIT_REASON = "subloop_attempt_limit_exceeded";
const SCHEDULED_ATTEMPT_STATUS = "scheduled";

// Keep retry Attempt IDs aligned with the scheduler's existing deterministic ID
// so a transaction-created continuation can be claimed by the normal ready scan.
export function buildLoopNodeAttemptId(nodeRunId: string, attemptNo: number): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([nodeRunId, String(attemptNo)]))
    .digest("hex");
  return `loop_attempt:${digest}`;
}

export function getLoopFailureDecisionRollout(
  env: Record<string, string | undefined> = process.env,
): LoopFailureDecisionRollout {
  const enabled = (value: string | undefined) => value?.trim().toLowerCase() === "true";
  return {
    shadowClassification: enabled(env.HUMANTHREAD_LOOP_FAILURE_SHADOW),
    enforceFailureDecision: enabled(env.HUMANTHREAD_LOOP_FAILURE_ENFORCED),
    enforceMobileSourceIntervention: enabled(env.HUMANTHREAD_LOOP_MOBILE_SOURCE_INTERVENTION),
  };
}

function legacyFailureDecision(classified: FailureDecision): FailureDecision {
  const base = {
    category: classified.category,
    code: classified.code,
    attemptNo: classified.attemptNo,
    maxRetries: classified.maxRetries,
  };
  if (classified.attemptNo <= classified.maxRetries) {
    return {
      ...base,
      disposition: "retry_attempt",
      reasonCode: "legacy_retry",
      nextAttemptNo: classified.attemptNo + 1,
    };
  }
  return {
    ...base,
    disposition: "terminate",
    reasonCode: "legacy_retry_budget_exhausted",
  };
}

function rolledOutFailureDecision(
  classified: FailureDecision,
  rollout: LoopFailureDecisionRollout,
): { applied: FailureDecision; shadow: boolean } {
  const mobileSource = classified.code === "MOBILE_SOURCE_UNAVAILABLE";
  const enforced = mobileSource
    ? rollout.enforceMobileSourceIntervention
    : rollout.enforceFailureDecision;
  return {
    applied: enforced ? classified : legacyFailureDecision(classified),
    shadow: rollout.shadowClassification && !enforced,
  };
}

export interface RequestRuntimeInterventionInput {
  loopNodeAttemptId: string;
  actor: OrchestrationActor;
  commandId: string;
  reason: string;
  evidence?: unknown;
  /**
   * References to pages the human must read, already registered with the
   * short-lived proxy. The platform stores only these references in the
   * interaction's policy snapshot; the page body never reaches the database.
   */
  reviewPages?: Array<{ token: string; fileName: string; byteSize: number; checksum: string }>;
  occurredAt: Date;
  correlationId?: string;
}

export interface RequestRuntimeInterventionResult {
  interactionId: string;
  status: string;
  version: number;
  loopRunId: string;
  loopNodeRunId: string;
  recovered: boolean;
}

/**
 * Fences an active execution and opens the one runtime intervention for its
 * activation. The unique interaction key is checked inside the same
 * Serializable command transaction so retries and concurrent callers recover
 * the original result instead of creating a second recovery path.
 */
export async function requestRuntimeIntervention(
  input: RequestRuntimeInterventionInput,
  dependencies: RuntimeDependencies = DEFAULTS,
): Promise<RequestRuntimeInterventionResult> {
  if (!input.loopNodeAttemptId.trim()) throw validationError("Loop node Attempt id is required");
  if (!input.commandId.trim()) throw validationError("Command id is required");
  const reason = input.reason.trim();
  if (!reason) throw validationError("Intervention reason is required");
  if (reason.length > 20_000) throw validationError("Intervention reason is too long");
  if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) {
    throw validationError("Intervention time is invalid");
  }

  const execute = () => dependencies.db.$transaction(async (tx) => {
      const prior = await tx.commandReceipt.findUnique({ where: { id: input.commandId } });
      if (prior?.status === "completed") return prior.result as unknown as RequestRuntimeInterventionResult;
      if (prior) throw validationError(`Command is already ${prior.status}`);
      await tx.commandReceipt.create({
        data: {
          id: input.commandId,
          aggregateType: "loop_node",
          aggregateId: boundedPersistenceId("loop-attempt", [input.loopNodeAttemptId], 96),
          status: "processing",
          createdAt: input.occurredAt,
        },
      });

      const attempt = await tx.loopNodeAttempt.findUnique({
        where: { id: input.loopNodeAttemptId },
        select: {
          id: true,
          attempt: true,
          status: true,
          version: true,
          loopNodeRunId: true,
          loopNodeRun: {
            select: {
              id: true,
              loopRunId: true,
              nodeKey: true,
              activationNo: true,
              attemptCount: true,
              status: true,
              version: true,
              loopRun: {
                select: {
                  id: true,
                  projectId: true,
                  taskId: true,
                  status: true,
                  statusReason: true,
                  version: true,
                  projectionVersion: true,
                  task: { select: { assigneeUserId: true, createdById: true } },
                },
              },
            },
          },
        },
      });
      if (!attempt) throw validationError("Loop node Attempt not found");

      const node = attempt.loopNodeRun;
      const run = node.loopRun;
      const existing = await tx.workflowInteraction.findUnique({
        where: {
          loopNodeRunId_activationNo_kind: {
            loopNodeRunId: node.id,
            activationNo: node.activationNo,
            kind: "runtime_intervention",
          },
        },
        select: { id: true, status: true, version: true },
      });

      let applied: {
        result: RequestRuntimeInterventionResult;
        events: OrchestrationEventEnvelope[];
      };
      if (existing) {
        applied = {
          result: {
            interactionId: existing.id,
            status: existing.status,
            version: existing.version,
            loopRunId: run.id,
            loopNodeRunId: node.id,
            recovered: true,
          },
          events: [],
        };
      } else {
        if (!run.projectId) throw validationError("LoopRun is not project-scoped");
        if (
          run.status !== "running"
          || node.status !== "running"
          || attempt.status !== "running"
          || attempt.attempt !== node.attemptCount
        ) throw staleLeaseError();

        const blockedAttempt = await tx.loopNodeAttempt.updateMany({
          where: { id: attempt.id, loopNodeRunId: node.id, status: "running", version: attempt.version },
          data: {
            status: "blocked",
            error: toPrismaJson({ code: "runtime_intervention_requested", reason }),
            finishedAt: input.occurredAt,
            version: { increment: 1 },
          },
        });
        if (blockedAttempt.count !== 1) throw staleLeaseError();
        const waitingNode = await tx.loopNodeRun.updateMany({
          where: { id: node.id, loopRunId: run.id, status: "running", version: node.version },
          data: {
            status: "waiting_intervention",
            waitingReason: "runtime_intervention:manual_request",
            version: { increment: 1 },
          },
        });
        if (waitingNode.count !== 1) throw staleLeaseError();
        const waitingRun = await tx.loopRun.updateMany({
          where: { id: run.id, status: "running", version: run.version, projectionVersion: run.projectionVersion },
          data: {
            status: "waiting",
            statusReason: "intervention:manual_request",
            version: { increment: 1 },
            projectionVersion: { increment: 1 },
          },
        });
        if (waitingRun.count !== 1) throw staleLeaseError();

        const command = {
          commandId: input.commandId,
          correlationId: input.correlationId ?? `loop:${run.id}`,
          actor: input.actor,
          payload: { source: input.actor.type, reason },
          issuedAt: input.occurredAt,
        } as const;
        const opened = await createWorkflowInteractionRecord({
          command,
          projectId: run.projectId,
          taskId: run.taskId,
          loopRunId: run.id,
          loopNodeRunId: node.id,
          activationNo: node.activationNo,
          kind: "runtime_intervention",
          policySnapshot: {
            source: input.actor.type,
            reason,
            ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
            ...(input.reviewPages === undefined ? {} : { reviewPages: input.reviewPages }),
          },
        }, tx as never);
        const message = await appendWorkflowInteractionMessageRecord({
          command: {
            ...command,
            commandId: `${input.commandId}:initial`,
            causationId: input.commandId,
          },
          interactionId: opened.result.id,
          message: { body: reason, answers: {}, attachmentIds: [], mentionedUserIds: [] },
        }, tx as never);
        const events = [
          ...opened.events,
          ...message.events,
          runtimeEvent({
            eventType: "loop.node.waiting_intervention",
            aggregateType: "loop_node",
            aggregateId: node.id,
            aggregateVersion: node.version + 1,
            sequence: node.version + 1,
            correlationId: command.correlationId,
            commandId: input.commandId,
            actor: input.actor,
            occurredAt: input.occurredAt,
            payload: {
              loopRunId: run.id,
              nodeKey: node.nodeKey,
              activationNo: node.activationNo,
              reason: "intervention:manual_request",
            },
          }),
          runtimeEvent({
            eventType: "loop.intervention.requested",
            aggregateType: "run",
            aggregateId: run.id,
            aggregateVersion: run.version + 1,
            sequence: run.version + 1,
            correlationId: command.correlationId,
            commandId: input.commandId,
            actor: input.actor,
            occurredAt: input.occurredAt,
            payload: { loopNodeRunId: node.id, loopNodeAttemptId: attempt.id, reason },
          }),
        ];
        const recipientUserId = run.task?.assigneeUserId
          ?? run.task?.createdById
          ?? (input.actor.type === "user" ? input.actor.id : null);
        if (recipientUserId) {
          await createLoopNotificationIntentInTransaction({
            projectId: run.projectId,
            loopRunId: run.id,
            loopNodeRunId: node.id,
            recipientUserId,
            eventType: "loop.intervention.required",
            title: "Loop 需要人工介入",
            description: reason,
            occurredAt: input.occurredAt,
            dedupeKey: `manual-intervention:${node.id}:${node.activationNo}`,
            templateData: { source: input.actor.type },
          }, tx as never);
        }
        applied = {
          result: {
            interactionId: opened.result.id,
            status: "open",
            version: message.result.version,
            loopRunId: run.id,
            loopNodeRunId: node.id,
            recovered: false,
          },
          events,
        };
      }

      await appendRuntimeEvents(tx, applied.events);
      await tx.commandReceipt.update({
        where: { id: input.commandId },
        data: { status: "completed", result: toPrismaJson(applied.result), completedAt: input.occurredAt },
      });
      return applied.result;
    }, { isolationLevel: "Serializable" });

  for (let retry = 0; retry < 2; retry += 1) {
    try {
      return await execute();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (retry === 1 || (code !== "P2002" && code !== "P2034")) throw error;
    }
  }
  throw validationError("Runtime intervention transaction could not be completed");
}

export interface RecoverLegacyLoopInterventionInput {
  loopRunId: string;
  occurredAt: Date;
  correlationId: string;
  actor?: OrchestrationActor;
}

export interface RecoverLegacyLoopInterventionResult {
  recovered: boolean;
  interactionId: string | null;
  loopNodeRunId: string | null;
  reasonCode: string | null;
}

/**
 * Repairs the state written by the pre-classification runtime. Those runs can
 * be paused with a live-looking retry NodeRun while its AgentRun was already
 * orphaned. The repair is deliberately narrow and idempotent: only that
 * legacy shape is eligible, and the runtime_intervention unique key is the
 * recovery fence for retries and concurrent reads.
 */
export async function recoverLegacyLoopIntervention(
  input: RecoverLegacyLoopInterventionInput,
  dependencies: { db: RuntimeDb } = DEFAULTS,
): Promise<RecoverLegacyLoopInterventionResult> {
  assertBoundedText(input.loopRunId, "Legacy LoopRun id", 96);
  assertBoundedText(input.correlationId, "Legacy recovery correlation id", 128);
  assertValidDate(input.occurredAt, "Legacy recovery time");
  const actor = input.actor ?? { type: "system", id: "legacy-loop-recovery" };

  const execute = () => dependencies.db.$transaction(async (tx) => {
    const run = await tx.loopRun.findUnique({
      where: { id: input.loopRunId },
      select: {
        id: true,
        projectId: true,
        taskId: true,
        status: true,
        statusReason: true,
        version: true,
        projectionVersion: true,
        task: { select: { assigneeUserId: true, createdById: true } },
      },
    });
    if (!run || !run.projectId || !["paused", "running", "waiting", "failed"].includes(run.status)) {
      return { recovered: false, interactionId: null, loopNodeRunId: null, reasonCode: null };
    }

    const node = await tx.loopNodeRun.findFirst({
      where: {
        loopRunId: input.loopRunId,
        status: { in: ["running", "failed", "waiting_intervention"] },
        OR: [
          { waitingReason: "subloop_retry" },
          { waitingReason: { startsWith: "runtime_intervention:" } },
          { status: "failed", waitingReason: null },
        ],
      },
      orderBy: [{ activationNo: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        loopRunId: true,
        nodeKey: true,
        activationNo: true,
        status: true,
        waitingReason: true,
        version: true,
        inputSnapshot: true,
        attempts: {
          orderBy: { attempt: "desc" },
          take: 1,
          select: {
            id: true,
            attempt: true,
            executorType: true,
            inputFingerprint: true,
            status: true,
            version: true,
            agentRunId: true,
            result: true,
            error: true,
            agentRun: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!node) return { recovered: false, interactionId: null, loopNodeRunId: null, reasonCode: null };

    const latestActivation = await tx.loopNodeRun.findFirst({
      where: { loopRunId: input.loopRunId, nodeKey: node.nodeKey },
      orderBy: [{ activationNo: "desc" }, { updatedAt: "desc" }],
      select: { id: true, activationNo: true, status: true },
    });

    const existing = await tx.workflowInteraction.findUnique({
      where: {
        loopNodeRunId_activationNo_kind: {
          loopNodeRunId: node.id,
          activationNo: node.activationNo,
          kind: "runtime_intervention",
        },
      },
      select: { id: true, status: true, version: true },
    });
    if (existing) {
      const superseded = latestActivation === null
        || latestActivation.id !== node.id
        || latestActivation.activationNo !== node.activationNo
        || node.status !== "waiting_intervention";
      if (superseded && existing.status === "open") {
        const expired = await closeWorkflowInteraction({
          interactionId: existing.id,
          expectedVersion: existing.version,
          status: "expired",
          actor: toWorkflowDecisionActor(actor),
          commandId: `legacy-intervention-expire:${existing.id}:${latestActivation?.activationNo ?? "unknown"}`,
          reason: "该人工介入已被更新的 Loop activation 替代。",
          selectedEdgeId: null,
          occurredAt: input.occurredAt,
        }, tx as never);
        const readyNode = await tx.loopNodeRun.findFirst({
          where: { loopRunId: input.loopRunId, status: "ready" },
          orderBy: [{ activationNo: "desc" }, { updatedAt: "desc" }],
          select: { id: true, activationNo: true },
        });
        if (run.status === "waiting" && run.statusReason?.startsWith("intervention:") && readyNode) {
          const resumedRun = await tx.loopRun.updateMany({
            where: {
              id: input.loopRunId,
              status: "waiting",
              version: run.version,
              projectionVersion: run.projectionVersion,
            },
            data: {
              status: "running",
              statusReason: null,
              version: { increment: 1 },
              projectionVersion: { increment: 1 },
            },
          });
          if (resumedRun.count !== 1) throw staleLeaseError();
          await appendRuntimeEvents(tx, [
            runtimeEvent({
              eventType: "workflow.interaction.expired",
              aggregateType: "workflow_interaction",
              aggregateId: existing.id,
              aggregateVersion: expired.version,
              sequence: expired.version,
              correlationId: input.correlationId,
              commandId: `legacy-intervention-expire:${existing.id}:${latestActivation?.activationNo ?? "unknown"}`,
              actor,
              occurredAt: input.occurredAt,
              payload: { reason: "superseded_activation", loopNodeRunId: node.id },
            }),
            runtimeEvent({
              eventType: "loop.run.resumed",
              aggregateType: "run",
              aggregateId: input.loopRunId,
              aggregateVersion: run.version + 1,
              sequence: run.version + 1,
              correlationId: input.correlationId,
              commandId: `legacy-intervention-resume:${input.loopRunId}:${readyNode.activationNo}`,
              actor,
              occurredAt: input.occurredAt,
              payload: { reason: "superseded_intervention", readyNodeRunId: readyNode.id },
            }),
          ]);
          return {
            recovered: true,
            interactionId: null,
            loopNodeRunId: readyNode.id,
            reasonCode: null,
          };
        }
      }
      if (!superseded) {
        return {
          recovered: true,
          interactionId: existing.id,
          loopNodeRunId: node.id,
          reasonCode: node.waitingReason?.replace(/^runtime_intervention:/u, "") ?? null,
        };
      }
      return { recovered: false, interactionId: null, loopNodeRunId: node.id, reasonCode: null };
    }

    const currentAttempt = node.attempts[0];
    const orphanedRetry = Boolean(
      node.status === "running"
      && node.waitingReason === "subloop_retry"
      && currentAttempt
      && currentAttempt.status === "running"
      && currentAttempt.executorType === "local"
      && typeof currentAttempt.agentRunId === "string"
      && currentAttempt.agentRun?.status === "orphaned",
    );
    const failedLegacy = Boolean(
      node.status === "failed"
      && currentAttempt
      && ["failed", "blocked"].includes(currentAttempt.status)
      && (currentAttempt.agentRun === undefined || currentAttempt.agentRun === null || ["failed", "orphaned"].includes(currentAttempt.agentRun.status)),
    );
    if (run.status === "waiting" || (!orphanedRetry && !failedLegacy) || !currentAttempt) {
      return { recovered: false, interactionId: null, loopNodeRunId: node.id, reasonCode: null };
    }

    const previousAttempt = orphanedRetry
      ? await tx.loopNodeAttempt.findFirst({
          where: {
            loopNodeRunId: node.id,
            attempt: { lt: currentAttempt.attempt },
            status: { in: ["failed", "blocked"] },
          },
          orderBy: { attempt: "desc" },
          select: { id: true, attempt: true, result: true, error: true },
        })
      : null;
    const sourceAttempt = previousAttempt ?? currentAttempt;
    const legacyResult = legacyFailureResult(sourceAttempt.result ?? sourceAttempt.error);
    const decision = decideLoopFailure({ result: legacyResult, attemptNo: sourceAttempt.attempt });
    if (decision.disposition !== "open_intervention") {
      return { recovered: false, interactionId: null, loopNodeRunId: node.id, reasonCode: null };
    }
    const reason = decision.code;
    const commandId = `legacy-intervention:${node.id}:${node.activationNo}`;
    const description = legacyInterventionDescription(reason, legacyResult.output);

    if (orphanedRetry) {
      const failedAttempt = await tx.loopNodeAttempt.updateMany({
        where: {
          id: currentAttempt.id,
          loopNodeRunId: node.id,
          status: "running",
          version: currentAttempt.version,
        },
        data: {
          status: "blocked",
          result: toPrismaJson(legacyResult),
          error: toPrismaJson({ code: "legacy_intervention_recovery", sourceFailure: reason }),
          outputFingerprint: fingerprintJsonValue(legacyResult.output),
          finishedAt: input.occurredAt,
          version: { increment: 1 },
        },
      });
      if (failedAttempt.count !== 1) throw staleLeaseError();

      const failedAgent = await tx.agentRun.updateMany({
        where: { id: currentAttempt.agentRunId as string, loopRunId: input.loopRunId, status: "orphaned" },
        data: {
          status: "failed",
          structuredResult: toPrismaJson(legacyResult),
          finishedAt: input.occurredAt,
          version: { increment: 1 },
        },
      });
      if (failedAgent.count !== 1) throw staleLeaseError();
    }

    const waitingNode = await tx.loopNodeRun.updateMany({
      where: { id: node.id, loopRunId: input.loopRunId, status: node.status, version: node.version },
      data: {
        status: "waiting_intervention",
        waitingReason: `runtime_intervention:${reason}`,
        structuredOutput: toPrismaJson(legacyResult.output),
        finishedAt: input.occurredAt,
        version: { increment: 1 },
      },
    });
    if (waitingNode.count !== 1) throw staleLeaseError();

    const waitingRun = await tx.loopRun.updateMany({
      where: {
        id: input.loopRunId,
        status: run.status,
        version: run.version,
        projectionVersion: run.projectionVersion,
      },
      data: {
        status: "waiting",
        statusReason: `intervention:${reason}`,
        stopReason: null,
        finishedAt: null,
        version: { increment: 1 },
        projectionVersion: { increment: 1 },
      },
    });
    if (waitingRun.count !== 1) throw staleLeaseError();

    const command = {
      commandId,
      correlationId: input.correlationId,
      causationId: currentAttempt.id,
      actor,
      payload: { source: "legacy_state_recovery", reason, previousAttemptId: previousAttempt?.id ?? null },
      issuedAt: input.occurredAt,
    } as const;
    const opened = await createWorkflowInteractionRecord({
      command,
      projectId: run.projectId,
      taskId: run.taskId,
      loopRunId: input.loopRunId,
      loopNodeRunId: node.id,
      activationNo: node.activationNo,
      kind: "runtime_intervention",
      policySnapshot: {
        source: "legacy_state_recovery",
        failureCode: reason,
        category: decision.category,
        reasonCode: decision.reasonCode,
        previousAttemptId: previousAttempt?.id ?? null,
      },
    }, tx as never);
    const message = await appendWorkflowInteractionMessageRecord({
      command: { ...command, commandId: `${commandId}:initial` },
      interactionId: opened.result.id,
      message: { body: description, answers: {}, attachmentIds: [], mentionedUserIds: [] },
    }, tx as never);
    const events = [
      runtimeEvent({
        eventType: "loop.failure.classified",
        aggregateType: "loop_node",
        aggregateId: node.id,
        aggregateVersion: node.version + 1,
        sequence: node.version + 1,
        correlationId: input.correlationId,
        causationId: currentAttempt.id,
        commandId,
        actor,
        occurredAt: input.occurredAt,
        payload: {
          loopRunId: input.loopRunId,
          nodeKey: node.nodeKey,
          activationNo: node.activationNo,
          attemptId: currentAttempt.id,
          code: reason,
          category: decision.category,
          disposition: "open_intervention",
          proposedDisposition: decision.disposition,
          reasonCode: "legacy_state_recovery",
          attemptNo: decision.attemptNo,
          maxRetries: decision.maxRetries,
        },
      }),
      runtimeEvent({
        eventType: "loop.node.waiting_intervention",
        aggregateType: "loop_node",
        aggregateId: node.id,
        aggregateVersion: node.version + 1,
        sequence: node.version + 1,
        correlationId: input.correlationId,
        causationId: currentAttempt.id,
        commandId,
        actor,
        occurredAt: input.occurredAt,
        payload: { loopRunId: input.loopRunId, nodeKey: node.nodeKey, activationNo: node.activationNo, reason: `intervention:${reason}` },
      }),
      runtimeEvent({
        eventType: "loop.intervention.required",
        aggregateType: "run",
        aggregateId: input.loopRunId,
        aggregateVersion: run.version + 1,
        sequence: run.version + 1,
        correlationId: input.correlationId,
        causationId: currentAttempt.id,
        commandId,
        actor,
        occurredAt: input.occurredAt,
        payload: { loopNodeRunId: node.id, loopNodeAttemptId: currentAttempt.id, reason: `intervention:${reason}`, source: "legacy_state_recovery" },
      }),
    ];
    await appendRuntimeEvents(tx, [...opened.events, ...message.events, ...events]);
    const recipientUserId = run.task?.assigneeUserId ?? run.task?.createdById;
    if (recipientUserId) {
      await createLoopNotificationIntentInTransaction({
        projectId: run.projectId,
        loopRunId: input.loopRunId,
        loopNodeRunId: node.id,
        recipientUserId,
        eventType: "loop.intervention.required",
        title: "Loop 需要人工介入",
        description,
        occurredAt: input.occurredAt,
        dedupeKey: `loop-intervention:${node.id}:${node.activationNo}:${reason}`,
        templateData: { source: "legacy_state_recovery", code: reason, category: decision.category },
      }, tx as never);
    }
    return {
      recovered: false,
      interactionId: opened.result.id,
      loopNodeRunId: node.id,
      reasonCode: reason,
    };
  }, { isolationLevel: "Serializable" });

  for (let retry = 0; retry < 2; retry += 1) {
    try {
      return await execute();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (retry === 1 || (code !== "P2002" && code !== "P2034")) throw error;
    }
  }
  throw validationError("Legacy loop intervention recovery could not be completed");
}

function legacyFailureResult(value: unknown): LoopNodeResult {
  const parsed = loopNodeResultSchema.safeParse(value);
  if (parsed.success && parsed.data.outcome === "failure") return parsed.data;
  const source = recordValue(value);
  const output = recordValue(source.output);
  const fallback = Object.keys(output).length > 0 ? output : source;
  // Older lease recovery persisted `{ code, agentRunId }` directly on the
  // attempt. Normal failure classification reads `output.errorCode`; preserve
  // that causal code instead of collapsing it into `unknown_failure` when the
  // recovery service later opens an intervention.
  const failureCode = typeof fallback.errorCode === "string" && fallback.errorCode.trim()
    ? fallback.errorCode
    : typeof fallback.code === "string" && fallback.code.trim()
      ? fallback.code
      : "legacy_failure_unclassified";
  const failureMessage = typeof fallback.message === "string" && fallback.message.trim()
    ? fallback.message
    : failureCode;
  return {
    outcome: "failure",
    output: {
      ...fallback,
      errorCode: failureCode,
      ...(typeof fallback.message === "string" ? {} : { message: failureMessage }),
    },
    artifactRefs: Array.isArray(source.artifactRefs) ? source.artifactRefs.filter((item): item is string => typeof item === "string") : [],
    effectReceipts: Array.isArray(source.effectReceipts) ? source.effectReceipts : [],
  };
}

function legacyInterventionDescription(code: string, output: unknown): string {
  const source = recordValue(output);
  const detail = typeof source.summary === "string" ? source.summary : typeof source.message === "string" ? source.message : "历史失败状态需要人工确认。";
  return `历史 Loop 失败（${code}）需要人工介入：${detail}`;
}

export interface CreateGraphLoopRunInput {
  id: string;
  triggerReceiptId: string;
  bindingId: string;
  triggerType: string;
  sourceEventId: string;
  commandId?: string;
  scheduledTaskRunId?: string;
  scheduledTaskPreparationFence?: {
    scheduledTaskRunId: string;
    expectedVersion: number;
    leaseToken: string;
    now: Date;
  };
  projectId: string;
  taskId?: string | null;
  loopVersionId: string;
  inputSnapshot: unknown;
  bindingSnapshot: unknown;
  executionSnapshot?: unknown;
  policySnapshot: unknown;
  grantSnapshot?: unknown;
  runGraphSnapshot?: RunGraphSnapshot | RunGraphSnapshotV2;
  budgetSnapshot: unknown;
  occurredAt: Date;
  correlationId: string;
  causationId?: string;
  actor: OrchestrationActor;
  parent?: {
    loopRunId: string;
    nodeRunId: string;
    attemptId: string;
  };
}

export async function createGraphLoopRun(
  input: CreateGraphLoopRunInput,
  dependencies: { db: RuntimeDb } = DEFAULTS,
): Promise<{ id: string; engineKind: "graph_v1" }> {
  const scheduledTaskRunId = parseScheduledTaskRunId(input.scheduledTaskRunId);
  const parent = parseParentLoopIdentity(input.parent);
  const bindingSnapshot = parseRunBindingSnapshot(input.bindingSnapshot);
  const budgetSnapshot = parseRuntimeBudget(input.budgetSnapshot);
  const verifiedRunGraph = input.runGraphSnapshot === undefined
    ? undefined
    : isRunGraphSnapshotV2(input.runGraphSnapshot)
      ? { snapshot: parseVerifiedRunGraphSnapshotV2(input.runGraphSnapshot), snapshotVersion: 2 as const }
      : { snapshot: parseVerifiedRunGraphSnapshot(input.runGraphSnapshot), snapshotVersion: 1 as const };
  const runGraphSnapshot = verifiedRunGraph?.snapshot;
  const runGraphSnapshotVersion = verifiedRunGraph?.snapshotVersion;
  const createRun = (): Promise<{ id: string; engineKind: "graph_v1" }> => dependencies.db.$transaction(async (tx) => {
      const existing = await tx.triggerReceipt.findUnique({
        where: { bindingId_triggerType_sourceEventId: {
          bindingId: input.bindingId,
          triggerType: input.triggerType,
          sourceEventId: input.sourceEventId,
        } },
        include: { loopRun: { select: { id: true, engineKind: true } } },
      });
      if (existing?.loopRun) return graphRunResult(existing.loopRun);

      const preparationFence = input.scheduledTaskPreparationFence;
      if (preparationFence !== undefined) {
        const scheduledTaskPreparing = scheduledTaskRunId === undefined
          ? null
          : await tx.projectScheduledTaskRun.findUnique({
            where: { id: preparationFence.scheduledTaskRunId },
            select: {
              id: true,
              status: true,
              version: true,
              preparationLeaseToken: true,
              preparationLeaseExpiresAt: true,
            },
          });
        if (
          scheduledTaskPreparing === null
          || scheduledTaskRunId !== preparationFence.scheduledTaskRunId
          || scheduledTaskPreparing.id !== preparationFence.scheduledTaskRunId
          || scheduledTaskPreparing.id !== scheduledTaskRunId
          || scheduledTaskPreparing.status !== "preparing"
          || scheduledTaskPreparing.version !== preparationFence.expectedVersion
          || scheduledTaskPreparing.preparationLeaseToken !== preparationFence.leaseToken
          || scheduledTaskPreparing.preparationLeaseExpiresAt === null
          || scheduledTaskPreparing.preparationLeaseExpiresAt <= preparationFence.now
        ) {
          throw preparationLeaseLostError();
        }
      }

      const currentBinding = await tx.projectLoopBinding.findUnique({
        where: { id: input.bindingId },
        select: {
          id: true,
          projectId: true,
          loopDefinitionId: true,
          status: true,
          version: true,
          activeVersionId: true,
          loopDefinition: { select: { status: true } },
        },
      });
      if (!currentBinding) throw validationError("Loop binding changed before Run creation");
      if (currentBinding.loopDefinition?.status === "archived") {
        throw loopBindingUnavailableError();
      }
      const snapshotChild = parent !== undefined && runGraphSnapshot !== undefined;
      const bindingVersionPolicy = bindingSnapshot.versionPolicy;
      if (
        currentBinding.id !== bindingSnapshot.id
        || currentBinding.projectId !== input.projectId
        || currentBinding.projectId !== bindingSnapshot.projectId
        || currentBinding.loopDefinitionId !== bindingSnapshot.loopDefinitionId
        || currentBinding.status !== "enabled"
        || currentBinding.version !== bindingSnapshot.version
        || (!snapshotChild && currentBinding.activeVersionId !== bindingSnapshot.activeVersionId && bindingVersionPolicy === "pinned")
        || (!snapshotChild && input.loopVersionId !== bindingSnapshot.activeVersionId)
        || (!snapshotChild
          && bindingVersionPolicy === "pinned"
          && currentBinding.activeVersionId !== input.loopVersionId)
      ) {
        throw validationError("Loop binding changed before Run creation");
      }

      const loopVersion = await tx.loopVersion.findUnique({
        where: { id: input.loopVersionId },
        select: { graph: true, status: true, loopDefinitionId: true },
      });
      if (
        !loopVersion
        || loopVersion.status !== "published"
        || loopVersion.loopDefinitionId !== bindingSnapshot.loopDefinitionId
      ) {
        throw validationError("Graph runs require a published loop version");
      }
      if (runGraphSnapshot !== undefined) {
        const snapshot = runGraphSnapshot;
        if (parent === undefined && snapshot.rootLoopVersionId !== input.loopVersionId) {
          throw validationError("Run graph snapshot root does not match the bound loop version");
        }
        if (parent !== undefined) {
          const persistedParent = await tx.loopRun.findUnique({
            where: { id: parent.loopRunId },
            select: {
              id: true,
              projectId: true,
              taskId: true,
              scheduledTaskRunId: true,
              runGraphSnapshot: true,
              graphDigest: true,
              snapshotVersion: true,
            },
          });
          const childScheduledTaskRunId = parseChildScheduledTaskRunId(input.inputSnapshot);
          if (
            !persistedParent
            || persistedParent.id !== parent.loopRunId
            || persistedParent.projectId !== input.projectId
            || (!persistedParent.scheduledTaskRunId
              ? !input.taskId || persistedParent.taskId !== input.taskId
              : input.taskId !== undefined
                || childScheduledTaskRunId !== persistedParent.scheduledTaskRunId)
            || persistedParent.graphDigest !== snapshot.graphDigest
            || persistedParent.snapshotVersion !== runGraphSnapshotVersion
            || fingerprintJsonValue(persistedParent.runGraphSnapshot) !== fingerprintJsonValue(snapshot)
          ) throw validationError("Child Loop snapshot does not match its parent Run");
          const target = snapshot.loopVersions.find((version) => (
            version.loopVersionId === input.loopVersionId
            && version.loopDefinitionId === bindingSnapshot.loopDefinitionId
            && version.scope === "task"
          ));
          if (!target) throw validationError("Child Loop version is outside the parent Run graph snapshot");
        }
      }
      const graph = parsePublishedLoopVersionGraph(loopVersion.graph);
      const startNodes = graph.nodes.filter((node) => node.type === "start");
      if (startNodes.length !== 1 || !startNodes[0]) {
        throw validationError("Published loop graph must contain exactly one Start node");
      }
      const startNode = startNodes[0];
      const startNodeRunId = buildNodeRunId(input.id, startNode.key, 1);

      await tx.triggerReceipt.create({
        data: {
          id: input.triggerReceiptId,
          bindingId: input.bindingId,
          triggerType: input.triggerType,
          sourceEventId: input.sourceEventId,
          ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
          inputSnapshot: toPrismaJson(input.inputSnapshot),
          createdAt: input.occurredAt,
        },
      });
      await tx.loopRun.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          engineKind: "graph_v1",
          loopVersionId: input.loopVersionId,
          bindingId: input.bindingId,
          triggerReceiptId: input.triggerReceiptId,
          ...(scheduledTaskRunId === undefined ? {} : { scheduledTaskRunId }),
          ...(parent === undefined ? {} : {
            parentLoopRunId: parent.loopRunId,
            parentNodeRunId: parent.nodeRunId,
            parentAttemptId: parent.attemptId,
          }),
          inputSnapshot: toPrismaJson(input.inputSnapshot),
          bindingSnapshot: toPrismaJson(input.bindingSnapshot),
          ...(input.executionSnapshot === undefined ? {} : { executionSnapshot: toPrismaJson(input.executionSnapshot) }),
          policySnapshot: toPrismaJson(input.policySnapshot),
          ...(input.grantSnapshot === undefined ? {} : { grantSnapshot: toPrismaJson(input.grantSnapshot) }),
          ...(runGraphSnapshot === undefined ? {} : {
            runGraphSnapshot: toPrismaJson(runGraphSnapshot),
            graphDigest: runGraphSnapshot.graphDigest,
            snapshotVersion: runGraphSnapshotVersion ?? 1,
          }),
          budgetSnapshot: toPrismaJson(budgetSnapshot),
          usageAggregate: { transitions: 0, repeats: 0, edgeTraversals: {} },
          status: "pending",
          transitionCount: 0,
          repeatCount: 0,
          projectionVersion: 1,
          version: 1,
          startedAt: input.occurredAt,
        },
      });
      await tx.loopNodeRun.create({
        data: {
          id: startNodeRunId,
          loopRunId: input.id,
          nodeKey: startNode.key,
          activationNo: 1,
          status: "ready",
          inputSnapshot: toPrismaJson(input.inputSnapshot),
          attemptCount: 0,
          version: 1,
          readyAt: input.occurredAt,
        },
      });
      await appendRuntimeEvents(tx, [
        runtimeEvent({
          eventType: "loop.run.created",
          aggregateType: "run",
          aggregateId: input.id,
          aggregateVersion: 1,
          sequence: 1,
          correlationId: input.correlationId,
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
          actor: input.actor,
          occurredAt: input.occurredAt,
          payload: { bindingId: input.bindingId, loopVersionId: input.loopVersionId, engineKind: "graph_v1" },
        }),
        runtimeEvent({
          eventType: "loop.node.ready",
          aggregateType: "loop_node",
          aggregateId: startNodeRunId,
          aggregateVersion: 1,
          sequence: 1,
          correlationId: input.correlationId,
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          actor: input.actor,
          occurredAt: input.occurredAt,
          payload: { loopRunId: input.id, nodeKey: startNode.key, activationNo: 1 },
        }),
      ]);
      return { id: input.id, engineKind: "graph_v1" };
  }, { isolationLevel: "Serializable" });
  const recoverCommittedRun = async (): Promise<{ id: string; engineKind: "graph_v1" } | undefined> => {
    if (!dependencies.db.triggerReceipt) return undefined;
    const existing = await dependencies.db.triggerReceipt.findUnique({
      where: { bindingId_triggerType_sourceEventId: {
        bindingId: input.bindingId,
        triggerType: input.triggerType,
        sourceEventId: input.sourceEventId,
      } },
      include: { loopRun: { select: { id: true, engineKind: true } } },
    });
    return existing?.loopRun ? graphRunResult(existing.loopRun) : undefined;
  };

  try {
    return await createRun();
  } catch (error) {
    if (isUniqueConstraint(error)) {
      // The duplicate receipt is already committed, so its Run can be read back
      // directly without rerunning the command.
      const recovered = await recoverCommittedRun();
      if (recovered) return recovered;
      throw error;
    }
    if (!isSerializationConflict(error)) throw error;
    // MariaDB can instead report the losing side of the duplicate trigger as a
    // serializable deadlock (P2034). That abort may happen before the winner
    // commits, so a side read here would observe nothing; rerun the Serializable
    // command once, whose initial receipt lookup then recovers the winner.
    try {
      return await createRun();
    } catch (retryError) {
      if (!isUniqueConstraint(retryError) && !isSerializationConflict(retryError)) throw retryError;
      const recovered = await recoverCommittedRun();
      if (recovered) return recovered;
      throw retryError;
    }
  }
}

export interface ActivateLoopNodeInput {
  loopRunId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  nodeKey: string;
  activationNo: number;
  inputSnapshot: unknown;
  executionTarget: "platform" | "local";
  attemptId: string;
  agentRun?: {
    id: string;
    projectId?: string | null;
    agentProfileId: string;
    inputSnapshot: unknown;
  };
  occurredAt: Date;
  correlationId: string;
  actor: OrchestrationActor;
}

export async function activateLoopNode(
  input: ActivateLoopNodeInput,
  dependencies: { db: RuntimeDb } = DEFAULTS,
): Promise<{ nodeRunId: string; attemptId: string }> {
  assertExecutorAgentRunPair(input);
  const activation = await dependencies.db.$transaction(async (tx) => {
    const readyNode = await tx.loopNodeRun.findUnique({
      where: { id: input.nodeRunId },
      select: {
        id: true,
        loopRunId: true,
        nodeKey: true,
        activationNo: true,
        status: true,
        version: true,
        attemptCount: true,
        inputSnapshot: true,
      },
    });
    if (
      !readyNode
      || readyNode.loopRunId !== input.loopRunId
      || readyNode.nodeKey !== input.nodeKey
      || readyNode.activationNo !== input.activationNo
      || readyNode.status !== "ready"
      || readyNode.version !== input.nodeRunVersion
      || fingerprintJsonValue(readyNode.inputSnapshot) !== fingerprintJsonValue(input.inputSnapshot)
    ) throw staleLeaseError();

    const run = await tx.loopRun.findUnique({
      where: { id: input.loopRunId },
      select: {
        id: true,
        projectId: true,
        engineKind: true,
        status: true,
        version: true,
        projectionVersion: true,
        loopVersionId: true,
        loopVersion: { select: { id: true, graph: true } },
      },
    });
    if (
      !run
      || run.engineKind !== "graph_v1"
      || !run.projectId
      || !run.loopVersionId
      || run.loopVersion?.id !== run.loopVersionId
      || (run.status !== "pending" && run.status !== "running")
    ) throw staleLeaseError();

    const graph = parsePublishedLoopVersionGraph(run.loopVersion.graph);
    const node = graph.nodes.find((candidate) => candidate.key === readyNode.nodeKey);
    if (!node || !nodeSupportsExecutionTarget(node, input.executionTarget)) {
      throw validationError("Activation execution target does not match the published node");
    }
    if (input.agentRun?.projectId && input.agentRun.projectId !== run.projectId) {
      throw validationError("Graph AgentRun project does not match its LoopRun");
    }

    const subloopAttemptCount = await tx.loopNodeAttempt.count({
      where: { loopNodeRunId: readyNode.id },
    });
    const attemptNo = readyNode.attemptCount + 1;
    const scheduledAttempt = await tx.loopNodeAttempt.findUnique({
      where: { loopNodeRunId_attempt: { loopNodeRunId: readyNode.id, attempt: attemptNo } },
      select: {
        id: true,
        attempt: true,
        executorType: true,
        status: true,
        agentRunId: true,
        inputFingerprint: true,
        version: true,
      },
    });
    const nodeRetryPolicy = recordValue(node).retryPolicy;
    const nodeMaxRetries = isPlainObject(nodeRetryPolicy) && typeof nodeRetryPolicy.maxRetries === "number"
      ? nodeRetryPolicy.maxRetries
      : undefined;
    const maxRetries = effectiveMaxRetries({
      ...(graph.retryPolicy?.maxRetries === undefined ? {} : { loopMaxRetries: graph.retryPolicy.maxRetries }),
      ...(nodeMaxRetries === undefined ? {} : { nodeMaxRetries }),
    });
    const activatedAttemptCount = subloopAttemptCount
      - (scheduledAttempt?.status === SCHEDULED_ATTEMPT_STATUS ? 1 : 0);
    if (activatedAttemptCount >= maxRetries + 1) {
      const failedNode = await tx.loopNodeRun.updateMany({
        where: {
          id: readyNode.id,
          loopRunId: readyNode.loopRunId,
          nodeKey: readyNode.nodeKey,
          activationNo: readyNode.activationNo,
          status: "ready",
          version: readyNode.version,
        },
        data: {
          status: "failed",
          selectedExecutionTarget: null,
          waitingReason: null,
          finishedAt: input.occurredAt,
          version: { increment: 1 },
        },
      });
      if (failedNode.count !== 1) throw staleLeaseError();
      const failedRun = await tx.loopRun.updateMany({
        where: {
          id: run.id,
          engineKind: "graph_v1",
          loopVersionId: run.loopVersionId,
          status: run.status,
          version: run.version,
          projectionVersion: run.projectionVersion,
        },
        data: {
          status: "failed",
          statusReason: SUBLOOP_ATTEMPT_LIMIT_REASON,
          stopReason: SUBLOOP_ATTEMPT_LIMIT_REASON,
          finishedAt: input.occurredAt,
          projectionVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (failedRun.count !== 1) throw staleLeaseError();
      await appendRuntimeEvents(tx, [runtimeEvent({
        eventType: "loop.node.failed",
        aggregateType: "loop_node",
        aggregateId: readyNode.id,
        aggregateVersion: readyNode.version + 1,
        sequence: readyNode.version + 1,
        correlationId: input.correlationId,
        actor: input.actor,
        occurredAt: input.occurredAt,
        payload: {
          loopRunId: readyNode.loopRunId,
          nodeKey: readyNode.nodeKey,
          activationNo: readyNode.activationNo,
          reason: SUBLOOP_ATTEMPT_LIMIT_REASON,
        },
      })]);
      return null;
    }

    if (run.status === "pending") {
      const startedRun = await tx.loopRun.updateMany({
        where: {
          id: run.id,
          engineKind: "graph_v1",
          loopVersionId: run.loopVersionId,
          status: "pending",
          version: run.version,
          projectionVersion: run.projectionVersion,
        },
        data: { status: "running", projectionVersion: { increment: 1 }, version: { increment: 1 } },
      });
      if (startedRun.count !== 1) throw staleLeaseError();
    }

    if (scheduledAttempt && (
      scheduledAttempt.id !== input.attemptId
      || scheduledAttempt.attempt !== attemptNo
      || scheduledAttempt.executorType !== input.executionTarget
      || scheduledAttempt.status !== SCHEDULED_ATTEMPT_STATUS
      || scheduledAttempt.agentRunId !== null
      || scheduledAttempt.inputFingerprint !== fingerprintJsonValue(readyNode.inputSnapshot)
      || scheduledAttempt.version !== 1
    )) throw staleLeaseError();

    const activated = await tx.loopNodeRun.updateMany({
      where: {
        id: readyNode.id,
        loopRunId: readyNode.loopRunId,
        nodeKey: readyNode.nodeKey,
        activationNo: readyNode.activationNo,
        status: "ready",
        version: readyNode.version,
      },
      data: {
        status: "running",
        selectedExecutionTarget: input.executionTarget,
        attemptCount: { increment: 1 },
        version: { increment: 1 },
        startedAt: input.occurredAt,
      },
    });
    if (activated.count !== 1) throw staleLeaseError();
    if (input.agentRun) {
      await createAgentRunRecord({
        agentRun: tx.agentRun,
        data: {
          id: input.agentRun.id,
          projectId: input.agentRun.projectId ?? run.projectId,
          taskId: null,
          loopRunId: input.loopRunId,
          loopNodeRunId: input.nodeRunId,
          attempt: attemptNo,
          agentProfileId: input.agentRun.agentProfileId,
          status: "queued",
          inputSnapshot: toPrismaJson(input.agentRun.inputSnapshot),
        },
      });
    }
    if (scheduledAttempt) {
      const activatedAttempt = await tx.loopNodeAttempt.updateMany({
        where: {
          id: scheduledAttempt.id,
          loopNodeRunId: input.nodeRunId,
          attempt: attemptNo,
          executorType: input.executionTarget,
          status: SCHEDULED_ATTEMPT_STATUS,
          agentRunId: null,
          version: scheduledAttempt.version,
        },
        data: {
          status: "running",
          ...(input.agentRun === undefined ? {} : { agentRunId: input.agentRun.id }),
          startedAt: input.occurredAt,
          version: { increment: 1 },
        },
      });
      if (activatedAttempt.count !== 1) throw staleLeaseError();
    } else {
      await tx.loopNodeAttempt.create({
        data: {
          id: input.attemptId,
          loopNodeRunId: input.nodeRunId,
          attempt: attemptNo,
          executorType: input.executionTarget,
          status: "running",
          ...(input.agentRun === undefined ? {} : { agentRunId: input.agentRun.id }),
          inputFingerprint: fingerprintJsonValue(readyNode.inputSnapshot),
          version: 1,
          startedAt: input.occurredAt,
        },
      });
    }
    await appendRuntimeEvents(tx, [runtimeEvent({
      eventType: "loop.node.activated",
      aggregateType: "loop_node",
      aggregateId: input.nodeRunId,
      aggregateVersion: readyNode.version + 1,
      sequence: readyNode.version + 1,
      correlationId: input.correlationId,
      actor: input.actor,
      occurredAt: input.occurredAt,
      payload: {
        loopRunId: readyNode.loopRunId,
        nodeKey: readyNode.nodeKey,
        activationNo: readyNode.activationNo,
        attemptNo,
        executionTarget: input.executionTarget,
      },
    })]);
    if (input.executionTarget === "platform") {
      await tx.outboxMessage.createMany({
        data: [{
          id: boundedPersistenceId("outbox", ["loop.platform.execute", input.attemptId]),
          topic: "loop.platform.execute",
          aggregateType: "loop_node",
          aggregateId: input.nodeRunId,
          payload: toPrismaJson({
            loopRunId: input.loopRunId,
            projectId: run.projectId,
            nodeRunId: input.nodeRunId,
            attemptId: input.attemptId,
            attemptNo,
            nodeKey: input.nodeKey,
            correlationId: input.correlationId,
          }),
          availableAt: input.occurredAt,
        }],
      });
    }
    return { nodeRunId: input.nodeRunId, attemptId: input.attemptId };
  });
  if (!activation) throw staleLeaseError();
  return activation;
}

export interface LoopConfigurationReadinessEvidence {
  bindingId: string;
  bindingVersion: number;
  agentProfileId: string | null;
  provider: string | null;
  workerId: string | null;
  workerVersion: number | null;
  deviceId: string | null;
  runtimeProfileId: string | null;
  runtimeVersion: number | null;
  workspaceBindingId: string | null;
  workspaceConfigurationVersion: number | null;
  automationGrantId: string | null;
  automationGrantVersion: number | null;
}

export interface WaitForLoopNodeConfigurationInput {
  loopRunId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  projectId: string;
  recipientUserId: string;
  waitingReason: LoopConfigurationWaitingReason;
  configurationVersion: string;
  evidence: LoopConfigurationReadinessEvidence;
  occurredAt: Date;
  correlationId: string;
  actor: OrchestrationActor;
}

type ConfigurationGateDependencies = {
  db: RuntimeDb;
  loadNodeRun?(input: { nodeRunId: string }): Promise<{
    id: string;
    loopRunId: string;
    nodeKey: string;
    activationNo: number;
    status: string;
    version: number;
    waitingReason: string | null;
    readinessEvidence: unknown;
  } | null>;
};

export async function waitForLoopNodeConfiguration(
  input: WaitForLoopNodeConfigurationInput,
  dependencies: ConfigurationGateDependencies = DEFAULTS,
): Promise<{ status: "waiting_configuration"; nodeRunVersion: number }> {
  validateConfigurationGateInput(input);
  const loadNodeRun = dependencies.loadNodeRun
    ?? ((lookup: { nodeRunId: string }) => prisma.loopNodeRun.findUnique({
      where: { id: lookup.nodeRunId },
      select: {
        id: true,
        loopRunId: true,
        nodeKey: true,
        activationNo: true,
        status: true,
        version: true,
        waitingReason: true,
        readinessEvidence: true,
      },
    }));
  const nodeRun = await loadNodeRun({ nodeRunId: input.nodeRunId });
  if (
    !nodeRun
    || nodeRun.loopRunId !== input.loopRunId
    || nodeRun.version !== input.nodeRunVersion
  ) throw staleLeaseError();
  const refreshingWait = nodeRun.status === "waiting_configuration";
  if (!refreshingWait && nodeRun.status !== "ready") throw staleLeaseError();
  if (
    refreshingWait
    && nodeRun.waitingReason === input.waitingReason
    && storedConfigurationVersion(nodeRun.readinessEvidence) === input.configurationVersion
  ) {
    return { status: "waiting_configuration", nodeRunVersion: nodeRun.version };
  }

  return dependencies.db.$transaction(async (tx) => {
    const run = await tx.loopRun.findUnique({
      where: { id: input.loopRunId },
      select: {
        id: true,
        projectId: true,
        engineKind: true,
        status: true,
        version: true,
        projectionVersion: true,
      },
    });
    if (
      !run
      || run.projectId !== input.projectId
      || run.engineKind !== "graph_v1"
      || (refreshingWait
        ? run.status !== "waiting"
        : run.status !== "pending" && run.status !== "running")
    ) throw staleLeaseError();

    const nextNodeVersion = nodeRun.version + 1;
    const updatedNode = await tx.loopNodeRun.updateMany({
      where: {
        id: nodeRun.id,
        loopRunId: nodeRun.loopRunId,
        activationNo: nodeRun.activationNo,
        status: refreshingWait ? "waiting_configuration" : "ready",
        version: nodeRun.version,
      },
      data: {
        status: "waiting_configuration",
        waitingReason: input.waitingReason,
        readinessEvidence: toPrismaJson({
          configurationVersion: input.configurationVersion,
          evidence: input.evidence,
        }),
        version: { increment: 1 },
      },
    });
    if (updatedNode.count !== 1) throw staleLeaseError();
    const updatedRun = await tx.loopRun.updateMany({
      where: {
        id: run.id,
        engineKind: "graph_v1",
        status: refreshingWait ? "waiting" : { in: ["pending", "running"] },
        version: run.version,
        projectionVersion: run.projectionVersion,
      },
      data: {
        status: "waiting",
        statusReason: input.waitingReason,
        version: { increment: 1 },
        projectionVersion: { increment: 1 },
      },
    });
    if (updatedRun.count !== 1) throw staleLeaseError();

    await appendRuntimeEvents(tx, [runtimeEvent({
      eventType: "loop.node.waiting_configuration",
      aggregateType: "loop_node",
      aggregateId: nodeRun.id,
      aggregateVersion: nextNodeVersion,
      sequence: nextNodeVersion,
      correlationId: input.correlationId,
      actor: input.actor,
      occurredAt: input.occurredAt,
      payload: {
        loopRunId: input.loopRunId,
        nodeKey: nodeRun.nodeKey,
        activationNo: nodeRun.activationNo,
        reason: input.waitingReason,
        configurationVersion: input.configurationVersion,
        evidence: input.evidence,
      },
    })]);
    await createLoopNotificationIntentInTransaction({
      projectId: input.projectId,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.nodeRunId,
      recipientUserId: input.recipientUserId,
      eventType: "loop.configuration.required",
      title: "Loop 需要本地执行配置",
      description: configurationActionDescription(input.waitingReason),
      occurredAt: input.occurredAt,
      dedupeKey: `loop-configuration:${input.nodeRunId}:${input.waitingReason}:${input.configurationVersion}`,
      templateData: {
        reason: input.waitingReason,
        configurationVersion: input.configurationVersion,
        route: configurationActionRoute(input),
      },
    }, tx as unknown as Parameters<typeof createLoopNotificationIntentInTransaction>[1]);
    return { status: "waiting_configuration", nodeRunVersion: nextNodeVersion };
  });
}

export async function resumeLoopNodeAfterConfiguration(
  input: {
    loopRunId: string;
    nodeRunId: string;
    nodeRunVersion: number;
    occurredAt: Date;
    correlationId: string;
    actor: OrchestrationActor;
  },
  dependencies: ConfigurationGateDependencies = DEFAULTS,
): Promise<{ status: "ready"; nodeRunVersion: number }> {
  validateConfigurationResumeInput(input);
  const loadNodeRun = dependencies.loadNodeRun
    ?? ((lookup: { nodeRunId: string }) => prisma.loopNodeRun.findUnique({
      where: { id: lookup.nodeRunId },
      select: {
        id: true,
        loopRunId: true,
        nodeKey: true,
        activationNo: true,
        status: true,
        version: true,
        waitingReason: true,
        readinessEvidence: true,
      },
    }));
  const nodeRun = await loadNodeRun({ nodeRunId: input.nodeRunId });
  if (
    !nodeRun
    || nodeRun.loopRunId !== input.loopRunId
    || nodeRun.status !== "waiting_configuration"
    || nodeRun.version !== input.nodeRunVersion
  ) throw staleLeaseError();

  return dependencies.db.$transaction(async (tx) => {
    const run = await tx.loopRun.findUnique({
      where: { id: input.loopRunId },
      select: { id: true, engineKind: true, status: true, version: true, projectionVersion: true },
    });
    if (!run || run.engineKind !== "graph_v1" || run.status !== "waiting") throw staleLeaseError();
    const nextNodeVersion = nodeRun.version + 1;
    const updatedNode = await tx.loopNodeRun.updateMany({
      where: {
        id: nodeRun.id,
        loopRunId: nodeRun.loopRunId,
        activationNo: nodeRun.activationNo,
        status: "waiting_configuration",
        version: nodeRun.version,
      },
      data: {
        status: "ready",
        waitingReason: null,
        readinessEvidence: Prisma.JsonNull,
        readyAt: input.occurredAt,
        version: { increment: 1 },
      },
    });
    if (updatedNode.count !== 1) throw staleLeaseError();
    const updatedRun = await tx.loopRun.updateMany({
      where: {
        id: run.id,
        engineKind: "graph_v1",
        status: "waiting",
        version: run.version,
        projectionVersion: run.projectionVersion,
      },
      data: {
        status: "running",
        statusReason: null,
        version: { increment: 1 },
        projectionVersion: { increment: 1 },
      },
    });
    if (updatedRun.count !== 1) throw staleLeaseError();
    await appendRuntimeEvents(tx, [runtimeEvent({
      eventType: "loop.node.configuration_ready",
      aggregateType: "loop_node",
      aggregateId: nodeRun.id,
      aggregateVersion: nextNodeVersion,
      sequence: nextNodeVersion,
      correlationId: input.correlationId,
      actor: input.actor,
      occurredAt: input.occurredAt,
      payload: {
        loopRunId: input.loopRunId,
        nodeKey: nodeRun.nodeKey,
        activationNo: nodeRun.activationNo,
      },
    })]);
    return { status: "ready", nodeRunVersion: nextNodeVersion };
  });
}

function validateConfigurationGateInput(input: WaitForLoopNodeConfigurationInput): void {
  validateConfigurationResumeInput(input);
  if (!input.projectId.trim() || !input.recipientUserId.trim()) {
    throw validationError("Loop configuration wait target is invalid");
  }
  if (!input.configurationVersion.trim() || input.configurationVersion.length > 191) {
    throw validationError("Loop configuration version is invalid");
  }
}

function storedConfigurationVersion(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>).configurationVersion;
  return typeof version === "string" ? version : null;
}

function validateConfigurationResumeInput(input: {
  loopRunId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  occurredAt: Date;
  correlationId: string;
}): void {
  if (!input.loopRunId.trim() || !input.nodeRunId.trim() || !input.correlationId.trim()) {
    throw validationError("Loop configuration transition identity is invalid");
  }
  if (!Number.isInteger(input.nodeRunVersion) || input.nodeRunVersion <= 0) {
    throw validationError("Loop configuration NodeRun version is invalid");
  }
  if (!Number.isFinite(input.occurredAt.getTime())) {
    throw validationError("Loop configuration transition time is invalid");
  }
}

function configurationActionDescription(reason: LoopConfigurationWaitingReason): string {
  const descriptions: Record<LoopConfigurationWaitingReason, string> = {
    workspace_missing: "请为此项目配置本地目录后继续运行。",
    workspace_stale: "本地目录配置已变化，请重新验证后继续运行。",
    runtime_missing: "请配置可用的本地 Agent 运行时后继续运行。",
    runtime_unauthenticated: "本地 Agent 运行时尚未登录，请完成认证后继续运行。",
    provider_not_allowed: "当前 Provider 不在 Loop 绑定允许范围内。",
    profile_not_allowed: "当前 Agent Profile 不在 Loop 绑定允许范围内。",
    worker_offline: "本地 Agent 当前离线，请启动客户端并保持连接。",
    repository_credential_unverified: "项目仓库凭证尚未通过校验，请完成仓库配置校验后继续运行。",
    grant_missing: "当前自动化授权不覆盖此本地执行配置。",
  };
  return descriptions[reason] ?? "请完成本地执行配置后继续运行。";
}

function configurationActionRoute(input: WaitForLoopNodeConfigurationInput): string {
  if (input.waitingReason === "workspace_missing" || input.waitingReason === "workspace_stale") {
    return `/projects/${input.projectId}`;
  }
  if (input.waitingReason === "repository_credential_unverified") {
    return `/projects/${input.projectId}/settings?tab=environment`;
  }
  return "/settings/agents";
}

export interface RecoverOrphanedGraphNodeInput {
  loopRunId: string;
  agentRunId: string;
  occurredAt: Date;
  correlationId: string;
  causationId?: string;
  actor: OrchestrationActor;
}

export async function recoverOrphanedGraphNode(
  input: RecoverOrphanedGraphNodeInput,
  dependencies: { db: RuntimeDb } = DEFAULTS,
): Promise<{ recovered: boolean; nodeRunId: string | null }> {
  return dependencies.db.$transaction(async (tx) => {
    const agentRun = await tx.agentRun.findUnique({
      where: { id: input.agentRunId },
      select: {
        id: true,
        status: true,
        loopRunId: true,
        loopNodeRunId: true,
        loopRun: {
          select: {
            engineKind: true,
            status: true,
            version: true,
            projectionVersion: true,
            loopVersion: { select: { graph: true } },
          },
        },
      },
    });
    if (
      !agentRun
      || agentRun.status !== "orphaned"
      || agentRun.loopRunId !== input.loopRunId
      || !agentRun.loopNodeRunId
      || agentRun.loopRun?.engineKind !== "graph_v1"
      || agentRun.loopRun.status !== "running"
    ) {
      return { recovered: false, nodeRunId: agentRun?.loopNodeRunId ?? null };
    }

    const [attempt, nodeRun] = await Promise.all([
      tx.loopNodeAttempt.findUnique({
        where: { agentRunId: input.agentRunId },
        select: {
          id: true,
          loopNodeRunId: true,
          agentRunId: true,
          executorType: true,
          status: true,
          version: true,
        },
      }),
      tx.loopNodeRun.findUnique({
        where: { id: agentRun.loopNodeRunId },
        select: {
          id: true,
          loopRunId: true,
          nodeKey: true,
          activationNo: true,
          status: true,
          version: true,
        },
      }),
    ]);
    if (
      !attempt
      || attempt.loopNodeRunId !== agentRun.loopNodeRunId
      || attempt.agentRunId !== input.agentRunId
      || attempt.executorType !== "local"
      || attempt.status !== "running"
      || !nodeRun
      || nodeRun.loopRunId !== input.loopRunId
      || nodeRun.status !== "running"
    ) {
      return { recovered: false, nodeRunId: agentRun.loopNodeRunId };
    }

    const subloopAttemptCount = await tx.loopNodeAttempt.count({
      where: { loopNodeRunId: nodeRun.id },
    });
    const recoveryGraph = agentRun.loopRun.loopVersion?.graph === undefined
      ? null
      : parsePublishedLoopVersionGraph(agentRun.loopRun.loopVersion.graph);
    const recoveryNode = recoveryGraph?.nodes.find((node) => node.key === nodeRun.nodeKey);
    const recoveryNodeRetryPolicy = recordValue(recoveryNode).retryPolicy;
    const recoveryNodeMaxRetries = isPlainObject(recoveryNodeRetryPolicy) && typeof recoveryNodeRetryPolicy.maxRetries === "number"
      ? recoveryNodeRetryPolicy.maxRetries
      : undefined;
    const recoveryMaxRetries = effectiveMaxRetries({
      ...(recoveryGraph?.retryPolicy?.maxRetries === undefined ? {} : { loopMaxRetries: recoveryGraph.retryPolicy.maxRetries }),
      ...(recoveryNodeMaxRetries === undefined ? {} : { nodeMaxRetries: recoveryNodeMaxRetries }),
    });
    const exhausted = subloopAttemptCount >= recoveryMaxRetries + 1;

    const failedAttempt = await tx.loopNodeAttempt.updateMany({
      where: {
        id: attempt.id,
        loopNodeRunId: nodeRun.id,
        agentRunId: input.agentRunId,
        executorType: "local",
        status: "running",
        version: attempt.version,
      },
      data: {
        status: "failed",
        error: toPrismaJson({ code: "lease_expired", agentRunId: input.agentRunId }),
        finishedAt: input.occurredAt,
        version: { increment: 1 },
      },
    });
    if (failedAttempt.count !== 1) throw staleLeaseError();

    const requeued = await tx.loopNodeRun.updateMany({
      where: {
        id: nodeRun.id,
        loopRunId: input.loopRunId,
        status: "running",
        version: nodeRun.version,
      },
      data: {
        status: exhausted ? "failed" : "ready",
        selectedExecutionTarget: null,
        waitingReason: exhausted ? null : "lease_recovery",
        ...(exhausted
          ? { finishedAt: input.occurredAt }
          : { readyAt: input.occurredAt, startedAt: null }),
        version: { increment: 1 },
      },
    });
    if (requeued.count !== 1) throw staleLeaseError();

    if (exhausted) {
      const failedRun = await tx.loopRun.updateMany({
        where: {
          id: input.loopRunId,
          engineKind: "graph_v1",
          status: "running",
          version: agentRun.loopRun.version,
          projectionVersion: agentRun.loopRun.projectionVersion,
        },
        data: {
          status: "failed",
          statusReason: SUBLOOP_ATTEMPT_LIMIT_REASON,
          stopReason: SUBLOOP_ATTEMPT_LIMIT_REASON,
          finishedAt: input.occurredAt,
          projectionVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (failedRun.count !== 1) throw staleLeaseError();
    }

    await appendRuntimeEvents(tx, [runtimeEvent({
      eventType: exhausted ? "loop.node.failed" : "loop.node.ready",
      aggregateType: "loop_node",
      aggregateId: nodeRun.id,
      aggregateVersion: nodeRun.version + 1,
      sequence: nodeRun.version + 1,
      correlationId: input.correlationId,
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      actor: input.actor,
      occurredAt: input.occurredAt,
      payload: {
        loopRunId: input.loopRunId,
        nodeKey: nodeRun.nodeKey,
        activationNo: nodeRun.activationNo,
        reason: exhausted ? SUBLOOP_ATTEMPT_LIMIT_REASON : "lease_recovery",
        agentRunId: input.agentRunId,
      },
    })]);
    return { recovered: true, nodeRunId: nodeRun.id };
  });
}

export interface CompleteLoopNodeInput {
  loopRunId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  attemptId: string;
  attemptNo: number;
  attemptVersion: number;
  agentRunId?: string;
  workerId?: string;
  linuxWorkerPoolSessionId?: string;
  leaseGeneration?: number;
  commandId?: string;
  claimToken?: string;
  result: LoopNodeResult;
  gateDecision?: unknown;
  routeDecision?: unknown;
  occurredAt: Date;
  correlationId: string;
  actor: OrchestrationActor;
}

export interface ResumeWaitingLoopNodeInput {
  loopRunId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  attemptId: string;
  attemptNo: number;
  attemptVersion: number;
  commandId: string;
  waitingReason: "timer" | "callback" | "child_loop";
  callbackId?: string;
  secretHash?: string;
  childLoopRunId?: string;
  result: LoopNodeResult;
  occurredAt: Date;
  correlationId: string;
  actor: OrchestrationActor;
}

type WaitingResume = Pick<ResumeWaitingLoopNodeInput,
  "commandId" | "waitingReason" | "callbackId" | "secretHash" | "childLoopRunId"
>;

type InternalCompleteLoopNodeInput = CompleteLoopNodeInput & { waitingResume?: WaitingResume };

export interface ClaimPlatformLoopAttemptInput {
  loopRunId: string;
  projectId: string;
  nodeRunId: string;
  attemptId: string;
  attemptNo: number;
  nodeKey: string;
  claimToken: string;
  now: Date;
  claimExpiresAt: Date;
}

export interface PlatformLoopAttemptLease {
  loopRunId: string;
  projectId: string;
  taskId?: string | null;
  actorUserId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  attemptId: string;
  attemptNo: number;
  attemptVersion: number;
  claimToken: string;
  node: LoopNodeDefinition;
  inputSnapshot: unknown;
}

export async function claimPlatformLoopAttempt(
  input: ClaimPlatformLoopAttemptInput,
  dependencies: { db: RuntimeDb } = DEFAULTS,
): Promise<PlatformLoopAttemptLease | null> {
  for (const [name, value, maxLength] of [
    ["LoopRun id", input.loopRunId, 96],
    ["Project id", input.projectId, 64],
    ["NodeRun id", input.nodeRunId, 96],
    ["Attempt id", input.attemptId, 128],
    ["Node key", input.nodeKey, 96],
    ["Claim token", input.claimToken, 128],
  ] as const) assertBoundedText(value, name, maxLength);
  if (!Number.isInteger(input.attemptNo) || input.attemptNo <= 0) {
    throw validationError("Attempt number must be a positive integer");
  }
  assertValidDate(input.now, "Platform claim time");
  assertValidDate(input.claimExpiresAt, "Platform claim expiry");
  if (input.claimExpiresAt <= input.now) throw validationError("Platform claim expiry must be in the future");

  return dependencies.db.$transaction(async (tx) => {
    const attempt = await tx.loopNodeAttempt.findUnique({
      where: { id: input.attemptId },
      select: {
        id: true,
        loopNodeRunId: true,
        attempt: true,
        executorType: true,
        status: true,
        agentRunId: true,
        claimToken: true,
        claimExpiresAt: true,
        version: true,
        loopNodeRun: {
          select: {
            id: true,
            loopRunId: true,
            nodeKey: true,
            version: true,
            status: true,
            inputSnapshot: true,
            loopRun: {
              select: {
                id: true,
                projectId: true,
                taskId: true,
                engineKind: true,
                status: true,
                binding: { select: { createdByUserId: true } },
                loopVersion: { select: { graph: true } },
              },
            },
          },
        },
      },
    });
    if (
      !attempt
      || attempt.loopNodeRunId !== input.nodeRunId
      || attempt.attempt !== input.attemptNo
      || attempt.executorType !== "platform"
      || attempt.agentRunId !== null
      || attempt.loopNodeRun.loopRunId !== input.loopRunId
      || attempt.loopNodeRun.nodeKey !== input.nodeKey
      || attempt.loopNodeRun.loopRun.id !== input.loopRunId
      || attempt.loopNodeRun.loopRun.projectId !== input.projectId
      || attempt.loopNodeRun.loopRun.engineKind !== "graph_v1"
    ) throw staleLeaseError();
    if (attempt.status !== "running") return null;
    if (
      attempt.loopNodeRun.status !== "running"
      || attempt.loopNodeRun.loopRun.status !== "running"
      || !attempt.loopNodeRun.loopRun.binding
      || !attempt.loopNodeRun.loopRun.loopVersion
    ) throw staleLeaseError();

    const graph = parsePublishedLoopVersionGraph(attempt.loopNodeRun.loopRun.loopVersion.graph);
    const node = graph.nodes.find((candidate) => candidate.key === input.nodeKey);
    if (!node || !nodeSupportsExecutionTarget(node, "platform")) {
      throw validationError("Platform attempt does not match its published node");
    }
    const claimed = await tx.loopNodeAttempt.updateMany({
      where: {
        id: input.attemptId,
        loopNodeRunId: input.nodeRunId,
        attempt: input.attemptNo,
        executorType: "platform",
        status: "running",
        agentRunId: null,
        version: attempt.version,
        OR: [{ claimToken: null }, { claimExpiresAt: { lte: input.now } }],
      },
      data: {
        claimToken: input.claimToken,
        claimExpiresAt: input.claimExpiresAt,
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) throw staleLeaseError();

    return {
      loopRunId: input.loopRunId,
      projectId: input.projectId,
      taskId: attempt.loopNodeRun.loopRun.taskId,
      actorUserId: attempt.loopNodeRun.loopRun.binding.createdByUserId,
      nodeRunId: input.nodeRunId,
      nodeRunVersion: attempt.loopNodeRun.version,
      attemptId: input.attemptId,
      attemptNo: input.attemptNo,
      attemptVersion: attempt.version + 1,
      claimToken: input.claimToken,
      node,
      inputSnapshot: attempt.loopNodeRun.inputSnapshot,
    };
  });
}

interface WaitPlatformLoopAttemptBaseInput {
  loopRunId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  attemptId: string;
  attemptNo: number;
  attemptVersion: number;
  claimToken: string;
  occurredAt: Date;
  correlationId: string;
  actor: OrchestrationActor;
}

export type WaitPlatformLoopAttemptInput = WaitPlatformLoopAttemptBaseInput & (
  | { waitingReason: "timer"; wakeAt: Date }
  | { waitingReason: "callback"; callbackId: string; secretHash: string }
  | { waitingReason: "child_loop"; childLoopRunId: string }
);

export async function waitPlatformLoopAttempt(
  input: WaitPlatformLoopAttemptInput,
  dependencies: RuntimeDependencies = DEFAULTS,
): Promise<void> {
  assertValidDate(input.occurredAt, "Platform wait occurredAt");
  if (input.waitingReason === "timer") {
    assertValidDate(input.wakeAt, "Platform wait wakeAt");
    if (input.wakeAt <= input.occurredAt) throw validationError("Platform wait wakeAt must be in the future");
  } else if (input.waitingReason === "callback") {
    assertBoundedText(input.callbackId, "Platform wait callback id", 128);
    if (!/^[a-f0-9]{64}$/u.test(input.secretHash)) throw validationError("Platform wait secret hash is invalid");
  } else {
    assertBoundedText(input.childLoopRunId, "Child LoopRun id", 96);
  }
  assertBoundedText(input.claimToken, "Platform wait claim token", 128);
  await dependencies.db.$transaction(async (tx) => {
    const serverNow = dependencies.now?.() ?? new Date();
    const attempt = await tx.loopNodeAttempt.findUnique({
      where: { id: input.attemptId },
      select: {
        id: true,
        loopNodeRunId: true,
        attempt: true,
        executorType: true,
        status: true,
        agentRunId: true,
        claimToken: true,
        claimExpiresAt: true,
        version: true,
        loopNodeRun: {
          select: {
            loopRunId: true,
            nodeKey: true,
            version: true,
            status: true,
          },
        },
      },
    });
    if (
      !attempt
      || attempt.loopNodeRunId !== input.nodeRunId
      || attempt.loopNodeRun.loopRunId !== input.loopRunId
      || attempt.loopNodeRun.version !== input.nodeRunVersion
      || attempt.loopNodeRun.status !== "running"
      || attempt.attempt !== input.attemptNo
      || attempt.version !== input.attemptVersion
      || attempt.executorType !== "platform"
      || attempt.agentRunId !== null
      || attempt.status !== "running"
      || attempt.claimToken !== input.claimToken
      || !attempt.claimExpiresAt
      || attempt.claimExpiresAt <= serverNow
    ) throw staleLeaseError();

    const run = await tx.loopRun.findUnique({
      where: { id: input.loopRunId },
      select: {
        id: true,
        engineKind: true,
        status: true,
        version: true,
        projectionVersion: true,
      },
    });
    if (!run || run.engineKind !== "graph_v1" || run.status !== "running") throw staleLeaseError();

    const checkpoint = input.waitingReason === "timer"
      ? { waitingReason: "timer", wakeAt: input.wakeAt.toISOString() }
      : input.waitingReason === "callback"
        ? { waitingReason: "callback", callbackId: input.callbackId, secretHash: input.secretHash }
        : { waitingReason: "child_loop", childLoopRunId: input.childLoopRunId };
    const updatedAttempt = await tx.loopNodeAttempt.updateMany({
      where: {
        id: input.attemptId,
        loopNodeRunId: input.nodeRunId,
        attempt: input.attemptNo,
        executorType: "platform",
        agentRunId: null,
        status: "running",
        version: input.attemptVersion,
        claimToken: input.claimToken,
        claimExpiresAt: { gt: serverNow },
      },
      data: {
        status: "waiting",
        checkpoint: toPrismaJson(checkpoint),
        claimToken: null,
        claimExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (updatedAttempt.count !== 1) throw staleLeaseError();
    const updatedNode = await tx.loopNodeRun.updateMany({
      where: {
        id: input.nodeRunId,
        loopRunId: input.loopRunId,
        version: input.nodeRunVersion,
        status: "running",
      },
      data: {
        status: "waiting_input",
        waitingReason: input.waitingReason,
        version: { increment: 1 },
      },
    });
    if (updatedNode.count !== 1) throw staleLeaseError();
    const updatedRun = await tx.loopRun.updateMany({
      where: {
        id: run.id,
        engineKind: "graph_v1",
        status: "running",
        version: run.version,
        projectionVersion: run.projectionVersion,
      },
      data: {
        status: "waiting",
        projectionVersion: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (updatedRun.count !== 1) throw staleLeaseError();

    await appendRuntimeEvents(tx, [runtimeEvent({
      eventType: "loop.node.waiting",
      aggregateType: "loop_node",
      aggregateId: input.nodeRunId,
      aggregateVersion: input.nodeRunVersion + 1,
      sequence: input.nodeRunVersion + 1,
      correlationId: input.correlationId,
      actor: input.actor,
      occurredAt: input.occurredAt,
      payload: {
        loopRunId: input.loopRunId,
        attemptId: input.attemptId,
        waitingReason: input.waitingReason,
        ...(input.waitingReason === "timer"
          ? { wakeAt: input.wakeAt.toISOString() }
          : input.waitingReason === "callback"
            ? { callbackId: input.callbackId }
            : { childLoopRunId: input.childLoopRunId }),
      },
    })]);
  });
}

type DerivedNodeTransition =
  | { status: "routed"; edge: LoopEdgeDefinition | null; targetNodeKey: string; counters: TransitionCounters; targetActivationNo: number }
  | { status: "exhausted"; edge: LoopEdgeDefinition | null; targetNodeKey: string; reason: TransitionExhaustionReason }
  | { status: "completed" };

type CalculatedNodeTransition =
  | { status: "routed"; edge: LoopEdgeDefinition | null; targetNodeKey: string; counters: TransitionCounters }
  | { status: "exhausted"; edge: LoopEdgeDefinition | null; targetNodeKey: string; reason: TransitionExhaustionReason }
  | { status: "completed" };

export async function completeLoopNode(
  input: CompleteLoopNodeInput,
  dependencies: RuntimeDependencies = DEFAULTS,
): Promise<void | { completed: boolean; duplicate: boolean }> {
  if (input.commandId !== undefined) {
    assertBoundedText(input.commandId, "Local result command id", 128);
  }
  const completed = await completeLoopNodeInternal(input, dependencies);
  return input.commandId === undefined
    ? undefined
    : { completed, duplicate: !completed };
}

export async function resumeWaitingLoopNode(
  input: ResumeWaitingLoopNodeInput,
  dependencies: RuntimeDependencies = DEFAULTS,
): Promise<{ completed: boolean; duplicate: boolean }> {
  assertBoundedText(input.commandId, "Wait resume command id", 128);
  if (input.waitingReason === "callback") {
    assertBoundedText(input.callbackId ?? "", "Wait callback id", 128);
    if (!input.secretHash || !/^[a-f0-9]{64}$/u.test(input.secretHash)) {
      throw validationError("Wait callback secret hash is invalid");
    }
    if (input.childLoopRunId !== undefined) throw validationError("Callback resume cannot include a child LoopRun id");
  } else if (input.waitingReason === "child_loop") {
    assertBoundedText(input.childLoopRunId ?? "", "Wait child LoopRun id", 96);
    if (input.callbackId !== undefined || input.secretHash !== undefined) {
      throw validationError("Child Loop resume cannot include callback credentials");
    }
  } else if (
    input.callbackId !== undefined
    || input.secretHash !== undefined
    || input.childLoopRunId !== undefined
  ) {
    throw validationError("Timer resume cannot include callback credentials");
  }
  const completed = await completeLoopNodeInternal({
    loopRunId: input.loopRunId,
    nodeRunId: input.nodeRunId,
    nodeRunVersion: input.nodeRunVersion,
    attemptId: input.attemptId,
    attemptNo: input.attemptNo,
    attemptVersion: input.attemptVersion,
    result: input.result,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    actor: input.actor,
    waitingResume: {
      commandId: input.commandId,
      waitingReason: input.waitingReason,
      ...(input.callbackId === undefined ? {} : { callbackId: input.callbackId }),
      ...(input.secretHash === undefined ? {} : { secretHash: input.secretHash }),
      ...(input.childLoopRunId === undefined ? {} : { childLoopRunId: input.childLoopRunId }),
    },
  }, dependencies);
  return { completed, duplicate: !completed };
}

interface ChildLoopResumeLookupDb {
  loopRun: Pick<PrismaClient["loopRun"], "findUnique">;
  loopNodeAttempt: Pick<PrismaClient["loopNodeAttempt"], "findUnique">;
  artifact: Pick<PrismaClient["artifact"], "findMany">;
}

export async function resumeParentAfterChildLoop(
  input: {
    childLoopRunId: string;
    occurredAt: Date;
    correlationId: string;
    actor: OrchestrationActor;
  },
  dependencies: {
    db: ChildLoopResumeLookupDb;
    resume: (input: ResumeWaitingLoopNodeInput) => Promise<{ completed: boolean; duplicate: boolean }>;
  } = {
    db: prisma,
    resume: (resumeInput) => resumeWaitingLoopNode(resumeInput),
  },
): Promise<{ resumed: boolean; duplicate: boolean }> {
  assertBoundedText(input.childLoopRunId, "Child LoopRun id", 96);
  assertValidDate(input.occurredAt, "Child Loop terminal time");
  const child = await dependencies.db.loopRun.findUnique({
    where: { id: input.childLoopRunId },
    select: {
      id: true,
      status: true,
      parentLoopRunId: true,
      parentNodeRunId: true,
      parentAttemptId: true,
    },
  });
  if (!child) throw validationError("Child LoopRun does not exist");
  const outcome = childLoopTerminalOutcome(child.status);
  if (!outcome) return { resumed: false, duplicate: false };
  const parentIdentity = [child.parentLoopRunId, child.parentNodeRunId, child.parentAttemptId];
  if (parentIdentity.every((value) => value === null)) return { resumed: false, duplicate: false };
  if (parentIdentity.some((value) => typeof value !== "string" || !value)) {
    throw validationError("Child LoopRun parent identity is incomplete");
  }
  const parentLoopRunId = child.parentLoopRunId as string;
  const parentNodeRunId = child.parentNodeRunId as string;
  const parentAttemptId = child.parentAttemptId as string;
  const attempt = await dependencies.db.loopNodeAttempt.findUnique({
    where: { id: parentAttemptId },
    select: {
      id: true,
      attempt: true,
      version: true,
      status: true,
      checkpoint: true,
      loopNodeRun: { select: { id: true, loopRunId: true, version: true, status: true } },
    },
  });
  if (
    !attempt
    || attempt.id !== parentAttemptId
    || attempt.status !== "waiting"
    || attempt.loopNodeRun.id !== parentNodeRunId
    || attempt.loopNodeRun.loopRunId !== parentLoopRunId
    || attempt.loopNodeRun.status !== "waiting_input"
    || !isPlainObject(attempt.checkpoint)
    || attempt.checkpoint.waitingReason !== "child_loop"
    || attempt.checkpoint.childLoopRunId !== child.id
  ) throw staleLeaseError();

  const reviewArtifacts = projectChildReviewArtifacts(await dependencies.db.artifact.findMany({
    where: {
      type: "review_html",
      mimeType: "text/html",
      loopNodeRun: { loopRunId: child.id },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      byteSize: true,
      metadata: true,
    },
  }));

  const resumed = await dependencies.resume({
    loopRunId: parentLoopRunId,
    nodeRunId: parentNodeRunId,
    nodeRunVersion: attempt.loopNodeRun.version,
    attemptId: parentAttemptId,
    attemptNo: attempt.attempt,
    attemptVersion: attempt.version,
    commandId: `child-loop:${child.id}:${child.status}`,
    waitingReason: "child_loop",
    childLoopRunId: child.id,
    result: {
      outcome,
      output: {
        childLoopRunId: child.id,
        childStatus: child.status,
        ...(reviewArtifacts.length === 0 ? {} : {
          reviewArtifacts: reviewArtifacts.map((artifact) => ({
            artifactId: artifact.id,
            fileName: artifact.fileName,
            mimeType: artifact.mimeType,
            byteSize: artifact.byteSize,
            checksum: artifact.checksum,
          })),
        }),
      },
      artifactRefs: reviewArtifacts.map((artifact) => artifact.storageKey),
      effectReceipts: [],
    },
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    actor: input.actor,
  });
  return { resumed: resumed.completed, duplicate: resumed.duplicate };
}

function projectChildReviewArtifacts(rows: Array<{
  id: string;
  storageKey: string;
  mimeType: string;
  byteSize: bigint | number;
  metadata: unknown;
}>): Array<{
  id: string;
  storageKey: string;
  fileName: string;
  mimeType: "text/html";
  byteSize: number;
  checksum: string;
}> {
  const projected: Array<{
    id: string;
    storageKey: string;
    fileName: string;
    mimeType: "text/html";
    byteSize: number;
    checksum: string;
  }> = [];
  const seenPaths = new Set<string>();
  for (const row of rows) {
    if (!isPlainObject(row.metadata)) continue;
    const relativePath = row.metadata.relativePath;
    const fileName = row.metadata.fileName;
    const checksum = row.metadata.checksum;
    const byteSize = typeof row.byteSize === "bigint" ? Number(row.byteSize) : row.byteSize;
    if (
      row.mimeType !== "text/html"
      || !/^[a-f0-9]{32}$/u.test(row.id)
      || typeof checksum !== "string"
      || !/^[a-f0-9]{64}$/u.test(checksum)
      || typeof relativePath !== "string"
      || !relativePath.startsWith("generated/reviews/")
      || typeof fileName !== "string"
      || !fileName
      || !Number.isSafeInteger(byteSize)
      || byteSize < 0
      || seenPaths.has(relativePath)
    ) continue;
    seenPaths.add(relativePath);
    projected.push({
      id: row.id,
      storageKey: row.storageKey,
      fileName,
      mimeType: "text/html",
      byteSize,
      checksum,
    });
  }
  return projected;
}

export async function retryFailedChildLoop(
  input: {
    childLoopRunId: string;
    commandId: string;
    targetNodeId?: string;
    occurredAt: Date;
    correlationId: string;
    actor: OrchestrationActor;
  },
  dependencies: { db: RuntimeDb } = DEFAULTS,
): Promise<{ parentLoopRunId: string; childLoopRunId: string; nodeRunId: string; activationNo: number; duplicate: boolean }> {
  assertBoundedText(input.childLoopRunId, "Child LoopRun id", 96);
  assertBoundedText(input.commandId, "Child Loop retry command id", 128);
  if (input.targetNodeId !== undefined) assertBoundedText(input.targetNodeId, "Child Loop recovery node id", 96);
  assertBoundedText(input.correlationId, "Child Loop retry correlation id", 128);
  assertValidDate(input.occurredAt, "Child Loop retry time");

  type RetryResult = Awaited<ReturnType<typeof retryFailedChildLoop>>;
  const readPersistedRetry = async (tx: RuntimeTx): Promise<RetryResult | null> => {
    const existing = await tx.orchestrationEvent.findUnique({
      where: { commandId_eventType: { commandId: input.commandId, eventType: "loop.child.retry_requested" } },
      select: { payload: true },
    });
    if (existing && isPlainObject(existing.payload)) {
      const parentLoopRunId = existing.payload.parentLoopRunId;
      const childLoopRunId = existing.payload.childLoopRunId ?? existing.payload.failedChildLoopRunId;
      const nodeRunId = existing.payload.nodeRunId;
      const activationNo = existing.payload.activationNo;
      const nodeKey = existing.payload.nodeKey;
      assertBoundedText(parentLoopRunId, "Retry parent LoopRun id", 96);
      assertBoundedText(childLoopRunId, "Retry child LoopRun id", 96);
      assertBoundedText(nodeRunId, "Retry node Run id", 96);
      if (nodeKey !== undefined) assertBoundedText(nodeKey, "Retry node key", 96);
      if (childLoopRunId !== input.childLoopRunId) {
        throw validationError("Child Loop retry command belongs to another LoopRun");
      }
      if (input.targetNodeId !== undefined && nodeKey !== undefined && nodeKey !== input.targetNodeId) {
        throw validationError("Child Loop retry command belongs to another recovery node");
      }
      if (input.targetNodeId !== undefined && nodeKey === undefined) {
        throw validationError("Legacy child Loop retry cannot verify its requested recovery node");
      }
      if (!Number.isInteger(activationNo) || (activationNo as number) < 1) {
        throw validationError("Retry activation number must be a positive integer");
      }
      return {
        parentLoopRunId,
        childLoopRunId,
        nodeRunId,
        activationNo: activationNo as number,
        duplicate: true,
      };
    }
    return null;
  };

  const execute = () => dependencies.db.$transaction(async (tx) => {
    const existing = await readPersistedRetry(tx);
    if (existing) return existing;

    const child = await tx.loopRun.findUnique({
      where: { id: input.childLoopRunId },
      select: {
        id: true,
        status: true,
        version: true,
        projectionVersion: true,
        finishedAt: true,
        loopVersionId: true,
        inputSnapshot: true,
        runGraphSnapshot: true,
        parentLoopRunId: true,
        parentNodeRunId: true,
        parentAttemptId: true,
      },
    });
    if (!child) throw validationError("Child LoopRun does not exist");
    if (!["failed", "exhausted", "cancelled"].includes(child.status)) {
      throw validationError("Only a stopped child LoopRun can be recovered");
    }
    if (!child.finishedAt) throw staleLeaseError();
    const parentIdentity = [child.parentLoopRunId, child.parentNodeRunId, child.parentAttemptId];
    if (parentIdentity.some((value) => typeof value !== "string" || !value)) {
      throw validationError("Child LoopRun parent identity is incomplete");
    }
    const parentLoopRunId = child.parentLoopRunId as string;
    const parentNodeRunId = child.parentNodeRunId as string;
    const parentAttemptId = child.parentAttemptId as string;
    const parentAttempt = await tx.loopNodeAttempt.findUnique({
      where: { id: parentAttemptId },
      select: {
        id: true,
        attempt: true,
        status: true,
        version: true,
        checkpoint: true,
        loopNodeRun: {
          select: {
            id: true,
            loopRunId: true,
            nodeKey: true,
            activationNo: true,
            status: true,
            version: true,
            inputSnapshot: true,
            loopRun: {
              select: {
                id: true,
                engineKind: true,
                status: true,
                version: true,
                projectionVersion: true,
              },
            },
          },
        },
      },
    });
    if (
      !parentAttempt
      || parentAttempt.status !== "waiting"
      || parentAttempt.loopNodeRun.id !== parentNodeRunId
      || parentAttempt.loopNodeRun.loopRunId !== parentLoopRunId
      || parentAttempt.loopNodeRun.status !== "waiting_input"
      || parentAttempt.loopNodeRun.loopRun.engineKind !== "graph_v1"
      || parentAttempt.loopNodeRun.loopRun.status !== "waiting"
      || !isPlainObject(parentAttempt.checkpoint)
      || parentAttempt.checkpoint.waitingReason !== "child_loop"
      || parentAttempt.checkpoint.childLoopRunId !== child.id
    ) throw staleLeaseError();

    const stoppedChildNode = await tx.loopNodeRun.findFirst({
      where: child.status === "failed"
        ? { loopRunId: child.id, status: "failed", finishedAt: child.finishedAt }
        : { loopRunId: child.id },
      orderBy: [{ activationNo: "desc" }, { id: "desc" }],
      select: {
        id: true,
        loopRunId: true,
        nodeKey: true,
        activationNo: true,
        status: true,
        finishedAt: true,
        inputSnapshot: true,
      },
    });
    if (!stoppedChildNode || stoppedChildNode.loopRunId !== child.id) throw staleLeaseError();
    const snapshot = parseChildRecoveryRunGraphSnapshot(child.runGraphSnapshot);
    if (!child.loopVersionId) throw validationError("Child Loop recovery graph snapshot is invalid");
    const childLoop = snapshot.loopVersions.find((version) => version.loopVersionId === child.loopVersionId);
    if (!childLoop) throw validationError("Child Loop recovery graph is absent from the run snapshot");
    const requestedNodeId = input.targetNodeId ?? stoppedChildNode.nodeKey;
    const targetNode = childLoop.graph.nodes.find((node) => node.key === requestedNodeId || stableNodeId(node) === requestedNodeId);
    if (!targetNode || targetNode.type === "start") throw validationError("Child Loop recovery node is outside the run snapshot");
    const targetNodeKey = targetNode.key;
    const latestTarget = targetNodeKey === stoppedChildNode.nodeKey
      ? stoppedChildNode
      : await tx.loopNodeRun.findFirst({
          where: { loopRunId: child.id, nodeKey: targetNodeKey },
          orderBy: [{ activationNo: "desc" }, { id: "desc" }],
          select: { activationNo: true, inputSnapshot: true },
        });
    const activationNo = (latestTarget?.activationNo ?? 0) + 1;
    const incomingEdgeIds = childLoop.graph.edges
      .filter((edge) => edge.target === targetNodeKey)
      .map((edge) => edge.id);
    const routedSource = incomingEdgeIds.length === 0
      ? null
      : await tx.loopNodeRun.findFirst({
          where: {
            loopRunId: child.id,
            status: "succeeded",
            selectedEdgeId: { in: incomingEdgeIds },
          },
          orderBy: [{ finishedAt: "desc" }, { activationNo: "desc" }, { id: "desc" }],
          select: { structuredOutput: true },
        });
    const recoveryInputSnapshot = routedSource?.structuredOutput
      ?? latestTarget?.inputSnapshot
      ?? child.inputSnapshot;
    const nodeRunId = buildNodeRunId(child.id, targetNodeKey, activationNo);
    const resumedRun = await tx.loopRun.updateMany({
      where: {
        id: child.id,
        engineKind: "graph_v1",
        status: child.status,
        version: child.version,
        projectionVersion: child.projectionVersion,
      },
      data: {
        status: "running",
        statusReason: null,
        stopReason: null,
        finishedAt: null,
        projectionVersion: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (resumedRun.count !== 1) throw staleLeaseError();
    await tx.loopNodeRun.create({
      data: {
        id: nodeRunId,
        loopRunId: child.id,
        nodeKey: targetNodeKey,
        activationNo,
        status: "ready",
        inputSnapshot: toPrismaJson(recoveryInputSnapshot),
        attemptCount: 0,
        version: 1,
        readyAt: input.occurredAt,
      },
    });
    const retryPayload = {
      parentLoopRunId,
      childLoopRunId: child.id,
      failedChildLoopRunId: child.id,
      previousNodeRunId: stoppedChildNode.id,
      nodeRunId,
      nodeKey: targetNodeKey,
      requestedNodeId,
      activationNo,
    };
    await appendRuntimeEvents(tx, [
      runtimeEvent({
        eventType: "loop.child.retry_requested",
        aggregateType: "run",
        aggregateId: child.id,
        aggregateVersion: child.version + 1,
        sequence: child.version + 1,
        correlationId: input.correlationId,
        commandId: input.commandId,
        actor: input.actor,
        occurredAt: input.occurredAt,
        payload: retryPayload,
      }),
      runtimeEvent({
        eventType: "loop.node.ready",
        aggregateType: "loop_node",
        aggregateId: nodeRunId,
        aggregateVersion: 1,
        sequence: 1,
        correlationId: input.correlationId,
        commandId: input.commandId,
        actor: input.actor,
        occurredAt: input.occurredAt,
        payload: { loopRunId: child.id, nodeKey: targetNodeKey, activationNo, recoveryOfNodeRunId: stoppedChildNode.id },
      }),
    ]);
    return { parentLoopRunId, childLoopRunId: child.id, nodeRunId, activationNo, duplicate: false };
  }, { isolationLevel: "Serializable" });

  try {
    return await execute();
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : null;
    if (code !== "stale_lease" && code !== "P2002" && code !== "P2034") throw error;
    const replay = await dependencies.db.$transaction((tx) => readPersistedRetry(tx), { isolationLevel: "Serializable" });
    if (replay) return replay;
    throw error;
  }
}

function childLoopTerminalOutcome(status: string): "success" | "failure" | null {
  if (status === "completed" || status === "succeeded") return "success";
  if (["failed", "exhausted", "cancelled", "rejected"].includes(status)) return "failure";
  return null;
}

interface LoopCallbackLookupDb {
  loopNodeAttempt: Pick<PrismaClient["loopNodeAttempt"], "findUnique">;
}

export async function resumeLoopCallback(
  input: {
    loopRunId: string;
    callbackId: string;
    commandId: string;
    secretHash: string;
    result: LoopNodeResult;
    occurredAt: Date;
    correlationId: string;
    actor: OrchestrationActor;
  },
  dependencies: {
    db: LoopCallbackLookupDb;
    resume: (input: ResumeWaitingLoopNodeInput) => Promise<{ completed: boolean; duplicate: boolean }>;
  } = {
    db: prisma,
    resume: (resumeInput) => resumeWaitingLoopNode(resumeInput),
  },
): Promise<{ completed: boolean; duplicate: boolean }> {
  assertBoundedText(input.loopRunId, "Callback LoopRun id", 96);
  assertBoundedText(input.callbackId, "Callback id", 128);
  const attempt = await dependencies.db.loopNodeAttempt.findUnique({
    where: { id: input.callbackId },
    select: {
      id: true,
      attempt: true,
      version: true,
      loopNodeRun: { select: { id: true, loopRunId: true, version: true } },
    },
  });
  if (!attempt || attempt.loopNodeRun.loopRunId !== input.loopRunId) {
    throw policyDenied("Loop callback credential is invalid");
  }
  return dependencies.resume({
    loopRunId: input.loopRunId,
    nodeRunId: attempt.loopNodeRun.id,
    nodeRunVersion: attempt.loopNodeRun.version,
    attemptId: attempt.id,
    attemptNo: attempt.attempt,
    attemptVersion: attempt.version,
    commandId: input.commandId,
    waitingReason: "callback",
    callbackId: input.callbackId,
    secretHash: input.secretHash,
    result: input.result,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    actor: input.actor,
  });
}

async function completeLoopNodeInternal(
  input: InternalCompleteLoopNodeInput,
  dependencies: RuntimeDependencies,
): Promise<boolean> {
  const result = parseLoopNodeResult(input.result);
  const gateDecision = input.gateDecision === undefined ? undefined : parseGateDecision(input.gateDecision);
  const localLease = input.agentRunId === undefined ? null : resolveLocalAgentRunLease(input);
  return dependencies.db.$transaction(async (tx) => {
    const serverNow = dependencies.now?.() ?? new Date();
    const attempt = await tx.loopNodeAttempt.findUnique({
      where: { id: input.attemptId },
      select: {
        id: true,
        loopNodeRunId: true,
        attempt: true,
        executorType: true,
        inputFingerprint: true,
        version: true,
        status: true,
        checkpoint: true,
        claimToken: true,
        claimExpiresAt: true,
        agentRunId: true,
        agentRun: { select: { checkpoint: true, lastEventSequence: true } },
        loopNodeRun: {
          select: {
            loopRunId: true,
            nodeKey: true,
            activationNo: true,
            version: true,
            status: true,
          },
        },
      },
    });
    const isLocalAttempt = input.agentRunId !== undefined;
    const waitingResume = input.waitingResume;
    const localResultFingerprint = input.commandId === undefined
      ? undefined
      : fingerprintJsonValue(result);
    const isLocalCompletedReplay = (
      isLocalAttempt
      && input.commandId !== undefined
      && attempt
      && attempt.loopNodeRunId === input.nodeRunId
      && attempt.loopNodeRun.loopRunId === input.loopRunId
      && attempt.attempt === input.attemptNo
      && attempt.executorType === "local"
      && attempt.agentRunId === input.agentRunId
      && (attempt.status === "succeeded" || attempt.status === "failed" || attempt.status === "blocked")
      && isPlainObject(attempt.checkpoint)
      && attempt.checkpoint.completedCommandId === input.commandId
    );
    if (isLocalCompletedReplay) {
      const completedAgentRunId = input.agentRunId;
      const completedCheckpoint = attempt.checkpoint;
      if (completedAgentRunId === undefined || !isPlainObject(completedCheckpoint)) {
        throw staleLeaseError();
      }
      const completedRun = await tx.agentRun.findUnique({
        where: { id: completedAgentRunId },
        select: {
          id: true,
          taskId: true,
          loopRunId: true,
          loopNodeRunId: true,
          attempt: true,
          workerId: true,
          linuxWorkerPoolSessionId: true,
          leaseGeneration: true,
          status: true,
        },
      });
      if (
        !completedRun
        || completedRun.taskId !== null
        || completedRun.loopRunId !== input.loopRunId
        || completedRun.loopNodeRunId !== input.nodeRunId
        || completedRun.attempt !== input.attemptNo
        || !matchesLocalAgentRunLease(completedRun, localLease)
        || completedRun.leaseGeneration !== input.leaseGeneration
        || completedRun.status !== (attempt.status === "blocked" ? "failed" : attempt.status)
      ) throw staleLeaseError();
      if (completedCheckpoint.resultFingerprint !== localResultFingerprint) {
        throw validationError("Local result command was already completed with different content");
      }
      if (result.outcome === "failure") {
        const duplicateDecision = decideLoopFailure({ result, attemptNo: input.attemptNo });
        (dependencies.recordFailureDecision ?? console.info)("loop_failure_decision", {
          loopRunId: input.loopRunId,
          loopNodeRunId: input.nodeRunId,
          attemptId: input.attemptId,
          commandId: input.commandId,
          failureFingerprint: localResultFingerprint,
          category: duplicateDecision.category,
          code: duplicateDecision.code,
          proposedDisposition: duplicateDecision.disposition,
          appliedDisposition: duplicateDecision.disposition,
          duplicateSuppressed: true,
        });
      }
      return false;
    }
    const isCompletedReplay = (
      waitingResume
      && attempt
      && attempt.loopNodeRunId === input.nodeRunId
      && attempt.loopNodeRun.loopRunId === input.loopRunId
      && attempt.attempt === input.attemptNo
      && attempt.executorType === "platform"
      && attempt.agentRunId === null
      && (attempt.status === "succeeded" || attempt.status === "failed")
      && isPlainObject(attempt.checkpoint)
      && attempt.checkpoint.completedCommandId === waitingResume.commandId
      && attempt.checkpoint.waitingReason === waitingResume.waitingReason
    );
    if (isCompletedReplay) {
      if (!isValidWaitingResume(attempt.checkpoint, waitingResume, serverNow)) throw staleLeaseError();
      return false;
    }
    const hasValidCompletionAuthority = (() => {
      if (!attempt) return false;
      if (waitingResume) {
        return !isLocalAttempt
          && attempt.executorType === "platform"
          && attempt.agentRunId === null
          && isValidWaitingResume(attempt.checkpoint, waitingResume, serverNow);
      }
      if (isLocalAttempt) {
        return attempt.executorType === "local" && attempt.agentRunId === input.agentRunId;
      }
      return attempt.executorType === "platform"
        && attempt.agentRunId === null
        && input.claimToken !== undefined
        && attempt.claimToken === input.claimToken
        && attempt.claimExpiresAt !== null
        && attempt.claimExpiresAt > serverNow;
    })();
    if (
      !attempt
      || attempt.loopNodeRunId !== input.nodeRunId
      || attempt.loopNodeRun.loopRunId !== input.loopRunId
      || attempt.loopNodeRun.version !== input.nodeRunVersion
      || attempt.loopNodeRun.status !== (waitingResume ? "waiting_input" : "running")
      || attempt.attempt !== input.attemptNo
      || attempt.version !== input.attemptVersion
      || attempt.status !== (waitingResume ? "waiting" : "running")
      || !hasValidCompletionAuthority
    ) throw staleLeaseError();

    const run = await tx.loopRun.findUnique({
      where: { id: input.loopRunId },
      select: {
        id: true,
        projectId: true,
        taskId: true,
        policySnapshot: true,
        engineKind: true,
        loopVersionId: true,
        status: true,
        version: true,
        projectionVersion: true,
        transitionCount: true,
        repeatCount: true,
        usageAggregate: true,
        budgetSnapshot: true,
        runGraphSnapshot: true,
        graphDigest: true,
        snapshotVersion: true,
        loopVersion: {
          select: {
            id: true,
            graph: true,
            maxStages: true,
            maxRepeatCount: true,
            platformMaxTransitions: true,
          },
        },
        task: { select: { assigneeUserId: true, createdById: true } },
      },
    });
    if (
      !run
      || run.engineKind !== "graph_v1"
      || run.status !== (waitingResume ? "waiting" : "running")
      || !run.loopVersionId
      || run.loopVersion?.id !== run.loopVersionId
    ) throw staleLeaseError();

    const graph = parsePublishedLoopVersionGraph(run.loopVersion.graph);
    const currentNode = graph.nodes.find((node) => node.key === attempt.loopNodeRun.nodeKey);
    if (!currentNode) throw validationError("Persisted NodeRun is not present in its immutable LoopVersion graph");
    const counters = parseTransitionCounters(run.usageAggregate);
    if (counters.transitions !== run.transitionCount || counters.repeats !== run.repeatCount) {
      throw validationError("Persisted LoopRun counters disagree with the usage snapshot");
    }
    const budget = parseRuntimeBudget(run.budgetSnapshot);
    const limits = {
      maxRepeatCount: Math.min(
        budget.maxRepeatCount,
        run.loopVersion.maxRepeatCount,
        graph.limits.maxRepeatCount,
        20,
      ),
      maxTransitions: Math.min(
        budget.maxTransitions,
        run.loopVersion.platformMaxTransitions,
        calculateMaxTransitions(graph),
        1_024,
      ),
    };
    let agentRoutedTransition: CalculatedNodeTransition | undefined;
    if (input.routeDecision !== undefined) {
      try {
        agentRoutedTransition = deriveAgentRouteTransition({
          graph,
          node: currentNode,
          loopVersionId: run.loopVersionId,
          routeDecision: input.routeDecision,
          runGraphSnapshot: run.runGraphSnapshot,
          graphDigest: run.graphDigest,
          counters,
          limits,
        });
      } catch (error) {
        if (result.outcome !== "failure") throw error;
      }
    }
    let failureDecision: FailureDecision | null = null;
    let proposedFailureDecision: FailureDecision | null = null;
    let shadowFailureDecision = false;
    const failureRollout = dependencies.failureDecisionRollout ?? getLoopFailureDecisionRollout();
    const nodeRetryPolicy = recordValue(currentNode).retryPolicy;
    const nodeMaxRetries = isPlainObject(nodeRetryPolicy) && typeof nodeRetryPolicy.maxRetries === "number"
      ? nodeRetryPolicy.maxRetries
      : undefined;
    if (result.outcome === "failure" && agentRoutedTransition === undefined) {
      const feedbackEdge = graph.edges.find((edge) => (
        edge.source === currentNode.key
        && edge.kind === "feedback"
        && edge.outcome === "rework"
        && edge.target !== currentNode.key
      ));
      proposedFailureDecision = decideLoopFailure({
        result,
        attemptNo: input.attemptNo,
        ...(graph.retryPolicy?.maxRetries === undefined ? {} : { loopMaxRetries: graph.retryPolicy.maxRetries }),
        ...(nodeMaxRetries === undefined ? {} : { nodeMaxRetries }),
        ...(feedbackEdge === undefined ? {} : {
          feedbackRoute: {
            edgeId: feedbackEdge.id,
            targetNodeId: feedbackEdge.target,
            currentNodeId: currentNode.key,
          },
        }),
      });
      const rolledOut = rolledOutFailureDecision(proposedFailureDecision, failureRollout);
      failureDecision = rolledOut.applied;
      shadowFailureDecision = rolledOut.shadow;
      if (failureDecision.disposition === "route_rework" && feedbackEdge) {
        const budget = applyTransitionBudget({ counters, edge: feedbackEdge, limits });
        agentRoutedTransition = budget.ok
          ? { status: "routed", edge: feedbackEdge, targetNodeKey: feedbackEdge.target, counters: budget.counters }
          : { status: "exhausted", edge: feedbackEdge, targetNodeKey: feedbackEdge.target, reason: budget.reason };
      }
    }
    const routedFailure = result.outcome === "failure"
      && agentRoutedTransition !== undefined
      && agentRoutedTransition.status !== "completed"
      && agentRoutedTransition.targetNodeKey !== currentNode.key;

    // Dynamic checklists are execution evidence, not a second execution
    // authority. A provider can finish a turn before it has made its final
    // MCP checklist calls. In that case, close only the unresolved items as
    // skipped in this same transaction, rather than rejecting the terminal
    // result and letting a healthy Worker lease expire.
    let checklistSuccessEndSequence: number | undefined;
    if (result.outcome === "success" && !routedFailure && input.agentRunId !== undefined && input.leaseGeneration !== undefined) {
      const checklist = await loadLoopChecklistState(tx, input.nodeRunId, {
        loopRunId: input.loopRunId,
        loopNodeRunId: input.nodeRunId,
        loopNodeAttemptId: input.attemptId,
        attemptNo: input.attemptNo,
        leaseGeneration: input.leaseGeneration,
      });
      if (checklist) {
        const closure = evaluateLoopChecklistClosure([...checklist.values()]);
        if (!closure.closed) {
          const updates = buildChecklistSuccessFinalizationUpdates([...checklist.values()]);
          // A malformed historic checklist with terminal items lacking a
          // reason is still a data-validation issue; only unfinished work is
          // safe to finalize automatically.
          if (closure.reason === "missing_reason") {
            throw validationError(
              `Loop checklist has terminal items without reasons (${closure.incompleteItemIds.join(", ")})`,
            );
          }
          const baseSequence = attempt.agentRun?.lastEventSequence ?? 0;
          if (updates.length > 0) {
            await appendRuntimeEvents(tx, updates.map((update, index) => runtimeEvent({
              eventType: "loop.checklist.updated",
              aggregateType: "loop_node",
              aggregateId: input.nodeRunId,
              aggregateVersion: input.nodeRunVersion + index + 1,
              sequence: input.nodeRunVersion + index + 1,
              correlationId: input.correlationId,
              causationId: input.attemptId,
              actor: input.actor,
              occurredAt: input.occurredAt,
              payload: {
                clientSequence: baseSequence + index + 1,
                payloadSummary: {
                  loopRunId: input.loopRunId,
                  loopNodeRunId: input.nodeRunId,
                  loopNodeAttemptId: input.attemptId,
                  attemptNo: input.attemptNo,
                  leaseGeneration: input.leaseGeneration,
                  itemId: update.itemId,
                  status: update.status,
                  reason: update.reason,
                  evidenceRefs: update.evidenceRefs,
                },
              },
            })));
            checklistSuccessEndSequence = baseSequence + updates.length;
          }
        }
      }
    }

    if (result.outcome === "failure" && !routedFailure) {
      const decision = failureDecision ?? decideLoopFailure({
        result,
        attemptNo: input.attemptNo,
        ...(graph.retryPolicy?.maxRetries === undefined ? {} : { loopMaxRetries: graph.retryPolicy.maxRetries }),
        ...(nodeMaxRetries === undefined ? {} : { nodeMaxRetries }),
      });
      const intervention = decision.disposition === "open_intervention";
      const terminate = decision.disposition === "terminate";
      const proposedDecision = proposedFailureDecision ?? decision;
      let checklistFailureEndSequence: number | undefined;

      // A terminal Worker failure must close any provider-created checklist
      // items that were left in progress. Persist these synthetic updates
      // before releasing the lease so the run viewer has a truthful terminal
      // state even when Codex never called the final MCP update.
      if (input.agentRunId !== undefined && input.leaseGeneration !== undefined) {
        const checklist = await loadLoopChecklistState(tx, input.nodeRunId, {
          loopRunId: input.loopRunId,
          loopNodeRunId: input.nodeRunId,
          loopNodeAttemptId: input.attemptId,
          attemptNo: input.attemptNo,
          leaseGeneration: input.leaseGeneration,
        });
        if (checklist) {
          const updates = buildChecklistFailureUpdates(
            [...checklist.values()],
            result.failure?.code ?? proposedDecision.code,
          );
          const baseSequence = attempt.agentRun?.lastEventSequence ?? 0;
          if (updates.length > 0) {
            await appendRuntimeEvents(tx, updates.map((update, index) => runtimeEvent({
              eventType: "loop.checklist.updated",
              aggregateType: "loop_node",
              aggregateId: input.nodeRunId,
              aggregateVersion: input.nodeRunVersion + index + 1,
              sequence: input.nodeRunVersion + index + 1,
              correlationId: input.correlationId,
              causationId: input.attemptId,
              actor: input.actor,
              occurredAt: input.occurredAt,
              payload: {
                clientSequence: baseSequence + index + 1,
                payloadSummary: {
                  loopRunId: input.loopRunId,
                  loopNodeRunId: input.nodeRunId,
                  loopNodeAttemptId: input.attemptId,
                  attemptNo: input.attemptNo,
                  leaseGeneration: input.leaseGeneration,
                  itemId: update.itemId,
                  status: update.status,
                  reason: update.reason,
                  evidenceRefs: update.evidenceRefs,
                },
              },
            })));
            checklistFailureEndSequence = baseSequence + updates.length;
          }
        }
      }

      if (input.agentRunId !== undefined) {
        if (!localLease || input.leaseGeneration === undefined) throw staleLeaseError();
        const agentRun = await tx.agentRun.updateMany({
          where: {
            id: input.agentRunId,
            loopRunId: input.loopRunId,
            loopNodeRunId: input.nodeRunId,
            attempt: input.attemptNo,
            ...localLease.where,
            leaseGeneration: input.leaseGeneration,
            status: { in: ["claimed", "starting", "running", "waiting_approval"] },
            leaseExpiresAt: { gt: serverNow },
          },
          data: {
            status: "failed",
            structuredResult: toPrismaJson(result),
            finishedAt: input.occurredAt,
            ...(checklistFailureEndSequence === undefined ? {} : { lastEventSequence: checklistFailureEndSequence }),
            version: { increment: 1 },
          },
        });
        if (agentRun.count !== 1) throw staleLeaseError();
        if (localLease.desktopWorkerId) {
          const releasedCapacity = await tx.agentWorker.updateMany({
            where: { id: localLease.desktopWorkerId, activeRunCount: { gt: 0 } },
            data: { activeRunCount: { decrement: 1 } },
          });
          if (releasedCapacity.count !== 1) throw staleLeaseError();
        }
      }

      const failedAttempt = await tx.loopNodeAttempt.updateMany({
        where: {
          id: input.attemptId,
          loopNodeRunId: input.nodeRunId,
          attempt: input.attemptNo,
          version: input.attemptVersion,
          status: waitingResume ? "waiting" : "running",
          ...(waitingResume
            ? { executorType: "platform", agentRunId: null }
            : input.agentRunId === undefined
            ? { claimToken: input.claimToken ?? "", claimExpiresAt: { gt: serverNow } }
            : { agentRunId: input.agentRunId }),
        },
        data: {
          status: intervention ? "blocked" : "failed",
          ...((input.commandId === undefined && waitingResume === undefined)
            ? {}
            : {
                checkpoint: toPrismaJson({
                  ...(isPlainObject(attempt.checkpoint) ? attempt.checkpoint : {}),
                  completedCommandId: input.commandId ?? waitingResume?.commandId,
                  ...(input.commandId === undefined ? {} : { resultFingerprint: localResultFingerprint }),
                  completedAt: input.occurredAt.toISOString(),
                }),
              }),
          result: toPrismaJson(result),
          error: toPrismaJson(result.output),
          outputFingerprint: fingerprintJsonValue(result.output),
          finishedAt: input.occurredAt,
          version: { increment: 1 },
        },
      });
      if (failedAttempt.count !== 1) throw staleLeaseError();

      const failedNode = await tx.loopNodeRun.updateMany({
        where: {
          id: input.nodeRunId,
          loopRunId: input.loopRunId,
          version: input.nodeRunVersion,
          status: waitingResume ? "waiting_input" : "running",
        },
        data: {
          status: intervention ? "waiting_intervention" : terminate ? "failed" : "ready",
          selectedExecutionTarget: null,
          waitingReason: intervention ? `runtime_intervention:${decision.code}` : terminate ? null : "retry_scheduled",
          selectedEdgeId: null,
          ...(intervention || terminate
            ? { structuredOutput: toPrismaJson(result.output), finishedAt: input.occurredAt }
            : { readyAt: input.occurredAt, startedAt: null, finishedAt: null }),
          version: { increment: 1 },
        },
      });
      if (failedNode.count !== 1) throw staleLeaseError();

      const retryContinuation = decision.disposition === "retry_attempt"
        ? {
            id: buildLoopNodeAttemptId(input.nodeRunId, decision.nextAttemptNo),
            attemptNo: decision.nextAttemptNo,
          }
        : null;
      if (retryContinuation) {
        await tx.loopNodeAttempt.create({
          data: {
            id: retryContinuation.id,
            loopNodeRunId: input.nodeRunId,
            attempt: retryContinuation.attemptNo,
            executorType: attempt.executorType,
            status: SCHEDULED_ATTEMPT_STATUS,
            inputFingerprint: attempt.inputFingerprint,
            checkpoint: toPrismaJson({
              scheduledBy: input.attemptId,
              reasonCode: decision.reasonCode,
              failureFingerprint: localResultFingerprint ?? fingerprintJsonValue(result),
            }),
            version: 1,
          },
        });
      }

      const failedRun = await tx.loopRun.updateMany({
        where: {
          id: run.id,
          engineKind: "graph_v1",
          loopVersionId: run.loopVersionId,
          status: run.status,
          version: run.version,
          projectionVersion: run.projectionVersion,
          transitionCount: run.transitionCount,
          repeatCount: run.repeatCount,
        },
        data: {
          ...(intervention
            ? {
                status: "waiting",
                statusReason: `intervention:${decision.code}`,
              }
            : terminate
            ? {
                status: "failed",
                statusReason: decision.reasonCode,
                stopReason: decision.reasonCode,
                finishedAt: input.occurredAt,
              }
            : { status: "running" }),
          projectionVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (failedRun.count !== 1) throw staleLeaseError();

      await appendRuntimeEvents(tx, [runtimeEvent({
        eventType: "loop.failure.classified",
        aggregateType: "loop_node",
        aggregateId: input.nodeRunId,
        aggregateVersion: input.nodeRunVersion + 1,
        sequence: input.nodeRunVersion + 1,
        correlationId: input.correlationId,
        causationId: input.attemptId,
        ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
        actor: input.actor,
        occurredAt: input.occurredAt,
        payload: {
          loopRunId: input.loopRunId,
          nodeKey: attempt.loopNodeRun.nodeKey,
          activationNo: attempt.loopNodeRun.activationNo,
          attemptId: input.attemptId,
          code: proposedDecision.code,
          category: proposedDecision.category,
          disposition: decision.disposition,
          proposedDisposition: proposedDecision.disposition,
          shadow: shadowFailureDecision,
          reasonCode: decision.reasonCode,
          attemptNo: decision.attemptNo,
          maxRetries: decision.maxRetries,
          ...(decision.disposition === "retry_attempt"
            ? { nextAttemptNo: retryContinuation?.attemptNo, nextAttemptId: retryContinuation?.id }
            : {}),
        },
      }), runtimeEvent({
        eventType: intervention ? "loop.node.waiting_intervention" : terminate ? "loop.node.failed" : "loop.node.ready",
        aggregateType: "loop_node",
        aggregateId: input.nodeRunId,
        aggregateVersion: input.nodeRunVersion + 1,
        sequence: input.nodeRunVersion + 1,
        correlationId: input.correlationId,
        causationId: input.attemptId,
        actor: input.actor,
        occurredAt: input.occurredAt,
        payload: {
          loopRunId: input.loopRunId,
          nodeKey: attempt.loopNodeRun.nodeKey,
          activationNo: attempt.loopNodeRun.activationNo,
          attemptId: input.attemptId,
          reason: intervention ? `intervention:${decision.code}` : terminate ? decision.reasonCode : "retry_scheduled",
        },
      })]);

      if (decision.disposition === "retry_attempt") {
        await tx.outboxMessage.createMany({
          data: [{
            id: boundedPersistenceId("loop-retry", [input.nodeRunId, String(decision.nextAttemptNo)], 128),
            topic: "loop.node.retry",
            aggregateType: "loop_node",
            aggregateId: input.nodeRunId,
            payload: toPrismaJson({
              loopRunId: input.loopRunId,
              nodeRunId: input.nodeRunId,
              nodeKey: attempt.loopNodeRun.nodeKey,
              activationNo: attempt.loopNodeRun.activationNo,
              failedAttemptId: input.attemptId,
              nextAttemptNo: decision.nextAttemptNo,
              nextAttemptId: retryContinuation?.id,
              reasonCode: decision.reasonCode,
            }),
            availableAt: input.occurredAt,
          }],
        });
      }

      let interventionInteractionId: string | null = null;
      if (intervention && run.projectId) {
        const interactionKind = "runtime_intervention" as const;
        const existingInteraction = await tx.workflowInteraction.findUnique({
          where: {
            loopNodeRunId_activationNo_kind: {
              loopNodeRunId: input.nodeRunId,
              activationNo: attempt.loopNodeRun.activationNo,
              kind: interactionKind,
            },
          },
          select: { id: true },
        });
        interventionInteractionId = existingInteraction?.id ?? null;
        if (!existingInteraction) {
          const opened = await createWorkflowInteractionRecord({
            command: {
              commandId: input.commandId ?? `failure:${input.attemptId}`,
              correlationId: input.correlationId,
              causationId: input.attemptId,
              actor: input.actor,
              payload: { decision },
              issuedAt: input.occurredAt,
            },
            projectId: run.projectId,
            taskId: run.taskId ?? null,
            loopRunId: input.loopRunId,
            loopNodeRunId: input.nodeRunId,
            activationNo: attempt.loopNodeRun.activationNo,
            kind: interactionKind,
            policySnapshot: { failureCode: decision.code, category: decision.category },
          }, tx as never);
          interventionInteractionId = opened.result.id;
          await appendRuntimeEvents(tx, opened.events);
        }
        const recipientUserId = run.task?.assigneeUserId
          ?? run.task?.createdById
          ?? (input.actor.type === "user" ? input.actor.id : null);
        if (recipientUserId) {
          await createLoopNotificationIntentInTransaction({
            projectId: run.projectId,
            loopRunId: input.loopRunId,
            loopNodeRunId: input.nodeRunId,
            recipientUserId,
            eventType: "loop.intervention.required",
            title: "Loop 需要人工介入",
            description: decision.reasonCode,
            occurredAt: input.occurredAt,
            dedupeKey: `loop-intervention:${input.nodeRunId}:${attempt.loopNodeRun.activationNo}:${decision.code}`,
            templateData: { code: decision.code, category: decision.category },
          }, tx as never);
        }
      }
      (dependencies.recordFailureDecision ?? console.info)("loop_failure_decision", {
        loopRunId: input.loopRunId,
        loopNodeRunId: input.nodeRunId,
        attemptId: input.attemptId,
        ...(interventionInteractionId ? { interactionId: interventionInteractionId } : {}),
        ...(input.commandId ? { commandId: input.commandId } : {}),
        failureFingerprint: localResultFingerprint ?? fingerprintJsonValue(result),
        category: proposedDecision.category,
        code: proposedDecision.code,
        proposedDisposition: proposedDecision.disposition,
        appliedDisposition: decision.disposition,
        duplicateSuppressed: false,
      });
      return true;
    }
    if (!routedFailure) {
      const outputValidation = validateJsonSchemaValue(currentNode.outputSchema, result.output);
      if (!outputValidation.ok) {
        throw validationError(`Loop node result output does not match outputSchema: ${outputValidation.errors.join("; ")}`);
      }
    }
    const routedTransition = agentRoutedTransition
      ?? deriveNodeTransition({
          graph,
          node: currentNode,
          result,
          ...(gateDecision === undefined ? {} : { gateDecision }),
          counters,
          limits,
        });
    let transition: DerivedNodeTransition;
    if (routedTransition.status === "routed") {
      const latestTarget = await tx.loopNodeRun.findFirst({
        where: { loopRunId: run.id, nodeKey: routedTransition.targetNodeKey },
        orderBy: { activationNo: "desc" },
        select: { activationNo: true },
      });
      transition = { ...routedTransition, targetActivationNo: (latestTarget?.activationNo ?? 0) + 1 };
    } else {
      transition = routedTransition;
    }

    if (input.agentRunId !== undefined) {
      if (!localLease || input.leaseGeneration === undefined) throw staleLeaseError();
      const agentRun = await tx.agentRun.updateMany({
        where: {
          id: input.agentRunId,
          loopRunId: input.loopRunId,
          loopNodeRunId: input.nodeRunId,
          attempt: input.attemptNo,
          ...localLease.where,
          leaseGeneration: input.leaseGeneration,
          status: { in: ["claimed", "starting", "running", "waiting_approval"] },
          leaseExpiresAt: { gt: serverNow },
        },
        data: {
          status: routedFailure ? "failed" : "succeeded",
          structuredResult: toPrismaJson(result),
          ...(input.routeDecision === undefined ? {} : {
            checkpoint: toPrismaJson({
              ...recordValue(attempt.agentRun?.checkpoint),
              routeDecisionId: localRouteDecisionId(input.routeDecision),
            }),
          }),
          finishedAt: input.occurredAt,
          ...(checklistSuccessEndSequence === undefined ? {} : { lastEventSequence: checklistSuccessEndSequence }),
          version: { increment: 1 },
        },
      });
      if (agentRun.count !== 1) throw staleLeaseError();
      if (localLease.desktopWorkerId) {
        const releasedCapacity = await tx.agentWorker.updateMany({
          where: {
            id: localLease.desktopWorkerId,
            activeRunCount: { gt: 0 },
          },
          data: { activeRunCount: { decrement: 1 } },
        });
        if (releasedCapacity.count !== 1) throw staleLeaseError();
      }
    }
    const updatedAttempt = await tx.loopNodeAttempt.updateMany({
      where: {
        id: input.attemptId,
        loopNodeRunId: input.nodeRunId,
        attempt: input.attemptNo,
        version: input.attemptVersion,
        status: waitingResume ? "waiting" : "running",
        ...(waitingResume
          ? { executorType: "platform", agentRunId: null }
          : input.agentRunId === undefined
          ? { claimToken: input.claimToken ?? "", claimExpiresAt: { gt: serverNow } }
          : { agentRunId: input.agentRunId }),
      },
      data: {
        status: routedFailure ? "failed" : "succeeded",
        ...(input.commandId === undefined
          ? {}
          : {
              checkpoint: toPrismaJson({
                ...(isPlainObject(attempt.checkpoint) ? attempt.checkpoint : {}),
                completedCommandId: input.commandId,
                resultFingerprint: localResultFingerprint,
                ...(input.routeDecision === undefined ? {} : { routeDecisionId: localRouteDecisionId(input.routeDecision) }),
                completedAt: input.occurredAt.toISOString(),
              }),
            }),
        ...(waitingResume
          ? {
              checkpoint: toPrismaJson({
                ...(isPlainObject(attempt.checkpoint) ? attempt.checkpoint : {}),
                completedCommandId: waitingResume.commandId,
                completedAt: input.occurredAt.toISOString(),
              }),
            }
          : {}),
        result: toPrismaJson(result),
        ...(routedFailure ? { error: toPrismaJson(result.output) } : {}),
        outputFingerprint: fingerprintJsonValue(result.output),
        finishedAt: input.occurredAt,
        version: { increment: 1 },
      },
    });
    if (updatedAttempt.count !== 1) throw staleLeaseError();

    const updatedNode = await tx.loopNodeRun.updateMany({
      where: {
        id: input.nodeRunId,
        loopRunId: input.loopRunId,
        version: input.nodeRunVersion,
        status: waitingResume ? "waiting_input" : "running",
      },
      data: {
        status: routedFailure ? "failed" : "succeeded",
        ...(input.linuxWorkerPoolSessionId === undefined
          ? {}
          : { selectedExecutionTarget: "linux_worker_pool" }),
        structuredOutput: toPrismaJson(result.output),
        ...(gateDecision === undefined ? {} : { gateDecision: toPrismaJson(gateDecision) }),
        ...(transition.status === "completed" ? {} : { selectedEdgeId: transition.edge?.id ?? null }),
        finishedAt: input.occurredAt,
        version: { increment: 1 },
      },
    });
    if (updatedNode.count !== 1) throw staleLeaseError();

    const updatedRun = await tx.loopRun.updateMany({
      where: {
        id: run.id,
        engineKind: "graph_v1",
        loopVersionId: run.loopVersionId,
        status: run.status,
        version: run.version,
        projectionVersion: run.projectionVersion,
        transitionCount: run.transitionCount,
        repeatCount: run.repeatCount,
      },
      data: {
        ...(transition.status === "routed"
          ? {
              status: "running",
              transitionCount: transition.counters.transitions,
              repeatCount: transition.counters.repeats,
              usageAggregate: toPrismaJson(transition.counters),
            }
          : transition.status === "exhausted"
            ? {
                status: "exhausted",
                statusReason: transition.reason,
                stopReason: transition.reason,
                finishedAt: input.occurredAt,
              }
            : { status: "completed", finishedAt: input.occurredAt }),
        projectionVersion: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (updatedRun.count !== 1) throw staleLeaseError();
    if (transition.status === "routed") {
      await tx.loopNodeRun.create({
        data: {
          id: buildNodeRunId(input.loopRunId, transition.targetNodeKey, transition.targetActivationNo),
          loopRunId: input.loopRunId,
          nodeKey: transition.targetNodeKey,
          activationNo: transition.targetActivationNo,
          status: "ready",
          inputSnapshot: toPrismaJson(result.output),
          attemptCount: 0,
          version: 1,
          readyAt: input.occurredAt,
        },
      });
    }
    const completionEvents = [runtimeEvent({
      eventType: routedFailure ? "loop.node.failed" : "loop.node.completed",
      aggregateType: "loop_node",
      aggregateId: input.nodeRunId,
      aggregateVersion: input.nodeRunVersion + 1,
      sequence: input.nodeRunVersion + 1,
      correlationId: input.correlationId,
      actor: input.actor,
      occurredAt: input.occurredAt,
      payload: { loopRunId: input.loopRunId, attemptId: input.attemptId, transition },
    })];
    if (input.routeDecision !== undefined) {
      const routeDecision = localRouteDecisionSchema.parse(input.routeDecision);
      completionEvents.push(runtimeEvent({
        eventType: "loop.agent.route_decided",
        aggregateType: "loop_node",
        aggregateId: input.nodeRunId,
        aggregateVersion: input.nodeRunVersion + 1,
        sequence: input.nodeRunVersion + 1,
        correlationId: input.correlationId,
        causationId: input.attemptId,
        ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
        actor: input.actor,
        occurredAt: input.occurredAt,
        payload: {
          loopRunId: input.loopRunId,
          loopNodeRunId: input.nodeRunId,
          sourceNodeId: routeDecision.fromNodeId,
          targetNodeId: routeDecision.nextNodeId,
          decisionId: routeDecision.decisionId,
          reasonCode: routeDecision.reasonCode,
          summary: routeDecision.summary,
          evidence: routeDecision.evidence,
          confidence: routeDecision.confidence,
          routerContractVersion: routeDecision.routerContractVersion,
          routerContractDigest: routeDecision.routerContractDigest,
          selectedEdgeId: transition.status === "routed" ? transition.edge?.id ?? null : null,
        },
      }));
    }
    await appendRuntimeEvents(tx, completionEvents);
    return true;
  });
}

type LocalAgentRunLease = {
  desktopWorkerId?: string;
  linuxWorkerPoolSessionId?: string;
  where: { workerId: string | null; linuxWorkerPoolSessionId?: string };
};

function resolveLocalAgentRunLease(input: Pick<CompleteLoopNodeInput, "workerId" | "linuxWorkerPoolSessionId">): LocalAgentRunLease {
  const workerId = input.workerId?.trim();
  const sessionId = input.linuxWorkerPoolSessionId?.trim();
  if (Boolean(workerId) === Boolean(sessionId)) throw staleLeaseError();
  if (sessionId) {
    if (!/^[a-f0-9]{32}$/u.test(sessionId)) throw staleLeaseError();
    return {
      linuxWorkerPoolSessionId: sessionId,
      where: { workerId: null, linuxWorkerPoolSessionId: sessionId },
    };
  }
  return {
    desktopWorkerId: workerId as string,
    where: { workerId: workerId as string },
  };
}

function matchesLocalAgentRunLease(
  run: { workerId: string | null; linuxWorkerPoolSessionId: string | null },
  lease: LocalAgentRunLease | null,
): boolean {
  if (!lease) return false;
  return lease.linuxWorkerPoolSessionId !== undefined
    ? run.workerId === null && run.linuxWorkerPoolSessionId === lease.linuxWorkerPoolSessionId
    : run.workerId === lease.desktopWorkerId && run.linuxWorkerPoolSessionId === null;
}

export async function appendLoopAttemptEvents(
  input: {
    agentRunId: string;
    attemptId: string;
    workerId?: string;
    linuxWorkerPoolSessionId?: string;
    leaseGeneration: number;
    events: LoopAgentEvent[];
  },
  dependencies: RuntimeDependencies = DEFAULTS,
): Promise<void> {
  const leaseOwner = resolveLoopAttemptLeaseOwner(input);
  const batch = parseLoopEventBatchIngress({
    agentRunId: input.agentRunId,
    attemptId: input.attemptId,
    workerId: leaseOwner.auditWorkerId,
    leaseGeneration: input.leaseGeneration,
    events: input.events,
  });
  await dependencies.db.$transaction(async (tx) => {
    const serverNow = dependencies.now?.() ?? new Date();
    let checklistState: Map<string, LoopChecklistItem> | null | undefined;
    let phaseState: { phase: string | null; status: string | null } | undefined;
    for (const event of batch.events) {
      const eventRecordId = boundedPersistenceId("agent-event", [event.eventId]);
      const eventFingerprint = sha256Canonical({
        agentRunId: batch.agentRunId,
        attemptId: batch.attemptId,
        workerId: batch.workerId,
        event,
      });
      if (event.loopNodeAttemptId !== batch.attemptId || event.leaseGeneration !== batch.leaseGeneration) throw staleLeaseError();
      const [attempt, agentRun] = await Promise.all([
        tx.loopNodeAttempt.findUnique({
          where: { id: batch.attemptId },
          select: {
            id: true,
            loopNodeRunId: true,
            attempt: true,
            executorType: true,
            version: true,
            status: true,
            claimToken: true,
            claimExpiresAt: true,
            agentRunId: true,
            executionPhase: true,
            executionPhaseStatus: true,
            loopNodeRun: { select: { loopRunId: true } },
          },
        }),
        tx.agentRun.findUnique({
          where: { id: batch.agentRunId },
          select: {
            id: true,
            taskId: true,
            loopRunId: true,
            loopNodeRunId: true,
            attempt: true,
            workerId: true,
            linuxWorkerPoolSessionId: true,
            leaseGeneration: true,
            leaseExpiresAt: true,
            status: true,
          },
        }),
      ]);
      if (
        !attempt
        || attempt.status !== "running"
        || attempt.executorType !== "local"
        || attempt.agentRunId !== batch.agentRunId
        || attempt.loopNodeRunId !== event.loopNodeRunId
        || attempt.loopNodeRun.loopRunId !== event.loopRunId
        || attempt.attempt !== event.attemptNo
      ) throw staleLeaseError();
      if (
        !agentRun
        || agentRun.taskId !== null
        || agentRun.loopRunId !== event.loopRunId
        || agentRun.loopNodeRunId !== event.loopNodeRunId
        || agentRun.attempt !== event.attemptNo
        || !matchesLoopAttemptLeaseOwner(agentRun, leaseOwner)
        || agentRun.leaseGeneration !== batch.leaseGeneration
        || !["claimed", "starting", "running", "waiting_approval"].includes(agentRun.status)
        || !agentRun.leaseExpiresAt
        || agentRun.leaseExpiresAt <= serverNow
      ) throw staleLeaseError();
      // App-server transport notifications can arrive once per token or
      // output chunk. They are intentionally not durable orchestration
      // events. Do not advance AgentRun.lastEventSequence here either:
      // doing so turns protocol chatter into a database write per token.
      // Durable lifecycle events use a monotonic `lastEventSequence < N`
      // fence below, so they can safely skip these discarded sequences.
      if (isHighFrequencyLoopAgentEventType(event.eventType)) continue;

      const existingEvent = await tx.orchestrationEvent.findUnique({
        where: { id: eventRecordId },
        select: { payload: true },
      });
      if (existingEvent) {
        if (readEventFingerprint(existingEvent.payload) === eventFingerprint) continue;
        throw validationError(`eventId was already accepted with different content: ${event.eventId}`);
      }
      if (event.eventType === "loop.checklist.created" || event.eventType === "loop.checklist.updated") {
        const payload = parseAndValidateChecklistEvent(event, {
          agentRunId: batch.agentRunId,
          attemptId: batch.attemptId,
          workerId: batch.workerId,
          leaseGeneration: batch.leaseGeneration,
        });
        checklistState ??= await loadLoopChecklistState(tx, event.loopNodeRunId, {
          loopRunId: event.loopRunId,
          loopNodeRunId: event.loopNodeRunId,
          loopNodeAttemptId: batch.attemptId,
          attemptNo: event.attemptNo,
          leaseGeneration: batch.leaseGeneration,
        });
        if (!checklistState) {
          if (event.eventType === "loop.checklist.updated") {
            throw validationError("Checklist update requires a prior checklist.created event");
          }
          checklistState = new Map();
        }
        applyLoopChecklistEvent(checklistState, event.eventType, payload);
      }
      const phaseTransition = event.eventType === EXECUTION_PHASE_EVENT_TYPE
        ? parseExecutionPhaseEvent(event)
        : null;
      const accepted = await tx.agentRun.updateMany({
        where: {
          id: batch.agentRunId,
          loopRunId: event.loopRunId,
          loopNodeRunId: event.loopNodeRunId,
          attempt: event.attemptNo,
          ...leaseOwner.where,
          leaseGeneration: batch.leaseGeneration,
          status: { in: ["claimed", "starting", "running", "waiting_approval"] },
          leaseExpiresAt: { gt: serverNow },
          lastEventSequence: { lt: event.sequence },
        },
        data: { lastEventSequence: event.sequence },
      });
      if (accepted.count !== 1) throw staleLeaseError();

      // The attempt snapshot is the authoritative phase state after reload or
      // Relay restart. A repeat of the same phase/status only refreshes the
      // sample time; only a distinct transition appends durable history.
      if (phaseTransition) {
        phaseState ??= { phase: attempt.executionPhase, status: attempt.executionPhaseStatus };
        const isDistinctTransition = phaseState.phase !== phaseTransition.phase
          || phaseState.status !== phaseTransition.status;
        const persistedPhase = await tx.loopNodeAttempt.updateMany({
          where: {
            id: batch.attemptId,
            loopNodeRunId: event.loopNodeRunId,
            executorType: "local",
            agentRunId: batch.agentRunId,
            status: "running",
            version: attempt.version,
            executionPhase: phaseState.phase,
            executionPhaseStatus: phaseState.status,
          },
          data: {
            executionPhase: phaseTransition.phase,
            executionPhaseStatus: phaseTransition.status,
            executionPhaseStartedAt: phaseTransition.startedAt === null
              ? null
              : new Date(phaseTransition.startedAt),
            executionPhaseFinishedAt: phaseTransition.finishedAt === null
              ? null
              : new Date(phaseTransition.finishedAt),
            executionPhaseCode: phaseTransition.code,
            executionPhaseSummary: phaseTransition.summary,
            executionPhaseUpdatedAt: serverNow,
          },
        });
        if (persistedPhase.count !== 1) throw staleLeaseError();
        phaseState = { phase: phaseTransition.phase, status: phaseTransition.status };
        if (!isDistinctTransition) continue;
      }

      await appendRuntimeEvents(tx, [runtimeEvent({
        id: eventRecordId,
        eventType: event.eventType,
        aggregateType: "loop_node",
        aggregateId: event.loopNodeRunId,
        aggregateVersion: event.sequence,
        sequence: event.sequence,
        correlationId: event.loopRunId,
        causationId: batch.attemptId,
        actor: { type: "worker", id: batch.workerId },
        occurredAt: new Date(event.occurredAt),
        payload: {
          eventId: event.eventId,
          eventFingerprint,
          agentRunId: batch.agentRunId,
          attemptId: batch.attemptId,
          loopRunId: event.loopRunId,
          loopNodeRunId: event.loopNodeRunId,
          attemptNo: event.attemptNo,
          leaseGeneration: event.leaseGeneration,
          clientSequence: event.sequence,
          payloadSummary: event.payloadSummary,
          artifactRefs: event.artifactRefs,
        },
      })], { preserveEventIds: true, outboxAvailableAt: serverNow });
    }
  });
}

type ChecklistEventBinding = {
  loopRunId: string;
  loopNodeRunId: string;
  loopNodeAttemptId: string;
  attemptNo: number;
  leaseGeneration: number;
};

const EXECUTION_PHASE_EVENT_TYPE = "loop.node.execution_phase_changed";

function parseExecutionPhaseEvent(event: LoopAgentEvent) {
  const parsed = loopExecutionPhaseSchema.safeParse(event.payloadSummary);
  if (!parsed.success) throw schemaValidationError("Execution phase payload", parsed.error.issues);
  return parsed.data;
}

function assertChecklistBinding(payload: ChecklistEventBinding, expected: ChecklistEventBinding): void {
  if (
    payload.loopRunId !== expected.loopRunId
    || payload.loopNodeRunId !== expected.loopNodeRunId
    || payload.loopNodeAttemptId !== expected.loopNodeAttemptId
    || payload.attemptNo !== expected.attemptNo
    || payload.leaseGeneration !== expected.leaseGeneration
  ) throw staleLeaseError();
}

function parseAndValidateChecklistEvent(
  event: LoopAgentEvent,
  expected: { attemptId: string; agentRunId: string; workerId: string; leaseGeneration: number },
) {
  if (event.eventType === "loop.checklist.created") {
    const parsed = loopChecklistCreatedPayloadSchema.safeParse(event.payloadSummary);
    if (!parsed.success) throw schemaValidationError("Checklist created payload", parsed.error.issues);
    assertChecklistBinding(parsed.data, {
      loopRunId: event.loopRunId,
      loopNodeRunId: event.loopNodeRunId,
      loopNodeAttemptId: expected.attemptId,
      attemptNo: event.attemptNo,
      leaseGeneration: expected.leaseGeneration,
    });
    return parsed.data;
  }
  const parsed = loopChecklistUpdatedPayloadSchema.safeParse(event.payloadSummary);
  if (!parsed.success) throw schemaValidationError("Checklist updated payload", parsed.error.issues);
  assertChecklistBinding(parsed.data, {
    loopRunId: event.loopRunId,
    loopNodeRunId: event.loopNodeRunId,
    loopNodeAttemptId: expected.attemptId,
    attemptNo: event.attemptNo,
    leaseGeneration: expected.leaseGeneration,
  });
  return parsed.data;
}

async function loadLoopChecklistState(
  tx: RuntimeTx,
  nodeRunId: string,
  expected: ChecklistEventBinding,
): Promise<Map<string, LoopChecklistItem> | null> {
  const rows = await tx.orchestrationEvent.findMany({
    where: { aggregateType: "loop_node", aggregateId: nodeRunId },
    select: { eventType: true, payload: true },
    orderBy: { sequence: "asc" },
  });
  const relevant = rows
    .filter((row) => row.eventType === "loop.checklist.created" || row.eventType === "loop.checklist.updated")
    .sort((a, b) => Number(recordValue(a.payload).clientSequence ?? 0) - Number(recordValue(b.payload).clientSequence ?? 0));
  if (relevant.length === 0) return null;
  const state = new Map<string, LoopChecklistItem>();
  for (const row of relevant) {
    const envelope = recordValue(row.payload);
    const summary = envelope.payloadSummary;
    if (row.eventType === "loop.checklist.created") {
      const parsed = loopChecklistCreatedPayloadSchema.safeParse(summary);
      if (!parsed.success) throw validationError("Persisted checklist.created payload is invalid");
      assertChecklistBinding(parsed.data, expected);
      applyLoopChecklistEvent(state, "loop.checklist.created", parsed.data);
    } else {
      const parsed = loopChecklistUpdatedPayloadSchema.safeParse(summary);
      if (!parsed.success) throw validationError("Persisted checklist.updated payload is invalid");
      assertChecklistBinding(parsed.data, expected);
      applyLoopChecklistEvent(state, "loop.checklist.updated", parsed.data);
    }
  }
  return state;
}

function applyLoopChecklistEvent(
  state: Map<string, LoopChecklistItem>,
  eventType: "loop.checklist.created" | "loop.checklist.updated",
  payload: LoopChecklistCreatedPayload | LoopChecklistUpdatedPayload,
): void {
  if (eventType === "loop.checklist.created") {
    if (state.size > 0) throw validationError("Checklist can only be created once for a node Attempt");
    for (const item of (payload as LoopChecklistCreatedPayload).checklist) {
      if (state.has(item.id)) throw validationError(`Duplicate checklist item: ${item.id}`);
      state.set(item.id, item);
    }
    return;
  }
  const update = payload as LoopChecklistUpdatedPayload;
  const current = state.get(update.itemId);
  if (!current) throw validationError(`Checklist item does not exist: ${update.itemId}`);
  try {
    validateLoopChecklistTransition(current.status, update.status);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : "Invalid checklist status transition");
  }
  state.set(update.itemId, {
    ...current,
    status: update.status,
    ...(update.reason === undefined ? { reason: undefined } : { reason: update.reason }),
    evidenceRefs: update.evidenceRefs,
  });
}

/**
 * Convert a provider/Worker terminal failure into explicit terminal checklist
 * updates. This keeps a failed attempt from leaving its last item visually
 * stuck in `in_progress` after the Worker has already been released.
 */
export function buildChecklistFailureUpdates(
  checklist: readonly LoopChecklistItem[],
  reason: string,
): Array<Pick<LoopChecklistUpdatedPayload, "itemId" | "status" | "reason" | "evidenceRefs">> {
  const boundedReason = reason.trim().slice(0, 4_000) || "node_failed";
  return checklist
    .filter((item) => item.status === "not_started" || item.status === "in_progress")
    .map((item) => ({
      itemId: item.id,
      status: "failed" as const,
      reason: boundedReason,
      evidenceRefs: item.evidenceRefs,
    }));
}

/**
 * A completed provider turn is authoritative evidence that its execution has
 * ended, but the provider can still omit one or more low-frequency checklist
 * tool calls.  Do not leave that lease alive until it expires merely because
 * an observability update was missed.  Close only the unresolved items as
 * `skipped` and make the omission explicit in the durable reason.
 */
export function buildChecklistSuccessFinalizationUpdates(
  checklist: readonly LoopChecklistItem[],
): Array<Pick<LoopChecklistUpdatedPayload, "itemId" | "status" | "reason" | "evidenceRefs">> {
  return checklist
    .filter((item) => item.status === "not_started" || item.status === "in_progress")
    .map((item) => ({
      itemId: item.id,
      status: "skipped" as const,
      reason: "Worker completed the node before the AI reported this checklist item terminal.",
      evidenceRefs: item.evidenceRefs,
    }));
}

type LoopAttemptLeaseOwner = {
  auditWorkerId: string;
  where: { workerId: string | null; linuxWorkerPoolSessionId?: string };
  linuxWorkerPoolSessionId?: string;
};

function resolveLoopAttemptLeaseOwner(input: {
  workerId?: string;
  linuxWorkerPoolSessionId?: string;
}): LoopAttemptLeaseOwner {
  const workerId = input.workerId?.trim();
  const sessionId = input.linuxWorkerPoolSessionId?.trim();
  if (Boolean(workerId) === Boolean(sessionId)) {
    throw validationError("Loop event batch must identify exactly one Worker lease owner");
  }
  if (sessionId) {
    if (!/^[a-f0-9]{32}$/u.test(sessionId)) {
      throw validationError("Loop event batch Linux Worker session is invalid");
    }
    return {
      auditWorkerId: `linux-worker:${sessionId}`,
      where: { workerId: null, linuxWorkerPoolSessionId: sessionId },
      linuxWorkerPoolSessionId: sessionId,
    };
  }
  return {
    auditWorkerId: workerId as string,
    where: { workerId: workerId as string },
  };
}

function matchesLoopAttemptLeaseOwner(
  agentRun: { workerId: string | null; linuxWorkerPoolSessionId: string | null },
  leaseOwner: LoopAttemptLeaseOwner,
): boolean {
  return leaseOwner.linuxWorkerPoolSessionId !== undefined
    ? agentRun.workerId === null && agentRun.linuxWorkerPoolSessionId === leaseOwner.linuxWorkerPoolSessionId
    : agentRun.workerId === leaseOwner.auditWorkerId && agentRun.linuxWorkerPoolSessionId === null;
}

export interface ReserveEffectInput {
  id: string;
  loopRunId: string;
  nodeRunId: string;
  attemptId?: string | null;
  operationType: string;
  requestFingerprint: string;
  providerIdempotencyKey?: string | null;
  workerId?: string;
  leaseGeneration?: number;
  claimToken?: string;
  occurredAt: Date;
  correlationId: string;
  actor: OrchestrationActor;
}

export async function reserveEffectExecution(
  input: ReserveEffectInput,
  dependencies: RuntimeDependencies = DEFAULTS,
): Promise<unknown> {
  assertEffectReservationInput(input);
  const effectKey = buildEffectKey(input);
  try {
    return await dependencies.db.$transaction(async (tx) => {
      await assertEffectIdentity(tx, input, dependencies.now?.() ?? new Date());
      const existing = await tx.effectExecution.findUnique({ where: { effectKey } });
      if (existing) {
        assertMatchingEffectReservation(existing, input);
        return existing;
      }

      const effect = await tx.effectExecution.create({
        data: {
          id: input.id,
          effectKey,
          loopRunId: input.loopRunId,
          nodeRunId: input.nodeRunId,
          ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
          operationType: input.operationType,
          requestFingerprint: input.requestFingerprint,
          ...(input.providerIdempotencyKey === undefined
            ? {}
            : { providerIdempotencyKey: input.providerIdempotencyKey }),
          status: "prepared",
        },
      });
      await appendRuntimeEvents(tx, [runtimeEvent({
        eventType: "loop.effect.reserved",
        aggregateType: "loop_effect",
        aggregateId: input.id,
        aggregateVersion: 1,
        sequence: 1,
        correlationId: input.correlationId,
        causationId: input.attemptId ?? input.nodeRunId,
        actor: input.actor,
        occurredAt: input.occurredAt,
        payload: {
          effectKey,
          loopRunId: input.loopRunId,
          nodeRunId: input.nodeRunId,
          attemptId: input.attemptId ?? null,
          operationType: input.operationType,
          requestFingerprint: input.requestFingerprint,
          status: "prepared",
        },
      })]);
      return effect;
    });
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    return dependencies.db.$transaction(async (tx) => {
      await assertEffectIdentity(tx, input, dependencies.now?.() ?? new Date());
      const existing = await tx.effectExecution.findUnique({ where: { effectKey } });
      if (!existing) throw error;
      assertMatchingEffectReservation(existing, input);
      return existing;
    });
  }
}

export interface ResolveEffectInput {
  effectKey: string;
  loopRunId: string;
  nodeRunId: string;
  attemptId?: string | null;
  operationType?: string;
  requestFingerprint?: string;
  status: "succeeded" | "failed" | "reconciliation_required";
  providerReceipt?: unknown;
  resultFingerprint?: string;
  workerId?: string;
  leaseGeneration?: number;
  claimToken?: string;
  resolvedAt: Date;
  correlationId: string;
  actor: OrchestrationActor;
}

export async function resolveEffectExecution(
  input: ResolveEffectInput,
  dependencies: RuntimeDependencies = DEFAULTS,
): Promise<void> {
  assertEffectResolutionInput(input);
  try {
    await dependencies.db.$transaction(async (tx) => {
      await assertEffectIdentity(tx, input, dependencies.now?.() ?? new Date());
      const effect = await tx.effectExecution.findUnique({ where: { effectKey: input.effectKey } });
      if (!effect) throw staleEffectError();
      assertEffectIdentityMatches(effect, input);
      if (isTerminalEffectStatus(effect.status)) {
        if (isIdenticalEffectResolution(effect, input)) return;
        throw validationError("Effect was already resolved with different result content");
      }

      const resolved = await tx.effectExecution.updateMany({
        where: {
          effectKey: input.effectKey,
          status: { in: ["prepared", "executing"] },
        },
        data: {
          status: input.status,
          ...(input.providerReceipt === undefined ? {} : { providerReceipt: toPrismaJson(input.providerReceipt) }),
          ...(input.resultFingerprint === undefined ? {} : { resultFingerprint: input.resultFingerprint }),
          resolvedAt: input.resolvedAt,
        },
      });
      if (resolved.count !== 1) throw staleEffectError();
      await appendRuntimeEvents(tx, [runtimeEvent({
        eventType: "loop.effect.resolved",
        aggregateType: "loop_effect",
        aggregateId: String(effect.id),
        aggregateVersion: 2,
        sequence: 2,
        correlationId: input.correlationId,
        causationId: input.attemptId ?? input.nodeRunId,
        actor: input.actor,
        occurredAt: input.resolvedAt,
        payload: {
          effectKey: input.effectKey,
          loopRunId: input.loopRunId,
          nodeRunId: input.nodeRunId,
          attemptId: input.attemptId ?? null,
          status: input.status,
          resultFingerprint: input.resultFingerprint ?? null,
        },
      })]);
    });
  } catch (error) {
    if (
      typeof error !== "object"
      || error === null
      || !("code" in error)
      || error.code !== "stale_effect"
      || !dependencies.db.effectExecution
    ) throw error;

    const committed = await dependencies.db.effectExecution.findUnique({
      where: { effectKey: input.effectKey },
    });
    if (!committed) throw error;
    assertEffectIdentityMatches(committed, input);
    if (!isTerminalEffectStatus(committed.status)) throw error;
    if (isIdenticalEffectResolution(committed, input)) return;
    throw validationError("Effect was already resolved with different result content");
  }
}

export async function readLoopRunProjection(
  loopRunId: string,
  dependencies: { db: RuntimeDb } = DEFAULTS,
): Promise<unknown> {
  return dependencies.db.loopRun.findUnique({
    where: { id: loopRunId, engineKind: "graph_v1" },
    include: {
      nodeRuns: { include: { attempts: true, effects: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      effects: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
}

export function buildEffectKey(input: Pick<ReserveEffectInput, "id" | "loopRunId" | "nodeRunId" | "attemptId" | "operationType">): string {
  return `effect:${sha256Canonical([
    input.loopRunId,
    input.nodeRunId,
    input.attemptId ?? null,
    input.operationType,
    input.id,
  ])}`;
}

type EffectIdentityInput = {
  loopRunId: string;
  nodeRunId: string;
  attemptId?: string | null;
  operationType?: string;
  requestFingerprint?: string;
  workerId?: string;
  leaseGeneration?: number;
  claimToken?: string;
};

async function assertEffectIdentity(
  tx: RuntimeTx,
  input: EffectIdentityInput,
  serverNow: Date,
): Promise<void> {
  const nodeRun = await tx.loopNodeRun.findUnique({
    where: { id: input.nodeRunId },
    select: { id: true, loopRunId: true },
  });
  if (!nodeRun || nodeRun.loopRunId !== input.loopRunId) throw staleLeaseError();
  if (input.attemptId === undefined || input.attemptId === null) return;

  const attempt = await tx.loopNodeAttempt.findUnique({
    where: { id: input.attemptId },
    select: {
      id: true,
      loopNodeRunId: true,
      executorType: true,
      status: true,
      agentRunId: true,
      claimToken: true,
      claimExpiresAt: true,
    },
  });
  if (!attempt || attempt.loopNodeRunId !== input.nodeRunId) throw staleLeaseError();
  if (attempt.executorType === "local") {
    if (
      attempt.status !== "running"
      || !attempt.agentRunId
      || input.workerId === undefined
      || input.leaseGeneration === undefined
    ) throw staleLeaseError();
    const agentRun = await tx.agentRun.findUnique({
      where: { id: attempt.agentRunId },
      select: {
        id: true,
        taskId: true,
        loopRunId: true,
        loopNodeRunId: true,
        workerId: true,
        leaseGeneration: true,
        leaseExpiresAt: true,
        status: true,
      },
    });
    if (
      !agentRun
      || agentRun.taskId !== null
      || agentRun.loopRunId !== input.loopRunId
      || agentRun.loopNodeRunId !== input.nodeRunId
      || agentRun.workerId !== input.workerId
      || agentRun.leaseGeneration !== input.leaseGeneration
      || !["claimed", "starting", "running", "waiting_approval"].includes(agentRun.status)
      || !agentRun.leaseExpiresAt
      || agentRun.leaseExpiresAt <= serverNow
    ) throw staleLeaseError();
  }
  if (
    attempt.executorType === "platform"
    && (
      attempt.status !== "running"
      || attempt.agentRunId !== null
      || input.claimToken === undefined
      || attempt.claimToken !== input.claimToken
      || !attempt.claimExpiresAt
      || attempt.claimExpiresAt <= serverNow
    )
  ) throw staleLeaseError();
}

function assertEffectReservationInput(input: ReserveEffectInput): void {
  assertBoundedText(input.id, "Effect id", 128);
  assertBoundedText(input.loopRunId, "Effect LoopRun id", 96);
  assertBoundedText(input.nodeRunId, "Effect NodeRun id", 96);
  if (input.attemptId !== undefined && input.attemptId !== null) {
    assertBoundedText(input.attemptId, "Effect attempt id", 128);
  }
  assertBoundedText(input.operationType, "Effect operation type", 96);
  assertBoundedText(input.requestFingerprint, "Effect request fingerprint", 128);
  if (input.providerIdempotencyKey !== undefined && input.providerIdempotencyKey !== null) {
    assertBoundedText(input.providerIdempotencyKey, "Effect provider idempotency key", 191);
  }
  assertOptionalEffectLease(input);
  if (input.claimToken !== undefined) assertBoundedText(input.claimToken, "Effect claim token", 128);
  assertValidDate(input.occurredAt, "Effect reservation occurredAt");
}

function assertEffectResolutionInput(input: ResolveEffectInput): void {
  assertBoundedText(input.effectKey, "Effect key", 191);
  assertBoundedText(input.loopRunId, "Effect LoopRun id", 96);
  assertBoundedText(input.nodeRunId, "Effect NodeRun id", 96);
  if (
    input.status !== "succeeded"
    && input.status !== "failed"
    && input.status !== "reconciliation_required"
  ) {
    throw validationError("Effect resolution status is invalid");
  }
  if (input.attemptId !== undefined && input.attemptId !== null) {
    assertBoundedText(input.attemptId, "Effect attempt id", 128);
  }
  if (input.operationType !== undefined) assertBoundedText(input.operationType, "Effect operation type", 96);
  if (input.requestFingerprint !== undefined) {
    assertBoundedText(input.requestFingerprint, "Effect request fingerprint", 128);
  }
  if (input.resultFingerprint !== undefined) {
    assertBoundedText(input.resultFingerprint, "Effect result fingerprint", 128);
  }
  assertOptionalEffectLease(input);
  if (input.claimToken !== undefined) assertBoundedText(input.claimToken, "Effect claim token", 128);
  if (input.providerReceipt !== undefined) toPrismaJson(input.providerReceipt);
  assertValidDate(input.resolvedAt, "Effect resolution resolvedAt");
}

function assertOptionalEffectLease(input: { workerId?: string; leaseGeneration?: number }): void {
  if (input.workerId !== undefined) assertBoundedText(input.workerId, "Effect worker id", 96);
  if (
    input.leaseGeneration !== undefined
    && (!Number.isInteger(input.leaseGeneration) || input.leaseGeneration <= 0)
  ) throw validationError("Effect lease generation is invalid");
}

function assertMatchingEffectReservation(effect: Record<string, unknown>, input: ReserveEffectInput): void {
  if (
    effect.id !== input.id
    || effect.loopRunId !== input.loopRunId
    || effect.nodeRunId !== input.nodeRunId
    || normalizeNullable(effect.attemptId) !== normalizeNullable(input.attemptId)
    || effect.operationType !== input.operationType
    || effect.requestFingerprint !== input.requestFingerprint
    || normalizeNullable(effect.providerIdempotencyKey) !== normalizeNullable(input.providerIdempotencyKey)
  ) {
    throw validationError("Effect reservation conflicts with its persisted logical identity or request fingerprint");
  }
}

function assertEffectIdentityMatches(effect: Record<string, unknown>, input: EffectIdentityInput): void {
  if (
    effect.loopRunId !== input.loopRunId
    || effect.nodeRunId !== input.nodeRunId
    || normalizeNullable(effect.attemptId) !== normalizeNullable(input.attemptId)
  ) throw staleLeaseError();
  if (
    (input.operationType !== undefined && effect.operationType !== input.operationType)
    || (input.requestFingerprint !== undefined && effect.requestFingerprint !== input.requestFingerprint)
  ) throw validationError("Effect receipt conflicts with its reserved operation or request fingerprint");
}

function isTerminalEffectStatus(value: unknown): boolean {
  return value === "succeeded" || value === "failed" || value === "reconciliation_required";
}

function isIdenticalEffectResolution(effect: Record<string, unknown>, input: ResolveEffectInput): boolean {
  return effect.status === input.status
    && normalizeNullable(effect.resultFingerprint) === normalizeNullable(input.resultFingerprint)
    && canonicalJson(effect.providerReceipt ?? null) === canonicalJson(input.providerReceipt ?? null);
}

function normalizeNullable(value: unknown): unknown {
  return value === undefined ? null : value;
}

function assertBoundedText(value: unknown, name: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw validationError(`${name} is invalid`);
  }
}

function parseParentLoopIdentity(value: unknown): CreateGraphLoopRunInput["parent"] {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw validationError("Parent Loop identity is invalid");
  assertBoundedText(value.loopRunId, "Parent LoopRun id", 96);
  assertBoundedText(value.nodeRunId, "Parent NodeRun id", 96);
  assertBoundedText(value.attemptId, "Parent attempt id", 128);
  return {
    loopRunId: value.loopRunId,
    nodeRunId: value.nodeRunId,
    attemptId: value.attemptId,
  };
}

function parseScheduledTaskRunId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[a-f0-9]{32}$/u.test(value)) {
    throw validationError("Scheduled task Run id is invalid");
  }
  return value;
}

function parseChildScheduledTaskRunId(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  const scheduledTaskRunId = value.scheduledTaskRunId;
  if (scheduledTaskRunId === undefined) return undefined;
  if (typeof scheduledTaskRunId !== "string" || !/^[a-f0-9]{32}$/u.test(scheduledTaskRunId)) {
    throw validationError("Child scheduled task Run reference is invalid");
  }
  return scheduledTaskRunId;
}

function parseRunBindingSnapshot(value: unknown): {
  id: string;
  projectId: string;
  loopDefinitionId: string;
  activeVersionId: string;
  versionPolicy: "latest" | "pinned";
  version: number;
} {
  if (!isPlainObject(value)) throw validationError("Loop binding snapshot is invalid");
  assertBoundedText(value.id, "Loop binding snapshot id", 96);
  assertBoundedText(value.projectId, "Loop binding snapshot project id", 64);
  assertBoundedText(value.loopDefinitionId, "Loop binding snapshot definition id", 96);
  assertBoundedText(value.activeVersionId, "Loop binding snapshot active version id", 96);
  const parameterOverrides = isPlainObject(value.parameterOverrides) ? value.parameterOverrides : {};
  const versionPolicyValue = value.versionPolicy ?? parameterOverrides.versionPolicy;
  const versionPolicy = versionPolicyValue === undefined
    ? "latest"
    : versionPolicyValue === "latest" || versionPolicyValue === "pinned"
      ? versionPolicyValue
      : (() => { throw validationError("Loop binding snapshot version policy is invalid"); })();
  if (value.status !== "enabled" || !Number.isInteger(value.version) || (value.version as number) < 1) {
    throw validationError("Loop binding snapshot state is invalid");
  }
  return {
    id: value.id,
    projectId: value.projectId,
    loopDefinitionId: value.loopDefinitionId,
    activeVersionId: value.activeVersionId,
    versionPolicy,
    version: value.version as number,
  };
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw validationError(`${name} is invalid`);
}

function deriveNodeTransition(input: {
  graph: LoopGraph;
  node: LoopNodeDefinition;
  result: LoopNodeResult;
  gateDecision?: GateDecision;
  counters: TransitionCounters;
  limits: { maxRepeatCount: number; maxTransitions: number };
}): CalculatedNodeTransition {
  const isGateNode = input.node.type === "policy_gate" || input.node.type === "human_gate";
  if (input.gateDecision && !isGateNode) {
    throw validationError("Only gate nodes accept a GateDecision");
  }
  if (input.node.type === "end") {
    if (input.graph.edges.some((edge) => edge.source === input.node.key)) {
      throw validationError("End nodes cannot have outgoing transitions");
    }
    return { status: "completed" };
  }

  if (input.gateDecision) {
    if (input.result.outcome !== input.gateDecision.outcome) {
      throw validationError("Gate result outcome does not match its decision");
    }
    const transition = transitionLoopNode({
      graph: input.graph,
      nodeKey: input.node.key,
      decision: input.gateDecision,
      counters: input.counters,
      limits: input.limits,
    });
    return { ...transition, targetNodeKey: transition.edge.target };
  }
  if (isGateNode) {
    throw validationError("Gate nodes require a deterministic GateDecision");
  }

  const edge = selectNextEdge({
    graph: input.graph,
    nodeKey: input.node.key,
    outcome: input.result.outcome,
    data: input.result.output,
  });
  const budget = applyTransitionBudget({ counters: input.counters, edge, limits: input.limits });
  return budget.ok
    ? { status: "routed", edge, targetNodeKey: edge.target, counters: budget.counters }
    : { status: "exhausted", edge, targetNodeKey: edge.target, reason: budget.reason };
}

function deriveAgentRouteTransition(input: {
  graph: LoopGraph;
  node: LoopNodeDefinition;
  loopVersionId: string;
  routeDecision: unknown;
  runGraphSnapshot: unknown;
  graphDigest: string | null;
  counters: TransitionCounters;
  limits: { maxRepeatCount: number; maxTransitions: number };
}): CalculatedNodeTransition {
  const decision = localRouteDecisionSchema.parse(input.routeDecision);
  const v2Snapshot = runGraphSnapshotV2Schema.safeParse(input.runGraphSnapshot);
  const v1Snapshot = runGraphSnapshotSchema.safeParse(input.runGraphSnapshot);
  const snapshot = v2Snapshot.success ? v2Snapshot.data : v1Snapshot.success ? v1Snapshot.data : null;
  if (!snapshot || input.graphDigest !== snapshot.graphDigest || decision.snapshotDigest !== snapshot.graphDigest) {
    throw Object.assign(new Error("Route decision snapshot digest does not match the persisted run snapshot"), { code: "route_decision_invalid" });
  }
  const snapshotLoop = snapshot.loopVersions.find((version) => version.loopVersionId === input.loopVersionId);
  const snapshotNode = snapshotLoop?.graph.nodes.find((node) => node.key === input.node.key);
  if (!snapshotNode || stableNodeId(snapshotNode) !== decision.fromNodeId) {
    throw Object.assign(new Error("Route decision source node does not match the persisted run snapshot"), { code: "route_decision_invalid" });
  }
  const snapshotTarget = snapshotLoop?.graph.nodes.find((node) => stableNodeId(node) === decision.nextNodeId);
  if (!snapshotTarget || snapshotTarget.type === "start") {
    throw Object.assign(new Error("Route decision target is outside the current Loop snapshot"), { code: "route_decision_invalid" });
  }
  const target = input.graph.nodes.find((node) => stableNodeId(node) === decision.nextNodeId);
  if (!target || target.type === "start") {
    throw Object.assign(new Error("Route decision target is absent from the current Loop graph"), { code: "route_decision_invalid" });
  }
  const edge = input.graph.edges.find((candidate) => candidate.source === input.node.key && candidate.target === target.key);
  const decisionKey = edge?.id ?? `decision:${target.key}`;
  const targetTraversals = input.counters.edgeTraversals[decisionKey] ?? 0;
  if (input.counters.transitions + 1 >= input.limits.maxTransitions) {
    return { status: "exhausted", edge: edge ?? null, targetNodeKey: target.key, reason: "max_transitions_exhausted" };
  }
  if (targetTraversals >= input.limits.maxRepeatCount) {
    return { status: "exhausted", edge: edge ?? null, targetNodeKey: target.key, reason: "max_repeat_count_exhausted" };
  }
  if (edge?.maxTraversals !== undefined && targetTraversals + 1 > edge.maxTraversals) {
    return { status: "exhausted", edge, targetNodeKey: target.key, reason: "edge_max_traversals_exhausted" };
  }
  return {
    status: "routed",
    edge: edge ?? null,
    targetNodeKey: target.key,
    counters: {
      transitions: input.counters.transitions + 1,
      repeats: input.counters.repeats + (targetTraversals > 0 ? 1 : 0),
      edgeTraversals: { ...input.counters.edgeTraversals, [decisionKey]: targetTraversals + 1 },
    },
  };
}

function nodeSupportsExecutionTarget(
  node: LoopNodeDefinition,
  executionTarget: "platform" | "local",
): boolean {
  if (node.type === "agent_action" || node.type === "platform_action") {
    return node.executionTarget === "either" || node.executionTarget === executionTarget;
  }
  return executionTarget === "platform";
}

function assertExecutorAgentRunPair(input: ActivateLoopNodeInput): void {
  if (input.executionTarget !== "platform" && input.executionTarget !== "local") {
    throw validationError("Activation execution target must be platform or local");
  }
  const hasAgentRun = isPlainObject(input.agentRun);
  if (input.agentRun !== undefined && !hasAgentRun) {
    throw validationError("AgentRun specification must be an object");
  }
  if ((input.executionTarget === "local") !== hasAgentRun) {
    throw validationError("Local activation requires one AgentRun and platform activation forbids it");
  }
  if (!Number.isInteger(input.nodeRunVersion) || input.nodeRunVersion <= 0) {
    throw validationError("NodeRun version must be a positive integer");
  }
  if (!hasAgentRun) return;
  const agentRun = input.agentRun as NonNullable<ActivateLoopNodeInput["agentRun"]>;
  for (const [name, value, maxLength] of [
    ["AgentRun id", agentRun.id, 96],
    ["Agent profile id", agentRun.agentProfileId, 96],
  ] as const) {
    assertBoundedText(value, name, maxLength);
  }
  if (agentRun.projectId !== undefined && agentRun.projectId !== null) {
    assertBoundedText(agentRun.projectId, "AgentRun project id", 64);
  }
  fingerprintJsonValue(agentRun.inputSnapshot);
}

export function parsePublishedLoopVersionGraph(value: unknown): LoopGraph {
  try {
    return parsePublishedLoopGraph(value);
  } catch {
    const legacy = loopGraphSchema.safeParse(value);
    if (!legacy.success) throw schemaValidationError("LoopVersion graph", legacy.error.issues);
    throw validationError("LoopVersion graph is invalid");
  }
}

function parseLoopNodeResult(value: unknown): LoopNodeResult {
  const parsed = loopNodeResultSchema.safeParse(value);
  if (!parsed.success) throw schemaValidationError("Loop node result", parsed.error.issues);
  return parsed.data;
}

function parseGateDecision(value: unknown): GateDecision {
  const parsed = gateDecisionSchema.safeParse(value);
  if (!parsed.success) throw schemaValidationError("Gate decision", parsed.error.issues);
  return parsed.data;
}

function localRouteDecisionId(value: unknown): string {
  const parsed = localRouteDecisionSchema.parse(value);
  return parsed.decisionId;
}

function parseTransitionCounters(value: unknown): TransitionCounters {
  const parsed = loopTransitionCountersSchema.safeParse(value);
  if (!parsed.success) throw schemaValidationError("LoopRun transition counters", parsed.error.issues);
  return parsed.data;
}

function parseRuntimeBudget(value: unknown) {
  const parsed = loopRuntimeBudgetSchema.safeParse(value);
  if (!parsed.success) throw schemaValidationError("LoopRun budget snapshot", parsed.error.issues);
  return parsed.data;
}

function parseLoopEventBatchIngress(input: {
  agentRunId: string;
  attemptId: string;
  workerId: string;
  leaseGeneration: number;
  events: LoopAgentEvent[];
}) {
  const allowedKeys = new Set(["agentRunId", "attemptId", "workerId", "leaseGeneration", "events"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw validationError("Loop event batch contains unknown fields");
  }
  if (!input.attemptId || input.attemptId.length > 128) {
    throw validationError("Loop event batch attemptId is invalid");
  }
  const parsed = loopAgentEventBatchSchema.safeParse({
    agentRunId: input.agentRunId,
    workerId: input.workerId,
    leaseGeneration: input.leaseGeneration,
    events: input.events,
  });
  if (!parsed.success) throw schemaValidationError("Loop event batch", parsed.error.issues);
  return { ...parsed.data, attemptId: input.attemptId };
}

function schemaValidationError(
  name: string,
  issues: readonly { path: PropertyKey[]; message: string }[],
): Error & { code: "validation_failed" } {
  const details = issues.map((issue) => `${issue.path.map(String).join(".") || name}: ${issue.message}`).join("; ");
  return validationError(`${name} is invalid: ${details}`);
}

function buildNodeRunId(loopRunId: string, nodeKey: string, activationNo: number): string {
  return boundedPersistenceId("loop-node", [loopRunId, nodeKey, String(activationNo)], 96);
}

function toWorkflowDecisionActor(actor: OrchestrationActor): Extract<OrchestrationActor, { type: "user" | "agent" | "system" }> {
  return actor.type === "worker" ? { type: "system", id: `worker:${actor.id}` } : actor;
}

function runtimeEvent(input: {
  id?: string;
  eventType: string;
  aggregateType: "run" | "loop_node" | "loop_effect" | "workflow_interaction";
  aggregateId: string;
  aggregateVersion: number;
  sequence: number;
  correlationId: string;
  causationId?: string;
  commandId?: string;
  actor: OrchestrationActor;
  occurredAt: Date;
  payload: JsonRecord;
}) {
  return createEventEnvelope({
    id: input.id ?? boundedPersistenceId("event", [input.eventType, input.aggregateId, String(input.sequence), input.correlationId]),
    eventType: input.eventType,
    aggregate: { type: input.aggregateType, id: input.aggregateId, version: input.aggregateVersion },
    sequence: input.sequence,
    correlationId: input.correlationId,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    actor: input.actor,
    occurredAt: input.occurredAt,
    payload: input.payload,
  });
}

async function appendRuntimeEvents(
  tx: RuntimeTx,
  events: readonly OrchestrationEventEnvelope[],
  options: { preserveEventIds?: boolean; outboxAvailableAt?: Date } = {},
): Promise<void> {
  const sequencedEvents: OrchestrationEventEnvelope[] = [];
  for (const event of events) {
    const sequence = await tx.orchestrationAggregateSequence.upsert({
      where: { aggregateType_aggregateId: { aggregateType: event.aggregateType, aggregateId: event.aggregateId } },
      create: { aggregateType: event.aggregateType, aggregateId: event.aggregateId, sequence: 1 },
      update: { sequence: { increment: 1 } },
    });
    sequencedEvents.push({
      ...event,
      id: options.preserveEventIds
        ? event.id
        : boundedPersistenceId("event", [event.eventType, event.aggregateId, String(sequence.sequence), event.correlationId]),
      sequence: sequence.sequence,
    });
  }
  if (sequencedEvents.length === 0) return;

  const eventRows: Prisma.OrchestrationEventCreateManyInput[] = sequencedEvents.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    sequence: event.sequence,
    correlationId: event.correlationId,
    ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
    ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
    actorType: event.actorType,
    actorId: event.actorId,
    occurredAt: event.occurredAt.toISOString(),
    payload: toPrismaJson(event.payload),
  }));
  await tx.orchestrationEvent.createMany({ data: eventRows });

  const outboxRows: Prisma.OutboxMessageCreateManyInput[] = sequencedEvents.map((event) => ({
    id: boundedPersistenceId("outbox", [event.id]),
    topic: "orchestration.event",
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: toPrismaJson({ ...event, occurredAt: event.occurredAt.toISOString() }),
    availableAt: options.outboxAvailableAt ?? event.occurredAt,
  }));
  await tx.outboxMessage.createMany({ data: outboxRows });
}

function isValidWaitingResume(checkpointValue: unknown, resume: WaitingResume, serverNow: Date): boolean {
  if (!isPlainObject(checkpointValue) || checkpointValue.waitingReason !== resume.waitingReason) return false;
  if (resume.waitingReason === "timer") {
    if (typeof checkpointValue.wakeAt !== "string") return false;
    const wakeAt = new Date(checkpointValue.wakeAt);
    return Number.isFinite(wakeAt.getTime()) && wakeAt <= serverNow;
  }
  if (resume.waitingReason === "child_loop") {
    return typeof resume.childLoopRunId === "string"
      && checkpointValue.childLoopRunId === resume.childLoopRunId;
  }
  if (
    checkpointValue.callbackId !== resume.callbackId
    || typeof checkpointValue.secretHash !== "string"
    || checkpointValue.secretHash.length !== 64
    || resume.secretHash === undefined
  ) return false;
  const storedHash = Buffer.from(checkpointValue.secretHash, "hex");
  const providedHash = Buffer.from(resume.secretHash, "hex");
  if (
    storedHash.length !== 32
    || providedHash.length !== 32
    || !timingSafeEqual(storedHash, providedHash)
  ) throw policyDenied("Loop callback credential is invalid");
  return true;
}

function graphRunResult(run: { id: string; engineKind: string | null }): { id: string; engineKind: "graph_v1" } {
  if (run.engineKind !== "graph_v1") throw Object.assign(new Error("Trigger receipt is not associated with a graph run"), { code: "validation_failed" });
  return { id: run.id, engineKind: "graph_v1" };
}

export function fingerprintJsonValue(value: unknown): string {
  return `fingerprint:${sha256Canonical(value)}`;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw validationError("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((child) => child === undefined ? "null" : canonicalJson(child)).join(",")}]`;
  }
  if (!isPlainObject(value)) throw validationError("Value must be JSON serializable");
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  const nested = toNestedPrismaJson(value);
  return nested === null ? Prisma.JsonNull : nested;
}

function toNestedPrismaJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw validationError("JSON numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => child === undefined ? null : toNestedPrismaJson(child));
  }
  if (!isPlainObject(value)) throw validationError("Value must be JSON serializable");
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = toNestedPrismaJson(child);
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function readEventFingerprint(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const fingerprintValue = (payload as { eventFingerprint?: unknown }).eventFingerprint;
  return typeof fingerprintValue === "string" ? fingerprintValue : null;
}

function staleLeaseError(): Error & { code: "stale_lease" } {
  return Object.assign(new Error("Stale or expired loop attempt lease"), { code: "stale_lease" as const });
}

function staleEffectError(): Error & { code: "stale_effect" } {
  return Object.assign(new Error("Effect has already been resolved or is stale"), { code: "stale_effect" as const });
}

function validationError(message: string): Error & { code: "validation_failed" } {
  return Object.assign(new Error(message), { code: "validation_failed" as const });
}

function preparationLeaseLostError(): Error & { code: "preparation_lease_lost" } {
  return Object.assign(new Error("Scheduled task preparation lease was lost"), {
    code: "preparation_lease_lost" as const,
  });
}

function loopBindingUnavailableError(): Error & { code: "loop_binding_unavailable" } {
  return Object.assign(new Error("Loop definition is archived"), {
    code: "loop_binding_unavailable" as const,
  });
}

function policyDenied(message: string): Error & { code: "policy_denied" } {
  return Object.assign(new Error(message), { code: "policy_denied" as const });
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function isSerializationConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2034";
}
