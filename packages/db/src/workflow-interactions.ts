import { createHash } from "node:crypto";

import {
  interventionResolutionActionSchema,
  loopAuthoringGraphSchema,
  workflowInteractionDiscussionMessageSchema,
  workflowInteractionMessageInputSchema,
  workflowInteractionViewSchema,
  type OrchestrationActor,
  type OrchestrationCommand,
  type OrchestrationEventEnvelope,
  type WorkflowInteractionKind,
  type WorkflowInteractionMessageInput,
  type InterventionResolutionAction,
  type WorkflowInteractionStatus,
  type WorkflowInteractionView,
} from "@humanthread/shared";

import { boundedPersistenceId } from "./bounded-id";
import {
  projectWorkflowDiscussion,
  workflowSpeakerKey,
  type WorkflowDiscussionMessage,
  type WorkflowDiscussionProjection,
} from "./workflow-interaction-discussion";
import {
  executeIdempotentCommand,
  OrchestrationPersistenceError,
  type OrchestrationEventsTx,
} from "./orchestration-events";
import { prisma } from "./prisma";

type JsonRecord = Record<string, unknown>;
type MessageActor = Extract<OrchestrationActor, { type: "user" | "agent" | "system" }>;
type TerminalInteractionStatus = Exclude<WorkflowInteractionStatus, "open">;

interface WorkflowInteractionRow extends JsonRecord {
  id: string;
  projectId: string;
  taskId: string | null;
  loopRunId: string;
  loopNodeRunId: string;
  activationNo: number;
  kind: string;
  status: string;
  version: number;
  messageSequence?: number;
  createdAt: Date | string;
  closedAt: Date | string | null;
  messages?: unknown[];
  decision?: unknown | null;
  task?: {
    assigneeUserId: string | null;
    createdById: string;
    members: Array<{ userId: string }>;
  } | null;
  project?: { managerUserId: string | null } | null;
  loopNodeRun?: {
    id: string;
    loopRunId: string;
    nodeKey: string;
    activationNo: number;
    status: string;
    version: number;
    attemptCount: number;
    inputSnapshot: unknown;
    attempts: Array<{
      id: string;
      attempt: number;
      executorType: string;
      inputFingerprint: string;
      checkpoint: unknown;
    }>;
    loopRun: {
      id: string;
      status: string;
      statusReason: string | null;
      version: number;
      projectionVersion: number;
      transitionCount: number;
      repeatCount: number;
      runGraphSnapshot: unknown;
      loopVersion: { graph: unknown } | null;
    };
  };
}

interface LoopNodeRunRow {
  id: string;
  loopRunId: string;
  activationNo: number;
  status: string;
  loopRun: {
    id: string;
    projectId: string | null;
    taskId: string | null;
    status: string;
  };
}

interface RequirementAgentRunRow {
  id: string;
  taskId: string | null;
  loopRunId: string | null;
  loopNodeRunId: string | null;
  attempt: number;
  status: string;
  workerId: string | null;
  leaseGeneration: number;
  loopNodeAttempt: {
    id: string;
    loopNodeRunId: string;
    attempt: number;
    executorType: string;
    status: string;
    agentRunId: string | null;
    version: number;
  } | null;
}

export interface WorkflowInteractionTx extends OrchestrationEventsTx {
  agentRun: {
    findUnique(args: unknown): Promise<RequirementAgentRunRow | null>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  agentWorker: {
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  loopNodeAttempt: {
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  loopNodeRun: {
    findUnique(args: unknown): Promise<LoopNodeRunRow | null>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  loopRun: {
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  workflowInteraction: {
    create(args: { data: JsonRecord; include: JsonRecord }): Promise<WorkflowInteractionRow>;
    findUnique(args: unknown): Promise<WorkflowInteractionRow | null>;
    findMany(args: unknown): Promise<WorkflowInteractionRow[]>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  workflowInteractionMessage: {
    findUnique(args: unknown): Promise<{
      id: string;
      interactionId: string;
      sequence: number;
      interaction: { version: number };
    } | null>;
    create(args: { data: JsonRecord }): Promise<unknown>;
  };
  workflowInteractionAttachment: {
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  workflowInteractionMention: {
    createMany(args: { data: JsonRecord[] }): Promise<{ count: number }>;
  };
  workflowInteractionDecision: {
    create(args: { data: JsonRecord }): Promise<unknown>;
  };
}

export interface WorkflowInteractionDb {
  workflowInteraction: WorkflowInteractionTx["workflowInteraction"];
  $transaction<T>(
    callback: (tx: WorkflowInteractionTx) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export type WorkflowInteractionNotificationEvent =
  | "speaker_confirmation_required"
  | "all_speakers_confirmed"
  | "conflict_speaker_assigned"
  | "intervention_resolved";

export interface WorkflowInteractionNotificationInput {
  event: WorkflowInteractionNotificationEvent;
  interactionId: string;
  projectId: string;
  taskId: string | null;
  loopRunId: string;
  loopNodeRunId: string;
  actorUserId: string;
  recipientUserIds: string[];
  body: string;
  messageId?: string;
  version: number;
  occurredAt: Date;
}

export type WorkflowInteractionNotificationHook = (
  input: WorkflowInteractionNotificationInput,
  tx: WorkflowInteractionTx,
) => Promise<void>;

export interface WorkflowInterventionTx extends WorkflowInteractionTx {
  effectExecution: {
    create(args: { data: JsonRecord }): Promise<unknown>;
  };
  loopNodeRun: WorkflowInteractionTx["loopNodeRun"] & {
    findFirst(args: unknown): Promise<JsonRecord | null>;
    create(args: { data: JsonRecord }): Promise<unknown>;
  };
}

const DEFAULTS = { db: prisma as unknown as WorkflowInteractionDb };
const TERMINAL_LOOP_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "exhausted"]);
const TERMINAL_NODE_RUN_STATUSES = new Set(["succeeded", "failed", "blocked", "cancelled", "skipped"]);
const STRUCTURED_MESSAGE_ENVELOPE_KEY = "__humanthread_workflow_message_v1";
const INTERACTION_INCLUDE = {
  messages: {
    orderBy: { sequence: "asc" },
    include: {
      attachments: { select: { id: true } },
      mentions: { select: { userId: true } },
      actorUser: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
  decision: true,
} as const;

export interface CreateWorkflowInteractionInput {
  command: OrchestrationCommand<unknown>;
  id?: string;
  projectId: string;
  taskId: string | null;
  loopRunId: string;
  loopNodeRunId: string;
  activationNo: number;
  kind: WorkflowInteractionKind;
  policySnapshot?: unknown;
}

export async function createWorkflowInteraction(
  input: CreateWorkflowInteractionInput,
  dependencies: { db: WorkflowInteractionDb } = DEFAULTS,
): Promise<WorkflowInteractionView> {
  const id = workflowInteractionId(input);

  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "workflow_interaction", id },
    db: dependencies.db,
    apply: async (tx) => {
      const applied = await createWorkflowInteractionRecord(input, tx);
      return {
        ...applied,
        persist: async () => 1,
      };
    },
  });
}

export async function createWorkflowInteractionRecord(
  input: CreateWorkflowInteractionInput,
  tx: WorkflowInteractionTx,
): Promise<{ result: WorkflowInteractionView; events: OrchestrationEventEnvelope<JsonRecord>[] }> {
  const id = workflowInteractionId(input);
  const node = await tx.loopNodeRun.findUnique({
    where: { id: input.loopNodeRunId },
    include: { loopRun: { select: { id: true, projectId: true, taskId: true, status: true } } },
  });
  assertInteractionActivation(node, input);

  const result = workflowInteractionViewSchema.parse({
    id,
    projectId: input.projectId,
    taskId: input.taskId,
    loopRunId: input.loopRunId,
    loopNodeRunId: input.loopNodeRunId,
    activationNo: input.activationNo,
    kind: input.kind,
    status: "open",
    version: 1,
    createdAt: input.command.issuedAt.toISOString(),
    closedAt: null,
    messages: [],
    decision: null,
  });
  await tx.workflowInteraction.create({
    data: {
      id,
      projectId: input.projectId,
      taskId: input.taskId,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.loopNodeRunId,
      activationNo: input.activationNo,
      kind: input.kind,
      status: "open",
      version: 1,
      ...(input.policySnapshot === undefined ? {} : { policySnapshot: input.policySnapshot }),
      createdAt: input.command.issuedAt,
    },
    include: INTERACTION_INCLUDE,
  });
  return {
    result,
    events: [interactionEvent({
      command: input.command,
      eventType: "workflow.interaction.opened",
      interactionId: id,
      aggregateVersion: 1,
      payload: {
        projectId: input.projectId,
        taskId: input.taskId,
        loopRunId: input.loopRunId,
        loopNodeRunId: input.loopNodeRunId,
        activationNo: input.activationNo,
        kind: input.kind,
        status: "open",
      },
    })],
  };
}

export interface AppendWorkflowInteractionMessageInput {
  command: OrchestrationCommand<unknown>;
  interactionId: string;
  message: WorkflowInteractionMessageInput;
}

export interface AppendWorkflowInteractionMessageResult {
  interactionId: string;
  messageId: string;
  sequence: number;
  version: number;
}

export interface ConfirmLatestWorkflowPositionInput {
  interactionId: string;
  expectedLoopRunId?: string;
  actorUserId: string;
  commandId: string;
  occurredAt: Date;
}

export interface SubmitWorkflowInterventionInput {
  interactionId: string;
  expectedLoopRunId?: string;
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
  reason: string;
  action: InterventionResolutionAction;
  manualConflict?: boolean;
  occurredAt: Date;
}

export interface DelegateWorkflowConflictSpeakerInput {
  interactionId: string;
  expectedLoopRunId?: string;
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
  speakerUserId: string;
  occurredAt: Date;
}

export type DelegateWorkflowConflictSpeakerResult = {
  interactionId: string;
  version: number;
  activeSpeakerKey: string;
};

export type SubmitWorkflowInterventionResult = {
  interactionId: string;
  status: "confirmed" | "conflict_resolution";
  version: number;
  recovered: boolean;
  activeSpeakerKey?: string;
  action?: InterventionResolutionAction;
  nodeVersion?: number;
  loopRunVersion?: number;
  loopRunProjectionVersion?: number;
};

export async function appendWorkflowInteractionMessage(
  input: AppendWorkflowInteractionMessageInput,
  dependencies: { db: WorkflowInteractionDb } = DEFAULTS,
): Promise<AppendWorkflowInteractionMessageResult> {
  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "workflow_interaction", id: input.interactionId },
    db: dependencies.db,
    transactionOptions: { isolationLevel: "Serializable" },
    apply: async (tx) => {
      const applied = await appendWorkflowInteractionMessageRecord(input, tx);
      return {
        ...applied,
        persist: async () => 1,
      };
    },
  });
}

export async function confirmLatestWorkflowPosition(
  input: ConfirmLatestWorkflowPositionInput,
  dependencies: {
    db: WorkflowInteractionDb;
    notify?: WorkflowInteractionNotificationHook;
  } = DEFAULTS,
): Promise<AppendWorkflowInteractionMessageResult> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertValidDate(input.occurredAt);

  return executeSerializableInteractionCommand({
    command: {
      commandId: input.commandId,
      correlationId: `interaction:${input.interactionId}`,
      actor: { type: "user", id: input.actorUserId },
      payload: { action: "confirm_latest_position" },
      issuedAt: input.occurredAt,
    },
    interactionId: input.interactionId,
    db: dependencies.db,
    apply: async (tx) => {
      const row = await loadWorkflowInterventionRow(tx, input.interactionId);
      assertOpenDiscussionInteraction(row);
      if (input.expectedLoopRunId !== undefined && row.loopRunId !== input.expectedLoopRunId) {
        throw validationError("Workflow interaction LoopRun does not match the route");
      }
      if (!isCurrentDiscussionParticipant(row, input.actorUserId)) {
        throw authorizationError("Current Task participation is required");
      }
      const view = interactionViewFromRow(row);
      const discussion = view.discussionState as unknown as WorkflowDiscussionProjection;
      const speaker = discussion.speakers.find((entry) => entry.actorUserId === input.actorUserId);
      if (!speaker) throw authorizationError("Only a speaker can confirm their position");

      if (speaker.confirmed && speaker.confirmationMessageSequence !== null) {
        const stored = view.messages.find((message) => message.sequence === speaker.confirmationMessageSequence);
        if (stored) {
          return {
            result: {
              interactionId: input.interactionId,
              messageId: stored.id,
              sequence: stored.sequence,
              version: row.version,
            },
            events: [],
            persist: async () => 1,
          };
        }
      }

      const applied = await appendWorkflowInteractionMessageRecord({
        command: {
          commandId: input.commandId,
          correlationId: `interaction:${input.interactionId}`,
          actor: { type: "user", id: input.actorUserId },
          payload: { positionSequence: speaker.latestSequence },
          issuedAt: input.occurredAt,
        },
        interactionId: input.interactionId,
        message: {
          body: "",
          answers: {},
          attachmentIds: [],
          mentionedUserIds: [],
          discussion: {
            event: "speaker_confirmation",
            positionSequence: speaker.latestSequence,
            positionDigest: speaker.latestDigest,
          },
        },
      }, tx);
      if (dependencies.notify) {
        const nextRow = await loadWorkflowInterventionRow(tx, input.interactionId);
        const nextView = interactionViewFromRow(nextRow);
        const nextDiscussion = nextView.discussionState as unknown as WorkflowDiscussionProjection;
        await dependencies.notify({
          event: nextDiscussion.allSpeakersConfirmed ? "all_speakers_confirmed" : "speaker_confirmation_required",
          interactionId: nextRow.id,
          projectId: nextRow.projectId,
          taskId: nextRow.taskId,
          loopRunId: nextRow.loopRunId,
          loopNodeRunId: nextRow.loopNodeRunId,
          actorUserId: input.actorUserId,
          recipientUserIds: discussionNotificationRecipients(nextRow, input.actorUserId),
          body: nextDiscussion.allSpeakersConfirmed
            ? "所有发言人已确认最新意见，任务负责人可以提交。"
            : "有发言人确认了最新意见，仍需完成其余确认。",
          messageId: applied.result.messageId,
          version: applied.result.version,
          occurredAt: input.occurredAt,
        }, tx);
      }
      return { ...applied, persist: async () => 1 };
    },
  });
}

export async function delegateWorkflowConflictSpeaker(
  input: DelegateWorkflowConflictSpeakerInput,
  dependencies: {
    db: WorkflowInteractionDb;
    notify?: WorkflowInteractionNotificationHook;
  } = DEFAULTS,
): Promise<DelegateWorkflowConflictSpeakerResult> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertText(input.speakerUserId, "Conflict speaker user id");
  assertNonnegativeInteger(input.expectedVersion, "expectedVersion");
  assertValidDate(input.occurredAt);

  return executeSerializableInteractionCommand({
    command: {
      commandId: input.commandId,
      correlationId: `interaction:${input.interactionId}`,
      actor: { type: "user", id: input.actorUserId },
      expectedVersion: input.expectedVersion,
      payload: { speakerUserId: input.speakerUserId },
      issuedAt: input.occurredAt,
    },
    interactionId: input.interactionId,
    db: dependencies.db,
    apply: async (tx) => {
      const row = await loadWorkflowInterventionRow(tx, input.interactionId);
      assertOpenDiscussionInteraction(row);
      if (input.expectedLoopRunId !== undefined && row.loopRunId !== input.expectedLoopRunId) {
        throw validationError("Workflow interaction LoopRun does not match the route");
      }
      if (row.kind !== "runtime_intervention") {
        throw validationError("Workflow interaction is not a runtime intervention");
      }
      if (row.version !== input.expectedVersion) throw versionConflict("Workflow interaction changed");
      const policy = discussionPolicyState(row.policySnapshot);
      if (policy.phase !== "conflict_resolution") throw versionConflict("Workflow interaction phase changed");
      if (!row.project?.managerUserId || row.project.managerUserId !== input.actorUserId) {
        throw authorizationError("Only the Project responsible person can delegate conflict speech");
      }
      if (!isCurrentTaskParticipant(row, input.speakerUserId)) {
        throw authorizationError("Conflict speaker must be a current Task participant");
      }

      const activeSpeakerKey = workflowSpeakerKey(input.speakerUserId);
      const updated = await tx.workflowInteraction.updateMany({
        where: { id: row.id, status: "open", version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          policySnapshot: mergeDiscussionPolicy(row.policySnapshot, { activeSpeakerKey }),
        },
      });
      if (updated.count !== 1) throw versionConflict("Workflow interaction changed");
      const result: DelegateWorkflowConflictSpeakerResult = {
        interactionId: row.id,
        version: input.expectedVersion + 1,
        activeSpeakerKey,
      };
      if (dependencies.notify) {
        await dependencies.notify({
          event: "conflict_speaker_assigned",
          interactionId: row.id,
          projectId: row.projectId,
          taskId: row.taskId,
          loopRunId: row.loopRunId,
          loopNodeRunId: row.loopNodeRunId,
          actorUserId: input.actorUserId,
          recipientUserIds: discussionNotificationRecipients(row, input.actorUserId, [input.speakerUserId]),
          body: "你已被指定为冲突二次确认发言人。",
          version: result.version,
          occurredAt: input.occurredAt,
        }, tx);
      }
      return {
        result,
        events: [interactionEvent({
          command: {
            commandId: input.commandId,
            correlationId: `interaction:${row.id}`,
            actor: { type: "user", id: input.actorUserId },
            expectedVersion: input.expectedVersion,
            payload: {},
            issuedAt: input.occurredAt,
          },
          eventType: "workflow.interaction.conflict_speaker_delegated",
          interactionId: row.id,
          aggregateVersion: result.version,
          payload: { activeSpeakerKey },
        })],
        persist: async () => 1,
      };
    },
  });
}

export async function submitWorkflowIntervention(
  input: SubmitWorkflowInterventionInput,
  dependencies: {
    db: WorkflowInteractionDb;
    notify?: WorkflowInteractionNotificationHook;
  } = DEFAULTS,
): Promise<SubmitWorkflowInterventionResult> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertNonnegativeInteger(input.expectedVersion, "expectedVersion");
  assertValidDate(input.occurredAt);
  const action = interventionResolutionActionSchema.parse(input.action);

  return executeSerializableInteractionCommand({
    command: {
      commandId: input.commandId,
      correlationId: `interaction:${input.interactionId}`,
      actor: { type: "user", id: input.actorUserId },
      expectedVersion: input.expectedVersion,
      payload: { action, manualConflict: input.manualConflict === true },
      issuedAt: input.occurredAt,
    },
    interactionId: input.interactionId,
    db: dependencies.db,
    apply: async (transaction) => {
      const tx = transaction as WorkflowInterventionTx;
      const row = await loadWorkflowInterventionRow(tx, input.interactionId);
      assertOpenDiscussionInteraction(row);
      if (input.expectedLoopRunId !== undefined && row.loopRunId !== input.expectedLoopRunId) {
        throw validationError("Workflow interaction LoopRun does not match the route");
      }
      if (row.kind !== "runtime_intervention") {
        throw validationError("Workflow interaction is not a runtime intervention");
      }
      if (row.version !== input.expectedVersion) throw versionConflict("Workflow interaction changed");
      const view = interactionViewFromRow(row);
      const discussion = view.discussionState as unknown as WorkflowDiscussionProjection;
      const policy = discussionPolicyState(row.policySnapshot);

      if (discussion.phase === "conflict_resolution") {
        if (
          policy.phase !== "conflict_resolution"
          || workflowSpeakerKey(input.actorUserId) !== discussion.activeSpeakerKey
          || !isCurrentDiscussionParticipant(row, input.actorUserId)
        ) {
          throw authorizationError("Only the active conflict speaker can submit this intervention");
        }
        const speaker = discussion.speakers.find((entry) => entry.actorUserId === input.actorUserId);
        if (!speaker || speaker.latestSequence <= policy.conflictStartedSequence) {
          throw validationError("The active conflict speaker must post a new position before submission");
        }
        if (!speaker.confirmed) {
          await appendWorkflowInteractionMessageRecord({
            command: {
              commandId: input.commandId,
              correlationId: `interaction:${input.interactionId}`,
              actor: { type: "user", id: input.actorUserId },
              payload: { positionSequence: speaker.latestSequence },
              issuedAt: input.occurredAt,
            },
            interactionId: input.interactionId,
            message: {
              body: "",
              answers: {},
              attachmentIds: [],
              mentionedUserIds: [],
              discussion: {
                event: "speaker_confirmation",
                positionSequence: speaker.latestSequence,
                positionDigest: speaker.latestDigest,
              },
            },
          }, tx);
        }
      } else {
        if (!row.task || row.task.assigneeUserId !== input.actorUserId) {
          throw authorizationError("Only the Task assignee can submit this intervention");
        }
        if (!discussion.allSpeakersConfirmed) {
          throw validationError("Every speaker must confirm their latest position before submission");
        }
      }

      if (discussion.phase === "ordinary" && (discussion.hasConflict || input.manualConflict === true)) {
        const activeSpeakerUserId = row.project?.managerUserId ?? row.task?.assigneeUserId;
        if (!activeSpeakerUserId) throw validationError("Project responsible person is required for conflict resolution");
        const activeSpeakerKey = workflowSpeakerKey(activeSpeakerUserId);
        const updated = await tx.workflowInteraction.updateMany({
          where: { id: row.id, status: "open", version: input.expectedVersion },
          data: {
            version: { increment: 1 },
            policySnapshot: mergeDiscussionPolicy(row.policySnapshot, {
              phase: "conflict_resolution",
              activeSpeakerKey,
              conflictStartedSequence: row.messageSequence,
              manualConflict: input.manualConflict === true || hasManualConflict(discussion),
            }),
          },
        });
        if (updated.count !== 1) throw versionConflict("Workflow interaction changed");
        const result: SubmitWorkflowInterventionResult = {
          interactionId: row.id,
          status: "conflict_resolution",
          version: input.expectedVersion + 1,
          recovered: false,
          activeSpeakerKey,
        };
        if (dependencies.notify) {
          const activeSpeakerUserId = row.project?.managerUserId ?? row.task?.assigneeUserId;
          await dependencies.notify({
            event: "conflict_speaker_assigned",
            interactionId: row.id,
            projectId: row.projectId,
            taskId: row.taskId,
            loopRunId: row.loopRunId,
            loopNodeRunId: row.loopNodeRunId,
            actorUserId: input.actorUserId,
            recipientUserIds: discussionNotificationRecipients(row, input.actorUserId, activeSpeakerUserId ? [activeSpeakerUserId] : []),
            body: "讨论存在冲突，已进入二次人工确认。",
            version: result.version,
            occurredAt: input.occurredAt,
          }, tx);
        }
        return {
          result,
          events: [interactionEvent({
            command: {
              commandId: input.commandId,
              correlationId: `interaction:${row.id}`,
              actor: { type: "user", id: input.actorUserId },
              expectedVersion: input.expectedVersion,
              payload: {},
              issuedAt: input.occurredAt,
            },
            eventType: "workflow.interaction.conflict_detected",
            interactionId: row.id,
            aggregateVersion: result.version,
            payload: { activeSpeakerKey, conflictTopics: discussion.conflicts.map((conflict) => conflict.topicKey) },
          })],
          persist: async () => 1,
        };
      }

      const closed = await closeWorkflowInteraction({
        interactionId: row.id,
        expectedVersion: input.expectedVersion,
        status: "confirmed",
        actor: { type: "user", id: input.actorUserId },
        commandId: input.commandId,
        reason: input.reason.trim() || null,
        selectedEdgeId: action.type,
        occurredAt: input.occurredAt,
      }, tx);
      const recovery = await applyWorkflowInterventionResolution({ row, action, input }, tx);
      await createWorkflowInterventionEffect({ row, action, input }, tx);
      const result: SubmitWorkflowInterventionResult = {
        interactionId: row.id,
        status: "confirmed",
        version: closed.version,
        recovered: true,
        action,
        ...recovery,
      };
      if (dependencies.notify) {
        await dependencies.notify({
          event: "intervention_resolved",
          interactionId: row.id,
          projectId: row.projectId,
          taskId: row.taskId,
          loopRunId: row.loopRunId,
          loopNodeRunId: row.loopNodeRunId,
          actorUserId: input.actorUserId,
          recipientUserIds: discussionNotificationRecipients(row, input.actorUserId),
          body: input.reason.trim() || "人工介入已提交，运行已恢复。",
          version: result.version,
          occurredAt: input.occurredAt,
        }, tx);
      }
      return {
        result,
        events: [interactionEvent({
          command: {
            commandId: input.commandId,
            correlationId: `interaction:${row.id}`,
            actor: { type: "user", id: input.actorUserId },
            expectedVersion: input.expectedVersion,
            payload: {},
            issuedAt: input.occurredAt,
          },
          eventType: "workflow.interaction.resolved",
          interactionId: row.id,
          aggregateVersion: closed.version,
          payload: { action, loopRunId: row.loopRunId, loopNodeRunId: row.loopNodeRunId },
        })],
        persist: async () => 1,
      };
    },
  });
}

export async function appendWorkflowInteractionMessageRecord(
  input: AppendWorkflowInteractionMessageInput,
  tx: WorkflowInteractionTx,
): Promise<{
  result: AppendWorkflowInteractionMessageResult;
  events: OrchestrationEventEnvelope<JsonRecord>[];
}> {
  const message = workflowInteractionMessageInputSchema.parse(input.message);
  const actor = requireMessageActor(input.command.actor);
  const messageId = boundedPersistenceId(
    "workflow-message",
    [input.interactionId, input.command.commandId],
    128,
  );
  const existingMessage = await tx.workflowInteractionMessage.findUnique({
    where: { interactionId_commandId: { interactionId: input.interactionId, commandId: input.command.commandId } },
    select: { id: true, interactionId: true, sequence: true, interaction: { select: { version: true } } },
  });
  if (existingMessage) {
    return {
      result: {
        interactionId: existingMessage.interactionId,
        messageId: existingMessage.id,
        sequence: existingMessage.sequence,
        version: existingMessage.interaction.version,
      },
      events: [],
    };
  }

  const interaction = await tx.workflowInteraction.findUnique({
    where: { id: input.interactionId },
    select: {
      id: true,
      kind: true,
      status: true,
      version: true,
      messageSequence: true,
      policySnapshot: true,
      task: {
        select: {
          assigneeUserId: true,
          createdById: true,
          members: { select: { userId: true } },
        },
      },
      project: { select: { managerUserId: true } },
    },
  });
  if (!interaction) throw validationError("Workflow interaction not found");
  if (interaction.status !== "open") throw validationError("Workflow interaction is read-only");
  const persistedMessage = actor.type === "user"
    && interaction.kind === "runtime_intervention"
    && message.discussion === undefined
    ? { ...message, discussion: { event: "position" as const } }
    : message;
  const discussionPolicy = discussionPolicyState(interaction.policySnapshot);
  if (
    discussionPolicy.phase === "conflict_resolution"
    && (
      actor.type !== "user"
      || workflowSpeakerKey(actor.id) !== discussionPolicy.activeSpeakerKey
      || !isCurrentDiscussionParticipant(interaction, actor.id)
    )
  ) {
    throw authorizationError("Only the active conflict speaker can post during conflict resolution");
  }

  const updated = await tx.workflowInteraction.updateMany({
    where: { id: input.interactionId, status: "open" },
    data: { messageSequence: { increment: 1 } },
  });
  if (updated.count !== 1) throw validationError("Workflow interaction is read-only");
  const reserved = await tx.workflowInteraction.findUnique({
    where: { id: input.interactionId },
    select: { id: true, status: true, version: true, messageSequence: true },
  });
  const reservedSequence = reserved?.messageSequence;
  if (!reserved || reserved.status !== "open" || typeof reservedSequence !== "number" || !Number.isInteger(reservedSequence) || reservedSequence < 1) {
    throw versionConflict("Workflow interaction message sequence changed");
  }
  const result = {
    interactionId: input.interactionId,
    messageId,
    sequence: reservedSequence,
    version: reserved.version,
  };

  await tx.workflowInteractionMessage.create({
    data: {
      id: messageId,
      interactionId: input.interactionId,
      sequence: result.sequence,
      actorType: actor.type,
      actorId: actor.id,
      actorUserId: actor.type === "user" ? actor.id : null,
      commandId: input.command.commandId,
      body: message.body,
      structuredAnswers: encodeStructuredMessage(persistedMessage),
      createdAt: input.command.issuedAt,
    },
  });

  const attachmentIds = unique(message.attachmentIds);
  if (attachmentIds.length > 0) {
    const attachments = await tx.workflowInteractionAttachment.updateMany({
      where: {
        id: { in: attachmentIds },
        interactionId: input.interactionId,
        messageId: null,
        scanStatus: "safe",
        ...(actor.type === "user" ? { uploadedByUserId: actor.id } : {}),
      },
      data: { messageId },
    });
    if (attachments.count !== attachmentIds.length) {
      throw validationError("Workflow interaction attachment is invalid");
    }
  }

  const mentionedUserIds = unique(message.mentionedUserIds);
  if (mentionedUserIds.length > 0) {
    await tx.workflowInteractionMention.createMany({
      data: mentionedUserIds.map((userId) => ({
        id: boundedPersistenceId("workflow-mention", [messageId, userId], 128),
        interactionId: input.interactionId,
        messageId,
        userId,
        createdAt: input.command.issuedAt,
      })),
    });
  }
  return {
    result,
    events: [interactionEvent({
      command: input.command,
      eventType: "workflow.interaction.message_appended",
      interactionId: input.interactionId,
      aggregateVersion: result.version,
      payload: {
        messageId,
        sequence: result.sequence,
        actorType: actor.type,
        actorId: actor.id,
      },
    })],
  };
}

export interface CloseWorkflowInteractionInput {
  interactionId: string;
  expectedVersion: number;
  status: TerminalInteractionStatus;
  actor: MessageActor;
  commandId: string;
  reason: string | null;
  selectedEdgeId: string | null;
  occurredAt: Date;
}

export interface CloseWorkflowInteractionResult {
  interactionId: string;
  status: TerminalInteractionStatus;
  version: number;
}

export interface ResumeWaitingInputNodeInput {
  nodeRunId: string;
  nodeRunVersion: number;
  loopRunId: string;
  loopRunVersion: number;
  loopRunProjectionVersion: number;
  occurredAt: Date;
}

export interface PauseNodeForRequirementInputInput {
  agentRunId: string;
  nodeRunId: string;
  nodeRunVersion: number;
  loopRunId: string;
  loopRunStatus: "pending" | "running";
  loopRunVersion: number;
  loopRunProjectionVersion: number;
  occurredAt: Date;
}

export interface ResumeWaitingInputNodeResult {
  nodeVersion: number;
  loopRunVersion: number;
  loopRunProjectionVersion: number;
}

export async function pauseNodeForRequirementInput(
  input: PauseNodeForRequirementInputInput,
  tx: WorkflowInteractionTx,
): Promise<ResumeWaitingInputNodeResult> {
  const agentRun = await tx.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: {
      id: true,
      taskId: true,
      loopRunId: true,
      loopNodeRunId: true,
      attempt: true,
      status: true,
      workerId: true,
      leaseGeneration: true,
      loopNodeAttempt: {
        select: {
          id: true,
          loopNodeRunId: true,
          attempt: true,
          executorType: true,
          status: true,
          agentRunId: true,
          version: true,
        },
      },
    },
  });
  const attempt = agentRun?.loopNodeAttempt;
  if (
    !agentRun
    || agentRun.taskId !== null
    || agentRun.loopRunId !== input.loopRunId
    || agentRun.loopNodeRunId !== input.nodeRunId
    || !["claimed", "starting", "running", "waiting_approval"].includes(agentRun.status)
    || !agentRun.workerId
    || !attempt
    || attempt.loopNodeRunId !== input.nodeRunId
    || attempt.attempt !== agentRun.attempt
    || attempt.executorType !== "local"
    || attempt.status !== "running"
    || attempt.agentRunId !== input.agentRunId
  ) throw versionConflict("Workflow interaction AgentRun changed");

  const cancelledAttempt = await tx.loopNodeAttempt.updateMany({
    where: {
      id: attempt.id,
      loopNodeRunId: input.nodeRunId,
      attempt: attempt.attempt,
      executorType: "local",
      agentRunId: input.agentRunId,
      status: "running",
      version: attempt.version,
    },
    data: {
      status: "cancelled",
      error: { code: "requirement_input", agentRunId: input.agentRunId },
      finishedAt: input.occurredAt,
      version: { increment: 1 },
    },
  });
  if (cancelledAttempt.count !== 1) throw versionConflict("Workflow interaction attempt changed");

  const cancelledAgentRun = await tx.agentRun.updateMany({
    where: {
      id: input.agentRunId,
      taskId: null,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.nodeRunId,
      attempt: agentRun.attempt,
      leaseGeneration: agentRun.leaseGeneration,
      status: { in: ["claimed", "starting", "running", "waiting_approval"] },
    },
    data: {
      status: "cancelled",
      leaseGeneration: agentRun.leaseGeneration + 1,
      leaseExpiresAt: input.occurredAt,
      exitReason: "requirement_input",
      finishedAt: input.occurredAt,
      version: { increment: 1 },
    },
  });
  if (cancelledAgentRun.count !== 1) throw versionConflict("Workflow interaction AgentRun changed");

  const releasedCapacity = await tx.agentWorker.updateMany({
    where: { id: agentRun.workerId, activeRunCount: { gt: 0 } },
    data: { activeRunCount: { decrement: 1 }, version: { increment: 1 } },
  });
  if (releasedCapacity.count !== 1) throw versionConflict("Workflow interaction Worker capacity changed");

  const node = await tx.loopNodeRun.updateMany({
    where: {
      id: input.nodeRunId,
      loopRunId: input.loopRunId,
      status: "running",
      version: input.nodeRunVersion,
    },
    data: {
      status: "waiting_input",
      waitingReason: "requirement_input",
      version: { increment: 1 },
    },
  });
  if (node.count !== 1) throw versionConflict("Workflow interaction node changed");

  const loopRun = await tx.loopRun.updateMany({
    where: {
      id: input.loopRunId,
      status: input.loopRunStatus,
      version: input.loopRunVersion,
      projectionVersion: input.loopRunProjectionVersion,
    },
    data: {
      status: "waiting",
      version: { increment: 1 },
      projectionVersion: { increment: 1 },
    },
  });
  if (loopRun.count !== 1) throw versionConflict("Workflow interaction LoopRun changed");

  return {
    nodeVersion: input.nodeRunVersion + 1,
    loopRunVersion: input.loopRunVersion + 1,
    loopRunProjectionVersion: input.loopRunProjectionVersion + 1,
  };
}

export async function closeWorkflowInteraction(
  input: CloseWorkflowInteractionInput,
  tx: WorkflowInteractionTx,
): Promise<CloseWorkflowInteractionResult> {
  assertNonnegativeInteger(input.expectedVersion, "expectedVersion");
  const updated = await tx.workflowInteraction.updateMany({
    where: { id: input.interactionId, status: "open", version: input.expectedVersion },
    data: { status: input.status, version: { increment: 1 }, closedAt: input.occurredAt },
  });
  if (updated.count !== 1) throw versionConflict("Workflow interaction changed");

  await tx.workflowInteractionDecision.create({
    data: {
      id: boundedPersistenceId("workflow-decision", [input.interactionId], 128),
      interactionId: input.interactionId,
      commandId: input.commandId,
      decision: input.status,
      actorType: input.actor.type,
      actorId: input.actor.id,
      actorUserId: input.actor.type === "user" ? input.actor.id : null,
      reason: input.reason,
      selectedEdgeId: input.selectedEdgeId,
      createdAt: input.occurredAt,
    },
  });

  return {
    interactionId: input.interactionId,
    status: input.status,
    version: input.expectedVersion + 1,
  };
}

export async function resumeWaitingInputNode(
  input: ResumeWaitingInputNodeInput,
  tx: WorkflowInteractionTx,
): Promise<ResumeWaitingInputNodeResult> {
  const node = await tx.loopNodeRun.updateMany({
    where: {
      id: input.nodeRunId,
      loopRunId: input.loopRunId,
      status: "waiting_input",
      version: input.nodeRunVersion,
    },
    data: {
      status: "ready",
      waitingReason: null,
      readyAt: input.occurredAt,
      version: { increment: 1 },
    },
  });
  if (node.count !== 1) throw versionConflict("Workflow interaction node changed");

  const loopRun = await tx.loopRun.updateMany({
    where: {
      id: input.loopRunId,
      status: "waiting",
      version: input.loopRunVersion,
      projectionVersion: input.loopRunProjectionVersion,
    },
    data: {
      status: "running",
      version: { increment: 1 },
      projectionVersion: { increment: 1 },
    },
  });
  if (loopRun.count !== 1) throw versionConflict("Workflow interaction LoopRun changed");

  return {
    nodeVersion: input.nodeRunVersion + 1,
    loopRunVersion: input.loopRunVersion + 1,
    loopRunProjectionVersion: input.loopRunProjectionVersion + 1,
  };
}

export async function getWorkflowInteraction(
  input: { id: string },
  dependencies: { db: WorkflowInteractionDb } = DEFAULTS,
): Promise<WorkflowInteractionView | null> {
  const row = await dependencies.db.workflowInteraction.findUnique({
    where: { id: input.id },
    include: INTERACTION_INCLUDE,
  });
  return row ? interactionViewFromRow(row) : null;
}

export async function listLoopRunInteractions(
  input: { loopRunId: string },
  dependencies: { db: WorkflowInteractionDb } = DEFAULTS,
): Promise<WorkflowInteractionView[]> {
  const rows = await dependencies.db.workflowInteraction.findMany({
    where: { loopRunId: input.loopRunId },
    orderBy: [{ createdAt: "asc" }, { activationNo: "asc" }, { id: "asc" }],
    include: INTERACTION_INCLUDE,
  });
  return rows.map(interactionViewFromRow);
}

function assertInteractionActivation(
  node: LoopNodeRunRow | null,
  input: Pick<CreateWorkflowInteractionInput, "projectId" | "taskId" | "loopRunId" | "loopNodeRunId" | "activationNo">,
): asserts node is LoopNodeRunRow {
  if (!node || node.id !== input.loopNodeRunId || node.loopRunId !== input.loopRunId) {
    throw validationError("Workflow interaction node activation not found");
  }
  if (node.activationNo !== input.activationNo) {
    throw validationError("Workflow interaction activation does not match the node");
  }
  if (node.loopRun.projectId !== input.projectId || node.loopRun.taskId !== input.taskId) {
    throw validationError("Workflow interaction ownership does not match the LoopRun");
  }
  if (TERMINAL_LOOP_RUN_STATUSES.has(node.loopRun.status) || TERMINAL_NODE_RUN_STATUSES.has(node.status)) {
    throw validationError("Workflow interaction history is read-only");
  }
}

function interactionViewFromRow(row: WorkflowInteractionRow): WorkflowInteractionView {
  const messages = Array.isArray(row.messages) ? row.messages : [];
  const decision = row.decision && typeof row.decision === "object"
    ? row.decision as JsonRecord
    : null;
  const policySnapshot = row.policySnapshot;
  const projectedMessages = messages.map((value) => {
    const message = value as JsonRecord;
    const actorUser = record(message.actorUser);
    const storedStructuredAnswers = record(message.structuredAnswers) ?? {};
    const structured = decodeStructuredMessage(storedStructuredAnswers);
    const discussion = structured.discussion ?? (
      row.kind === "runtime_intervention"
      && message.actorType === "user"
      && !Object.prototype.hasOwnProperty.call(storedStructuredAnswers, STRUCTURED_MESSAGE_ENVELOPE_KEY)
        ? { event: "position" as const }
        : undefined
    );
    const actorUserId = typeof message.actorUserId === "string"
      ? message.actorUserId
      : typeof actorUser?.id === "string" ? actorUser.id : null;
    const actorDisplayName = typeof actorUser?.name === "string" ? actorUser.name : null;
    const actorAvatarUrl = typeof actorUser?.avatarUrl === "string" ? actorUser.avatarUrl : null;
    return {
      id: message.id,
      sequence: message.sequence,
      actorType: message.actorType,
      actorId: message.actorId,
      ...(actorUserId === null ? {} : { actorUserId }),
      ...(actorDisplayName === null ? {} : { actorDisplayName }),
      ...(actorAvatarUrl === null ? {} : { actorAvatarUrl }),
      commandId: message.commandId,
      body: message.body,
      answers: structured.answers,
      ...(discussion === undefined ? {} : { discussion }),
      createdAt: isoDate(message.createdAt as Date | string),
      attachmentIds: relationValues(message.attachments, "id"),
      mentionedUserIds: relationValues(message.mentions, "userId"),
    };
  });
  const discussionState = projectWorkflowDiscussion({
    messages: projectedMessages as WorkflowDiscussionMessage[],
    policySnapshot,
  });
  return workflowInteractionViewSchema.parse({
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    loopRunId: row.loopRunId,
    loopNodeRunId: row.loopNodeRunId,
    activationNo: row.activationNo,
    kind: row.kind,
    status: row.status,
    version: row.version,
    createdAt: isoDate(row.createdAt),
    closedAt: row.closedAt === null ? null : isoDate(row.closedAt),
    messages: projectedMessages,
    ...(policySnapshot === undefined ? {} : { policySnapshot }),
    discussionState,
    decision: decision === null ? null : {
      id: decision.id,
      decision: decision.decision,
      actorType: decision.actorType,
      actorId: decision.actorId,
      reason: decision.reason ?? null,
      createdAt: isoDate(decision.createdAt as Date | string),
      selectedEdgeId: decision.selectedEdgeId ?? null,
    },
  });
}

async function loadWorkflowInterventionRow(
  tx: WorkflowInteractionTx,
  interactionId: string,
): Promise<WorkflowInteractionRow> {
  const row = await tx.workflowInteraction.findUnique({
    where: { id: interactionId },
    include: {
      ...INTERACTION_INCLUDE,
      task: {
        select: {
          assigneeUserId: true,
          createdById: true,
          members: { select: { userId: true } },
        },
      },
      project: { select: { managerUserId: true } },
      loopNodeRun: {
        select: {
          id: true,
          loopRunId: true,
          nodeKey: true,
          activationNo: true,
          status: true,
          version: true,
          attemptCount: true,
          inputSnapshot: true,
          attempts: {
            orderBy: { attempt: "desc" },
            take: 1,
            select: {
              id: true,
              attempt: true,
              executorType: true,
              inputFingerprint: true,
              checkpoint: true,
            },
          },
          loopRun: {
            select: {
              id: true,
              status: true,
              statusReason: true,
              version: true,
              projectionVersion: true,
              transitionCount: true,
              repeatCount: true,
              runGraphSnapshot: true,
              loopVersion: { select: { graph: true } },
            },
          },
        },
      },
    },
  });
  if (!row) throw validationError("Workflow interaction not found");
  return row;
}

function discussionNotificationRecipients(
  row: WorkflowInteractionRow,
  actorUserId: string,
  extra: string[] = [],
) {
  return [...new Set([
    row.project?.managerUserId,
    row.task?.assigneeUserId,
    row.task?.createdById,
    ...(row.task?.members ?? []).map((member) => member.userId),
    ...extra,
  ].filter((userId): userId is string => Boolean(userId) && userId !== actorUserId))];
}

function assertOpenDiscussionInteraction(row: WorkflowInteractionRow): void {
  if (row.status !== "open") throw versionConflict("Workflow interaction changed");
  if (row.kind !== "runtime_intervention" && row.kind !== "requirement_conversation") {
    throw validationError("Workflow interaction does not support open discussion");
  }
}

function isCurrentDiscussionParticipant(row: WorkflowInteractionRow, actorUserId: string): boolean {
  return row.task?.assigneeUserId === actorUserId
    || row.task?.createdById === actorUserId
    || row.project?.managerUserId === actorUserId
    || row.task?.members.some((member) => member.userId === actorUserId) === true;
}

function isCurrentTaskParticipant(row: WorkflowInteractionRow, actorUserId: string): boolean {
  return row.task?.assigneeUserId === actorUserId
    || row.task?.createdById === actorUserId
    || row.task?.members.some((member) => member.userId === actorUserId) === true;
}

function discussionPolicyState(value: unknown): {
  phase: "ordinary" | "conflict_resolution";
  activeSpeakerKey: string | null;
  conflictStartedSequence: number;
} {
  const snapshot = record(value);
  const discussion = record(snapshot?.discussion);
  const activeSpeakerKey = typeof discussion?.activeSpeakerKey === "string"
    ? discussion.activeSpeakerKey
    : null;
  if (discussion?.phase === "conflict_resolution" && activeSpeakerKey && /^[0-9a-f]{32}$/u.test(activeSpeakerKey)) {
    return {
      phase: "conflict_resolution",
      activeSpeakerKey,
      conflictStartedSequence: typeof discussion.conflictStartedSequence === "number"
        && Number.isInteger(discussion.conflictStartedSequence)
        && discussion.conflictStartedSequence >= 0
        ? discussion.conflictStartedSequence
        : 0,
    };
  }
  return { phase: "ordinary", activeSpeakerKey: null, conflictStartedSequence: 0 };
}

function mergeDiscussionPolicy(
  value: unknown,
  discussion: Record<string, unknown>,
): JsonRecord {
  const snapshot = record(value) ?? {};
  return {
    ...snapshot,
    discussion: {
      ...(record(snapshot.discussion) ?? {}),
      ...discussion,
    },
  };
}

function hasManualConflict(discussion: WorkflowDiscussionProjection): boolean {
  return discussion.conflicts.some((conflict) => conflict.manual === true);
}

async function createWorkflowInterventionEffect(
  context: {
    row: WorkflowInteractionRow;
    action: InterventionResolutionAction;
    input: SubmitWorkflowInterventionInput;
  },
  tx: WorkflowInterventionTx,
): Promise<void> {
  const requestFingerprint = `sha256:${createHash("sha256")
    .update(JSON.stringify({ action: context.action, reason: context.input.reason.trim() }))
    .digest("hex")}`;
  await tx.effectExecution.create({
    data: {
      id: boundedPersistenceId("workflow-effect", [context.row.id], 128),
      effectKey: `workflow-intervention:${context.row.id}`,
      loopRunId: context.row.loopRunId,
      nodeRunId: context.row.loopNodeRunId,
      ...(context.row.loopNodeRun?.attempts[0]?.id
        ? { attemptId: context.row.loopNodeRun.attempts[0].id }
        : {}),
      operationType: "workflow_intervention_resolution",
      requestFingerprint,
      providerIdempotencyKey: context.input.commandId,
      status: "resolved",
      providerReceipt: context.action,
      resultFingerprint: requestFingerprint,
      resolvedAt: context.input.occurredAt,
    },
  });
}

async function applyWorkflowInterventionResolution(
  context: {
    row: WorkflowInteractionRow;
    action: InterventionResolutionAction;
    input: SubmitWorkflowInterventionInput;
  },
  tx: WorkflowInterventionTx,
): Promise<{
  nodeVersion: number;
  loopRunVersion: number;
  loopRunProjectionVersion: number;
}> {
  const node = context.row.loopNodeRun;
  if (!node) throw validationError("Workflow intervention node not found");
  const run = node.loopRun;
  if (node.status !== "waiting_intervention" || run.status !== "waiting") {
    throw versionConflict("Workflow intervention runtime changed");
  }

  if (context.action.type === "route_upstream") {
    return routeWorkflowInterventionUpstream({
      row: context.row,
      action: context.action,
      input: context.input,
    }, node, run, tx);
  }

  if (context.action.type === "resume_checkpoint" && node.attempts[0]?.checkpoint == null) {
    throw validationError("Workflow intervention checkpoint is unavailable");
  }
  const terminal = context.action.type === "terminate";
  const updatedNode = await tx.loopNodeRun.updateMany({
    where: { id: node.id, loopRunId: node.loopRunId, status: "waiting_intervention", version: node.version },
    data: terminal
      ? {
          status: "cancelled",
          waitingReason: null,
          finishedAt: context.input.occurredAt,
          version: { increment: 1 },
        }
      : {
          status: "ready",
          waitingReason: null,
          readyAt: context.input.occurredAt,
          startedAt: null,
          finishedAt: null,
          version: { increment: 1 },
        },
  });
  if (updatedNode.count !== 1) throw versionConflict("Workflow intervention node changed");
  const updatedRun = await tx.loopRun.updateMany({
    where: {
      id: run.id,
      status: "waiting",
      version: run.version,
      projectionVersion: run.projectionVersion,
    },
    data: terminal
      ? {
          status: "cancelled",
          statusReason: "intervention_terminated",
          stopReason: context.input.reason.trim() || "intervention_terminated",
          finishedAt: context.input.occurredAt,
          version: { increment: 1 },
          projectionVersion: { increment: 1 },
        }
      : {
          status: "running",
          statusReason: null,
          version: { increment: 1 },
          projectionVersion: { increment: 1 },
        },
  });
  if (updatedRun.count !== 1) throw versionConflict("Workflow intervention LoopRun changed");
  return {
    nodeVersion: node.version + 1,
    loopRunVersion: run.version + 1,
    loopRunProjectionVersion: run.projectionVersion + 1,
  };
}

async function routeWorkflowInterventionUpstream(
  context: {
    row: WorkflowInteractionRow;
    action: Extract<InterventionResolutionAction, { type: "route_upstream" }>;
    input: SubmitWorkflowInterventionInput;
  },
  node: NonNullable<WorkflowInteractionRow["loopNodeRun"]>,
  run: NonNullable<WorkflowInteractionRow["loopNodeRun"]>["loopRun"],
  tx: WorkflowInterventionTx,
): Promise<{
  nodeVersion: number;
  loopRunVersion: number;
  loopRunProjectionVersion: number;
}> {
  const graph = loopAuthoringGraphSchema.safeParse(run.runGraphSnapshot ?? run.loopVersion?.graph);
  if (!graph.success) throw validationError("Workflow intervention graph snapshot is invalid");
  const edge = graph.data.edges.find((candidate) => (
    candidate.source === node.nodeKey
    && candidate.target === context.action.targetNodeKey
    && candidate.kind === "feedback"
  ));
  if (!edge) throw validationError("Workflow intervention upstream route is invalid");
  const previousTarget = await tx.loopNodeRun.findFirst({
    where: { loopRunId: run.id, nodeKey: context.action.targetNodeKey },
    orderBy: { activationNo: "desc" },
    select: { activationNo: true, inputSnapshot: true },
  });
  if (!previousTarget || typeof previousTarget.activationNo !== "number") {
    throw validationError("Workflow intervention upstream node has no prior activation");
  }
  const targetActivationNo = previousTarget.activationNo + 1;
  await tx.loopNodeRun.create({
    data: {
      id: boundedPersistenceId("loop-node", [run.id, context.action.targetNodeKey, String(targetActivationNo)], 96),
      loopRunId: run.id,
      nodeKey: context.action.targetNodeKey,
      activationNo: targetActivationNo,
      status: "ready",
      inputSnapshot: previousTarget.inputSnapshot,
      attemptCount: 0,
      version: 1,
      readyAt: context.input.occurredAt,
    },
  });
  const updatedNode = await tx.loopNodeRun.updateMany({
    where: { id: node.id, loopRunId: node.loopRunId, status: "waiting_intervention", version: node.version },
    data: {
      status: "blocked",
      waitingReason: "intervention:routed_upstream",
      finishedAt: context.input.occurredAt,
      version: { increment: 1 },
    },
  });
  if (updatedNode.count !== 1) throw versionConflict("Workflow intervention node changed");
  const updatedRun = await tx.loopRun.updateMany({
    where: { id: run.id, status: "waiting", version: run.version, projectionVersion: run.projectionVersion },
    data: {
      status: "running",
      statusReason: null,
      transitionCount: { increment: 1 },
      repeatCount: { increment: 1 },
      version: { increment: 1 },
      projectionVersion: { increment: 1 },
    },
  });
  if (updatedRun.count !== 1) throw versionConflict("Workflow intervention LoopRun changed");
  return {
    nodeVersion: node.version + 1,
    loopRunVersion: run.version + 1,
    loopRunProjectionVersion: run.projectionVersion + 1,
  };
}

async function executeSerializableInteractionCommand<TResult>(input: {
  command: OrchestrationCommand<unknown>;
  interactionId: string;
  db: WorkflowInteractionDb;
  apply(tx: WorkflowInteractionTx): Promise<{
    result: TResult;
    events: OrchestrationEventEnvelope<JsonRecord>[];
    persist(tx: WorkflowInteractionTx): Promise<number>;
  }>;
}): Promise<TResult> {
  for (let retry = 0; retry < 2; retry += 1) {
    try {
      return await executeIdempotentCommand({
        command: input.command,
        aggregate: { type: "workflow_interaction", id: input.interactionId },
        db: input.db,
        transactionOptions: { isolationLevel: "Serializable" },
        apply: input.apply,
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === "P2034" && retry === 0) continue;
      if (code === "P2002") throw versionConflict("Workflow interaction was already resolved");
      throw error;
    }
  }
  throw versionConflict("Workflow interaction transaction could not be completed");
}

function encodeStructuredMessage(message: WorkflowInteractionMessageInput): JsonRecord {
  if (message.discussion === undefined) return message.answers;
  return {
    [STRUCTURED_MESSAGE_ENVELOPE_KEY]: {
      answers: message.answers,
      discussion: message.discussion,
    },
  };
}

function decodeStructuredMessage(value: unknown): {
  answers: Record<string, string[]>;
  discussion?: WorkflowInteractionMessageInput["discussion"];
} {
  const stored = record(value) ?? {};
  const envelope = record(stored[STRUCTURED_MESSAGE_ENVELOPE_KEY]);
  if (!envelope) return { answers: answerRecord(stored) };
  const discussion = workflowInteractionDiscussionMessageSchema.safeParse(envelope.discussion);
  return {
    answers: answerRecord(record(envelope.answers) ?? {}),
    ...(discussion.success && discussion.data !== undefined ? { discussion: discussion.data } : {}),
  };
}

function answerRecord(value: Record<string, unknown>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, entries]) => (
    Array.isArray(entries) && entries.every((entry) => typeof entry === "string")
      ? [[key, entries as string[]]]
      : []
  )));
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function interactionEvent(input: {
  command: OrchestrationCommand<unknown>;
  eventType: string;
  interactionId: string;
  aggregateVersion: number;
  payload: JsonRecord;
}): OrchestrationEventEnvelope<JsonRecord> {
  return {
    id: boundedPersistenceId("event", [input.interactionId, input.eventType, input.command.commandId], 128),
    eventType: input.eventType,
    aggregateType: "workflow_interaction",
    aggregateId: input.interactionId,
    aggregateVersion: input.aggregateVersion,
    sequence: input.aggregateVersion,
    correlationId: input.command.correlationId,
    ...(input.command.causationId === undefined ? {} : { causationId: input.command.causationId }),
    commandId: input.command.commandId,
    actorType: input.command.actor.type,
    actorId: input.command.actor.id,
    occurredAt: input.command.issuedAt,
    payload: input.payload,
  };
}

function workflowInteractionId(input: CreateWorkflowInteractionInput): string {
  assertPositiveInteger(input.activationNo, "activationNo");
  return input.id ?? boundedPersistenceId(
    "workflow-interaction",
    [input.loopNodeRunId, String(input.activationNo), input.kind],
    96,
  );
}

function requireMessageActor(actor: OrchestrationActor): MessageActor {
  if (actor.type === "worker") throw validationError("Worker cannot author workflow interaction messages");
  return actor;
}

function relationValues(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = (entry as JsonRecord)[field];
    return typeof candidate === "string" ? [candidate] : [];
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw validationError(`${name} is invalid`);
}

function assertNonnegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw validationError(`${name} is invalid`);
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw validationError(`${name} is required`);
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw validationError("Workflow interaction time is invalid");
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
}

function validationError(message: string): OrchestrationPersistenceError {
  return new OrchestrationPersistenceError("validation_failed", message);
}

function authorizationError(message: string): OrchestrationPersistenceError {
  return new OrchestrationPersistenceError("authorization_denied", message);
}

function versionConflict(message: string): OrchestrationPersistenceError {
  return new OrchestrationPersistenceError("version_conflict", message);
}
