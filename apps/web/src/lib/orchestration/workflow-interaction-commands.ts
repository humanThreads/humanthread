import {
  loopAuthoringGraphSchema,
  type OrchestrationActor,
  type OrchestrationEventEnvelope,
  type WorkflowInteractionMessageInput,
} from "@humanthread/shared";
import {
  assertCanCommentOnTask,
  assertCanDispatchTaskAgent,
  assertCanReadProject,
  assertCanReadTask,
  appendWorkflowInteractionMessageRecord,
  closeWorkflowInteraction,
  confirmLatestWorkflowPosition as confirmLatestWorkflowPositionRecord,
  createWorkflowInteractionRecord,
  delegateWorkflowConflictSpeaker as delegateWorkflowConflictSpeakerRecord,
  executeIdempotentCommand,
  pauseNodeForRequirementInput,
  prisma,
  resumeWaitingInputNode,
  routeGateDecision,
  requestRuntimeIntervention as requestRuntimeInterventionRecord,
  submitWorkflowIntervention as submitWorkflowInterventionRecord,
  type AppendWorkflowInteractionMessageResult,
  type CloseWorkflowInteractionInput,
  type CloseWorkflowInteractionResult,
  type LoopGateRoutingDb,
  type OrchestrationEventsTx,
  type PauseNodeForRequirementInputInput,
  type ResumeWaitingInputNodeInput,
  type ResumeWaitingInputNodeResult,
  type WorkflowInteractionTx,
  type RequestRuntimeInterventionResult,
  type ConfirmLatestWorkflowPositionInput as ConfirmLatestWorkflowPositionRecordInput,
  type DelegateWorkflowConflictSpeakerInput as DelegateWorkflowConflictSpeakerRecordInput,
  type DelegateWorkflowConflictSpeakerResult,
  type SubmitWorkflowInterventionInput as SubmitWorkflowInterventionRecordInput,
  type SubmitWorkflowInterventionResult,
  type WorkflowInteractionDb,
  type WorkflowInteractionNotificationHook,
} from "../../../../../packages/db/src/index";
import { boundedPersistenceId } from "../../../../../packages/db/src/bounded-id";
import {
  evaluateWorkflowInteractionPermission,
  type WorkflowInteractionPermissionAction,
  type WorkflowInteractionPermissionRole,
} from "../../../../../packages/orchestration-core/src/workflow-interaction-policy";
import { resolveWorkflowMentions } from "./workflow-interaction-participants";
import {
  enqueueInteractionNotifications,
  resolveInteractionNotificationRecipients,
} from "./workflow-interaction-notifications";

type JsonRecord = Record<string, unknown>;

const COLLABORATION_NOTIFICATION_TEMPLATES = {
  speaker_confirmation_required: "workflow_speaker_confirmation_required",
  all_speakers_confirmed: "workflow_all_speakers_confirmed",
  conflict_speaker_assigned: "workflow_conflict_speaker_assigned",
  intervention_resolved: "workflow_intervention_resolved",
} as const;

const workflowInteractionNotificationHook: WorkflowInteractionNotificationHook = async (input, tx) => {
  await enqueueInteractionNotifications(tx as never, {
    projectId: input.projectId,
    loopRunId: input.loopRunId,
    loopNodeRunId: input.loopNodeRunId,
    interactionId: input.interactionId,
    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
    templateKey: COLLABORATION_NOTIFICATION_TEMPLATES[input.event],
    body: input.body,
    recipientUserIds: input.recipientUserIds,
    occurredAt: input.occurredAt,
    dedupeKey: `${input.event}:${input.messageId ?? input.version}`,
  });
};

export interface WorkflowInteractionMutationState {
  permissionRole: WorkflowInteractionPermissionRole;
  terminal: boolean;
  interaction: {
    id: string;
    projectId: string;
    taskId: string | null;
    kind: string;
    status: string;
    version: number;
    loopRunId: string;
    loopNodeRunId: string;
  };
  node: {
    id: string;
    loopRunId: string;
    status: string;
    version: number;
    loopRunStatus: string;
    loopRunVersion: number;
    loopRunProjectionVersion: number;
  };
}

interface WorkflowInteractionCommandDb {
  $transaction<T>(callback: (tx: OrchestrationEventsTx) => Promise<T>): Promise<T>;
}

export interface WorkflowInteractionCommandDependencies {
  db: WorkflowInteractionCommandDb;
  loadAuthorizedForMutation(
    tx: OrchestrationEventsTx,
    input: {
      interactionId: string;
      actorUserId: string;
      actorType?: OrchestrationActor["type"];
      action: WorkflowInteractionPermissionAction;
    },
  ): Promise<WorkflowInteractionMutationState>;
  closeWorkflowInteraction(
    input: CloseWorkflowInteractionInput,
    tx: WorkflowInteractionTx,
  ): Promise<CloseWorkflowInteractionResult>;
  resumeWaitingInputNode(
    input: ResumeWaitingInputNodeInput,
    tx: WorkflowInteractionTx,
  ): Promise<ResumeWaitingInputNodeResult>;
  resolveInteractionNotificationRecipients?: typeof resolveInteractionNotificationRecipients;
  enqueueInteractionNotifications?: typeof enqueueInteractionNotifications;
}

export interface WorkflowInteractionOpenState {
  permissionRole: WorkflowInteractionPermissionRole;
  terminal: boolean;
  agentRunId: string;
  projectId: string;
  taskId: string | null;
  loopRunId: string;
  loopNodeRunId: string;
  activationNo: number;
  policySnapshot: unknown;
  nodeRunVersion: number;
  loopRunStatus: "pending" | "running";
  loopRunVersion: number;
  loopRunProjectionVersion: number;
}

interface OpenRequirementDependencies {
  db: WorkflowInteractionCommandDb;
  loadAuthorizedNodeForOpen(
    tx: OrchestrationEventsTx,
    input: { loopNodeRunId: string; actorUserId: string; actorType: OrchestrationActor["type"] },
  ): Promise<WorkflowInteractionOpenState>;
  createWorkflowInteractionRecord: typeof createWorkflowInteractionRecord;
  appendWorkflowInteractionMessageRecord: typeof appendWorkflowInteractionMessageRecord;
  pauseNodeForRequirementInput(
    input: PauseNodeForRequirementInputInput,
    tx: WorkflowInteractionTx,
  ): Promise<ResumeWaitingInputNodeResult>;
  resolveInteractionNotificationRecipients?: typeof resolveInteractionNotificationRecipients;
  enqueueInteractionNotifications?: typeof enqueueInteractionNotifications;
}

interface AppendRequirementDependencies {
  db: WorkflowInteractionCommandDb;
  loadAuthorizedForMutation: WorkflowInteractionCommandDependencies["loadAuthorizedForMutation"];
  appendWorkflowInteractionMessageRecord: typeof appendWorkflowInteractionMessageRecord;
  resolveWorkflowMentions: typeof resolveWorkflowMentions;
  enqueueInteractionNotifications?: typeof enqueueInteractionNotifications;
}

interface DecideWorkflowInteractionDependencies {
  db: WorkflowInteractionCommandDb;
  loadAuthorizedForMutation: WorkflowInteractionCommandDependencies["loadAuthorizedForMutation"];
  closeWorkflowInteraction: WorkflowInteractionCommandDependencies["closeWorkflowInteraction"];
  routeGateDecision: typeof routeGateDecision;
  resolveInteractionNotificationRecipients?: typeof resolveInteractionNotificationRecipients;
  enqueueInteractionNotifications?: typeof enqueueInteractionNotifications;
}

interface RuntimeInterventionTarget {
  attemptId: string;
  loopRunId: string;
  loopNodeRunId: string;
  taskId: string | null;
  projectId: string | null;
}

interface RequestRuntimeInterventionDependencies {
  resolveAttemptTarget: (input: { loopNodeAttemptId?: string; loopRunId?: string }) => Promise<RuntimeInterventionTarget | null>;
  requestRuntimeIntervention: typeof requestRuntimeInterventionRecord;
  assertCanCommentOnTask: typeof assertCanCommentOnTask;
  assertCanDispatchTaskAgent: typeof assertCanDispatchTaskAgent;
}

interface WorkflowInterventionCollaborationDependencies {
  confirmLatestWorkflowPosition(input: ConfirmLatestWorkflowPositionRecordInput): Promise<AppendWorkflowInteractionMessageResult>;
  delegateWorkflowConflictSpeaker(input: DelegateWorkflowConflictSpeakerRecordInput): Promise<DelegateWorkflowConflictSpeakerResult>;
  submitWorkflowIntervention(input: SubmitWorkflowInterventionRecordInput): Promise<SubmitWorkflowInterventionResult>;
}

const RUNTIME_INTERVENTION_DEFAULTS: RequestRuntimeInterventionDependencies = {
  resolveAttemptTarget: resolveRuntimeInterventionTargetWithPrisma,
  requestRuntimeIntervention: requestRuntimeInterventionRecord,
  assertCanCommentOnTask,
  assertCanDispatchTaskAgent,
};

const WORKFLOW_INTERVENTION_COLLABORATION_DEFAULTS: WorkflowInterventionCollaborationDependencies = {
  confirmLatestWorkflowPosition: (input) => confirmLatestWorkflowPositionRecord(input, {
    db: prisma as unknown as WorkflowInteractionDb,
    notify: workflowInteractionNotificationHook,
  }),
  delegateWorkflowConflictSpeaker: (input) => delegateWorkflowConflictSpeakerRecord(input, {
    db: prisma as unknown as WorkflowInteractionDb,
    notify: workflowInteractionNotificationHook,
  }),
  submitWorkflowIntervention: (input) => submitWorkflowInterventionRecord(input, {
    db: prisma as unknown as WorkflowInteractionDb,
    notify: workflowInteractionNotificationHook,
  }),
};

export interface RequestRuntimeInterventionCommandInput {
  actor: OrchestrationActor;
  actorUserId: string;
  commandId: string;
  loopNodeAttemptId?: string;
  loopRunId?: string;
  reason: string;
  evidence?: unknown;
  reviewPages?: Array<{ token: string; fileName: string; byteSize: number; checksum: string }>;
  occurredAt: Date;
}

export async function requestRuntimeIntervention(
  input: RequestRuntimeInterventionCommandInput,
  dependencies: RequestRuntimeInterventionDependencies = RUNTIME_INTERVENTION_DEFAULTS,
): Promise<RequestRuntimeInterventionResult> {
  if (!input.actorUserId.trim()) throw validationError("Actor user id is required");
  if (!input.commandId.trim()) throw validationError("Command id is required");
  if (!input.reason.trim()) throw validationError("Intervention reason is required");
  if ((input.loopNodeAttemptId === undefined) === (input.loopRunId === undefined)) {
    throw validationError("Exactly one intervention target is required");
  }
  if (input.actor.type === "agent" && input.loopNodeAttemptId === undefined) {
    throw authorizationDenied("Agent intervention requires an active Attempt");
  }
  if (input.actor.type === "user" && input.loopRunId === undefined) {
    throw validationError("User intervention requires a LoopRun");
  }

  const target = await dependencies.resolveAttemptTarget({
    ...(input.loopNodeAttemptId === undefined ? {} : { loopNodeAttemptId: input.loopNodeAttemptId }),
    ...(input.loopRunId === undefined ? {} : { loopRunId: input.loopRunId }),
  });
  if (!target) throw validationError("No active Loop execution was found");
  if (input.actor.type === "user") {
    if (!target.taskId) throw authorizationDenied("Task collaboration access is required");
    await dependencies.assertCanCommentOnTask({ userId: input.actorUserId, taskId: target.taskId });
  } else if (target.taskId) {
    await dependencies.assertCanDispatchTaskAgent({ userId: input.actorUserId, taskId: target.taskId });
  }

  return dependencies.requestRuntimeIntervention({
    loopNodeAttemptId: target.attemptId,
    actor: input.actor,
    commandId: input.commandId,
    reason: input.reason,
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(input.reviewPages === undefined ? {} : { reviewPages: input.reviewPages }),
    occurredAt: input.occurredAt,
    correlationId: `loop:${target.loopRunId}`,
  });
}

export async function confirmLatestWorkflowPosition(
  input: ConfirmLatestWorkflowPositionRecordInput,
  dependencies: Pick<WorkflowInterventionCollaborationDependencies, "confirmLatestWorkflowPosition"> = WORKFLOW_INTERVENTION_COLLABORATION_DEFAULTS,
): Promise<AppendWorkflowInteractionMessageResult> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertValidDate(input.occurredAt);
  return dependencies.confirmLatestWorkflowPosition(input);
}

export async function submitWorkflowIntervention(
  input: SubmitWorkflowInterventionRecordInput,
  dependencies: Pick<WorkflowInterventionCollaborationDependencies, "submitWorkflowIntervention"> = WORKFLOW_INTERVENTION_COLLABORATION_DEFAULTS,
): Promise<SubmitWorkflowInterventionResult> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertExpectedVersion(input.expectedVersion);
  assertValidDate(input.occurredAt);
  return dependencies.submitWorkflowIntervention(input);
}

export async function delegateWorkflowConflictSpeaker(
  input: DelegateWorkflowConflictSpeakerRecordInput,
  dependencies: Pick<WorkflowInterventionCollaborationDependencies, "delegateWorkflowConflictSpeaker"> = WORKFLOW_INTERVENTION_COLLABORATION_DEFAULTS,
): Promise<DelegateWorkflowConflictSpeakerResult> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertText(input.speakerUserId, "Conflict speaker user id");
  assertExpectedVersion(input.expectedVersion);
  assertValidDate(input.occurredAt);
  return dependencies.delegateWorkflowConflictSpeaker(input);
}

export interface ConfirmRequirementInput {
  interactionId: string;
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
  expectedLoopRunId?: string;
  reason: string;
  occurredAt: Date;
}

export type ConfirmRequirementResult = CloseWorkflowInteractionResult & ResumeWaitingInputNodeResult;

const DEFAULTS: WorkflowInteractionCommandDependencies = {
  db: prisma as unknown as WorkflowInteractionCommandDb,
  loadAuthorizedForMutation: loadAuthorizedForMutationWithPrisma,
  closeWorkflowInteraction,
  resumeWaitingInputNode,
  resolveInteractionNotificationRecipients,
  enqueueInteractionNotifications,
};

const OPEN_DEFAULTS: OpenRequirementDependencies = {
  db: prisma as unknown as WorkflowInteractionCommandDb,
  loadAuthorizedNodeForOpen: loadAuthorizedNodeForOpenWithPrisma,
  createWorkflowInteractionRecord,
  appendWorkflowInteractionMessageRecord,
  pauseNodeForRequirementInput,
  resolveInteractionNotificationRecipients,
  enqueueInteractionNotifications,
};

const APPEND_DEFAULTS: AppendRequirementDependencies = {
  db: prisma as unknown as WorkflowInteractionCommandDb,
  loadAuthorizedForMutation: loadAuthorizedForMutationWithPrisma,
  appendWorkflowInteractionMessageRecord,
  resolveWorkflowMentions,
  enqueueInteractionNotifications,
};

const DECISION_DEFAULTS: DecideWorkflowInteractionDependencies = {
  db: prisma as unknown as WorkflowInteractionCommandDb,
  loadAuthorizedForMutation: loadAuthorizedForMutationWithPrisma,
  closeWorkflowInteraction,
  routeGateDecision,
  resolveInteractionNotificationRecipients,
  enqueueInteractionNotifications,
};

interface AuthorizedInteractionRow {
  id: string;
  projectId: string;
  taskId: string | null;
  kind: string;
  status: string;
  version: number;
  loopRunId: string;
  loopNodeRunId: string;
  project: { managerUserId: string | null };
  loopNodeRun: {
    id: string;
    loopRunId: string;
    status: string;
    version: number;
    loopRun: { status: string; version: number; projectionVersion: number };
  };
}

interface WorkflowInteractionAuthorizationTx extends OrchestrationEventsTx {
  workflowInteraction: {
    findUnique(args: unknown): Promise<AuthorizedInteractionRow | null>;
  };
}

interface AuthorizedOpenNodeRow {
  id: string;
  nodeKey: string;
  activationNo: number;
  attemptCount: number;
  status: string;
  version: number;
  attempts: Array<{
    attempt: number;
    agentRunId: string | null;
  }>;
  loopRun: {
    id: string;
    projectId: string | null;
    taskId: string | null;
    status: string;
    version: number;
    projectionVersion: number;
    loopVersion: { graph: unknown } | null;
  };
}

interface WorkflowInteractionOpenTx extends OrchestrationEventsTx {
  loopNodeRun: {
    findUnique(args: unknown): Promise<AuthorizedOpenNodeRow | null>;
  };
}

export interface OpenRequirementConversationInput {
  actor: OrchestrationActor;
  actorUserId: string;
  commandId: string;
  loopNodeRunId: string;
  expectedLoopRunId?: string;
  message: WorkflowInteractionMessageInput;
  occurredAt: Date;
}

export type OpenRequirementConversationResult = AppendWorkflowInteractionMessageResult
  & ResumeWaitingInputNodeResult;

export async function openRequirementConversation(
  input: OpenRequirementConversationInput,
  dependencies: OpenRequirementDependencies = OPEN_DEFAULTS,
): Promise<OpenRequirementConversationResult> {
  if (input.actor.type !== "agent") throw authorizationDenied("Only an Agent can open a requirement conversation");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertText(input.loopNodeRunId, "Loop node run id");
  assertValidDate(input.occurredAt);
  return executeIdempotentCommand({
    command: {
      commandId: input.commandId,
      correlationId: `loop-node:${input.loopNodeRunId}`,
      actor: input.actor,
      payload: { loopNodeRunId: input.loopNodeRunId },
      issuedAt: input.occurredAt,
    },
    aggregate: { type: "loop_node", id: input.loopNodeRunId },
    db: dependencies.db,
    apply: async (tx) => {
      const state = await dependencies.loadAuthorizedNodeForOpen(tx, {
        loopNodeRunId: input.loopNodeRunId,
        actorUserId: input.actorUserId,
        actorType: input.actor.type,
      });
      if (input.expectedLoopRunId !== undefined && state.loopRunId !== input.expectedLoopRunId) {
        throw validationError("Workflow interaction LoopRun does not match the route");
      }
      const permission = evaluateWorkflowInteractionPermission({
        role: state.permissionRole,
        action: "open",
        terminal: state.terminal,
      });
      assertMutationPermission(permission);

      const opened = await dependencies.createWorkflowInteractionRecord({
        command: {
          commandId: input.commandId,
          correlationId: `loop:${state.loopRunId}`,
          actor: input.actor,
          payload: {},
          issuedAt: input.occurredAt,
        },
        projectId: state.projectId,
        taskId: state.taskId,
        loopRunId: state.loopRunId,
        loopNodeRunId: state.loopNodeRunId,
        activationNo: state.activationNo,
        kind: "requirement_conversation",
        policySnapshot: state.policySnapshot,
      }, tx as WorkflowInteractionTx);
      const question = await dependencies.appendWorkflowInteractionMessageRecord({
        command: {
          commandId: `${input.commandId}:question`,
          correlationId: `loop:${state.loopRunId}`,
          causationId: input.commandId,
          actor: input.actor,
          payload: {},
          issuedAt: input.occurredAt,
        },
        interactionId: opened.result.id,
        message: input.message,
      }, tx as WorkflowInteractionTx);
      const runtime = await dependencies.pauseNodeForRequirementInput({
        agentRunId: state.agentRunId,
        nodeRunId: state.loopNodeRunId,
        nodeRunVersion: state.nodeRunVersion,
        loopRunId: state.loopRunId,
        loopRunStatus: state.loopRunStatus,
        loopRunVersion: state.loopRunVersion,
        loopRunProjectionVersion: state.loopRunProjectionVersion,
        occurredAt: input.occurredAt,
      }, tx as WorkflowInteractionTx);
      if (dependencies.resolveInteractionNotificationRecipients && dependencies.enqueueInteractionNotifications) {
        const recipients = await dependencies.resolveInteractionNotificationRecipients({
          projectId: state.projectId,
          taskId: state.taskId,
          audience: "requirement_pending",
          actorUserId: input.actorUserId,
        }, { db: tx as never });
        await dependencies.enqueueInteractionNotifications(tx as never, {
          projectId: state.projectId,
          loopRunId: state.loopRunId,
          loopNodeRunId: state.loopNodeRunId,
          interactionId: opened.result.id,
          messageId: question.result.messageId,
          templateKey: "workflow_requirement_pending",
          body: input.message.body,
          recipientUserIds: recipients,
          occurredAt: input.occurredAt,
        });
      }
      const result = { ...question.result, ...runtime };
      return {
        result,
        events: [
          ...opened.events,
          ...question.events,
          nodeStateEvent({
            eventType: "loop.node.waiting_input",
            commandId: input.commandId,
            actor: input.actor,
            nodeRunId: state.loopNodeRunId,
            nodeVersion: runtime.nodeVersion,
            loopRunId: state.loopRunId,
            occurredAt: input.occurredAt,
            payload: { waitingReason: "requirement_input", interactionId: opened.result.id },
          }),
        ],
        persist: async () => 1,
      };
    },
  });
}

export interface AppendRequirementMessageInput {
  interactionId: string;
  actor: OrchestrationActor;
  actorUserId: string;
  commandId: string;
  expectedLoopRunId?: string;
  message: WorkflowInteractionMessageInput;
  occurredAt: Date;
}

export async function appendRequirementMessage(
  input: AppendRequirementMessageInput,
  dependencies: AppendRequirementDependencies = APPEND_DEFAULTS,
): Promise<AppendWorkflowInteractionMessageResult> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertValidDate(input.occurredAt);

  return executeIdempotentCommand({
    command: {
      commandId: input.commandId,
      correlationId: `interaction:${input.interactionId}`,
      actor: input.actor,
      payload: {},
      issuedAt: input.occurredAt,
    },
    aggregate: { type: "workflow_interaction", id: input.interactionId },
    db: dependencies.db,
    apply: async (tx) => {
      const state = await dependencies.loadAuthorizedForMutation(tx, {
        interactionId: input.interactionId,
        actorUserId: input.actorUserId,
        actorType: input.actor.type,
        action: "reply",
      });
      if (input.expectedLoopRunId !== undefined && state.interaction.loopRunId !== input.expectedLoopRunId) {
        throw validationError("Workflow interaction LoopRun does not match the route");
      }
      const permission = evaluateWorkflowInteractionPermission({
        role: state.permissionRole,
        action: "reply",
        terminal: state.terminal,
      });
      assertMutationPermission(permission);
      if (!new Set(["requirement_conversation", "runtime_intervention"]).has(state.interaction.kind)) {
        throw validationError("Workflow interaction does not support discussion messages");
      }
      const mentionedUserIds = input.message.mentionedUserIds.length > 0
        ? await dependencies.resolveWorkflowMentions({
            projectId: state.interaction.projectId,
            mentionedUserIds: input.message.mentionedUserIds,
            actorUserId: input.actorUserId,
          }, { db: tx as never })
        : [];
      const applied = await dependencies.appendWorkflowInteractionMessageRecord({
        command: {
          commandId: input.commandId,
          correlationId: `interaction:${input.interactionId}`,
          actor: input.actor,
          payload: {},
          issuedAt: input.occurredAt,
        },
        interactionId: input.interactionId,
        message: { ...input.message, mentionedUserIds },
      }, tx as WorkflowInteractionTx);
      if (mentionedUserIds.length > 0 && dependencies.enqueueInteractionNotifications) {
        await dependencies.enqueueInteractionNotifications(tx as never, {
          projectId: state.interaction.projectId,
          loopRunId: state.interaction.loopRunId,
          loopNodeRunId: state.interaction.loopNodeRunId,
          interactionId: input.interactionId,
          messageId: applied.result.messageId,
          templateKey: "workflow_mention",
          body: input.message.body,
          recipientUserIds: mentionedUserIds,
          occurredAt: input.occurredAt,
        });
      }
      return { ...applied, persist: async () => 1 };
    },
  });
}

export interface DecideWorkflowInteractionInput {
  interactionId: string;
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
  expectedLoopRunId?: string;
  decision: "approved" | "rejected";
  reason: string;
  selectedEdgeId: string;
  occurredAt: Date;
}

export async function decideWorkflowInteraction(
  input: DecideWorkflowInteractionInput,
  dependencies: DecideWorkflowInteractionDependencies = DECISION_DEFAULTS,
): Promise<CloseWorkflowInteractionResult & { selectedEdgeId: string; routed: unknown }> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertText(input.selectedEdgeId, "Selected edge id");
  assertExpectedVersion(input.expectedVersion);
  assertValidDate(input.occurredAt);
  if (input.decision === "rejected" && !input.reason.trim()) {
    throw validationError("Rejection reason is required");
  }

  return executeIdempotentCommand({
    command: {
      commandId: input.commandId,
      correlationId: `interaction:${input.interactionId}`,
      actor: { type: "user", id: input.actorUserId },
      expectedVersion: input.expectedVersion,
      payload: { decision: input.decision, selectedEdgeId: input.selectedEdgeId },
      issuedAt: input.occurredAt,
    },
    aggregate: { type: "workflow_interaction", id: input.interactionId },
    db: dependencies.db,
    apply: async (tx) => {
      const state = await dependencies.loadAuthorizedForMutation(tx, {
        interactionId: input.interactionId,
        actorUserId: input.actorUserId,
        actorType: "user",
        action: "release_decide",
      });
      if (input.expectedLoopRunId !== undefined && state.interaction.loopRunId !== input.expectedLoopRunId) {
        throw validationError("Workflow interaction LoopRun does not match the route");
      }
      const permission = evaluateWorkflowInteractionPermission({
        role: state.permissionRole,
        action: "release_decide",
        terminal: state.terminal,
      });
      assertMutationPermission(permission);
      if (state.interaction.kind !== "business_approval") {
        throw validationError("Workflow interaction is not a business approval");
      }
      if (state.interaction.status !== "open" || state.interaction.version !== input.expectedVersion) {
        throw versionConflict("Workflow interaction changed");
      }

      const closed = await dependencies.closeWorkflowInteraction({
        interactionId: input.interactionId,
        expectedVersion: input.expectedVersion,
        status: input.decision,
        actor: { type: "user", id: input.actorUserId },
        commandId: input.commandId,
        reason: input.reason.trim() || null,
        selectedEdgeId: input.selectedEdgeId,
        occurredAt: input.occurredAt,
      }, tx as WorkflowInteractionTx);
      const routed = await dependencies.routeGateDecision({
        command: {
          commandId: `${input.commandId}:route`,
          correlationId: `loop:${state.interaction.loopRunId}`,
          causationId: input.commandId,
          actor: { type: "user", id: input.actorUserId },
          payload: { interactionId: input.interactionId },
          issuedAt: input.occurredAt,
        },
        loopRunId: state.interaction.loopRunId,
        loopNodeRunId: state.interaction.loopNodeRunId,
        decision: {
          outcome: input.decision === "approved" ? "pass" : "reject",
          reasonCode: `workflow_interaction_${input.decision}`,
          message: input.reason.trim(),
          evidenceRefs: [`interaction:${input.interactionId}`],
          selectedEdgeId: input.selectedEdgeId,
        },
      }, {
        db: {
          $transaction: (callback) => callback(tx as unknown as Parameters<Parameters<LoopGateRoutingDb["$transaction"]>[0]>[0]),
        },
      });
      if (dependencies.resolveInteractionNotificationRecipients && dependencies.enqueueInteractionNotifications) {
        const recipients = await dependencies.resolveInteractionNotificationRecipients({
          projectId: state.interaction.projectId,
          taskId: state.interaction.taskId,
          audience: "interaction_decided",
          actorUserId: input.actorUserId,
        }, { db: tx as never });
        await dependencies.enqueueInteractionNotifications(tx as never, {
          projectId: state.interaction.projectId,
          loopRunId: state.interaction.loopRunId,
          loopNodeRunId: state.interaction.loopNodeRunId,
          interactionId: input.interactionId,
          templateKey: "workflow_interaction_decided",
          body: input.reason,
          recipientUserIds: recipients,
          occurredAt: input.occurredAt,
        });
      }
      const result = { ...closed, selectedEdgeId: input.selectedEdgeId, routed };
      return {
        result,
        events: [interactionDecisionEvent(input, closed.version, state.interaction.loopNodeRunId)],
        persist: async () => 1,
      };
    },
  });
}

export async function confirmRequirement(
  input: ConfirmRequirementInput,
  dependencies: WorkflowInteractionCommandDependencies = DEFAULTS,
): Promise<ConfirmRequirementResult> {
  assertText(input.interactionId, "Workflow interaction id");
  assertText(input.actorUserId, "Actor user id");
  assertText(input.commandId, "Command id");
  assertExpectedVersion(input.expectedVersion);
  assertValidDate(input.occurredAt);

  return executeIdempotentCommand({
    command: {
      commandId: input.commandId,
      correlationId: `interaction:${input.interactionId}`,
      actor: { type: "user", id: input.actorUserId },
      expectedVersion: input.expectedVersion,
      payload: { reason: input.reason.trim() },
      issuedAt: input.occurredAt,
    },
    aggregate: { type: "workflow_interaction", id: input.interactionId },
    db: dependencies.db,
    apply: async (tx) => {
      const state = await dependencies.loadAuthorizedForMutation(tx, {
        interactionId: input.interactionId,
        actorUserId: input.actorUserId,
        action: "confirm",
      });
      if (input.expectedLoopRunId !== undefined && state.interaction.loopRunId !== input.expectedLoopRunId) {
        throw validationError("Workflow interaction LoopRun does not match the route");
      }
      const permission = evaluateWorkflowInteractionPermission({
        role: state.permissionRole,
        action: "confirm",
        terminal: state.terminal,
      });
      assertMutationPermission(permission);
      if (state.interaction.kind !== "requirement_conversation") {
        throw validationError("Workflow interaction is not a requirement conversation");
      }
      if (state.interaction.status !== "open" || state.interaction.version !== input.expectedVersion) {
        throw versionConflict("Workflow interaction changed");
      }
      if (state.node.status !== "waiting_input" || state.node.loopRunStatus !== "waiting") {
        throw versionConflict("Workflow interaction runtime changed");
      }

      const interaction = await dependencies.closeWorkflowInteraction({
        interactionId: input.interactionId,
        expectedVersion: input.expectedVersion,
        status: "confirmed",
        actor: { type: "user", id: input.actorUserId },
        commandId: input.commandId,
        reason: input.reason.trim() || null,
        selectedEdgeId: null,
        occurredAt: input.occurredAt,
      }, tx as WorkflowInteractionTx);
      const runtime = await dependencies.resumeWaitingInputNode({
        nodeRunId: state.node.id,
        nodeRunVersion: state.node.version,
        loopRunId: state.node.loopRunId,
        loopRunVersion: state.node.loopRunVersion,
        loopRunProjectionVersion: state.node.loopRunProjectionVersion,
        occurredAt: input.occurredAt,
      }, tx as WorkflowInteractionTx);
      const result = { ...interaction, ...runtime };
      if (dependencies.resolveInteractionNotificationRecipients && dependencies.enqueueInteractionNotifications) {
        const recipients = await dependencies.resolveInteractionNotificationRecipients({
          projectId: state.interaction.projectId,
          taskId: state.interaction.taskId,
          audience: "interaction_decided",
          actorUserId: input.actorUserId,
        }, { db: tx as never });
        await dependencies.enqueueInteractionNotifications(tx as never, {
          projectId: state.interaction.projectId,
          loopRunId: state.interaction.loopRunId,
          loopNodeRunId: state.interaction.loopNodeRunId,
          interactionId: input.interactionId,
          templateKey: "workflow_interaction_decided",
          body: input.reason,
          recipientUserIds: recipients,
          occurredAt: input.occurredAt,
        });
      }

      return {
        result,
        events: confirmationEvents(input, state, result),
        persist: async () => 1,
      };
    },
  });
}

async function resolveRuntimeInterventionTargetWithPrisma(input: {
  loopNodeAttemptId?: string;
  loopRunId?: string;
}): Promise<RuntimeInterventionTarget | null> {
  const where = input.loopNodeAttemptId
    ? { id: input.loopNodeAttemptId }
    : {
        OR: [
          {
            loopNodeRun: {
              loopRunId: input.loopRunId as string,
              status: "running",
              loopRun: { status: "running" },
            },
            status: "running",
          },
          {
            loopNodeRun: {
              loopRunId: input.loopRunId as string,
              workflowInteractions: { some: { kind: "runtime_intervention" } },
            },
            status: { in: ["running", "blocked"] },
          },
        ],
      };
  const attempt = await (prisma.loopNodeAttempt as never as {
    findFirst(args: unknown): Promise<{
      id: string;
      loopNodeRunId: string;
      loopNodeRun: { loopRunId: string; loopRun: { projectId: string | null; taskId: string | null } };
    } | null>;
  }).findFirst({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      loopNodeRunId: true,
      loopNodeRun: {
        select: {
          loopRunId: true,
          loopRun: { select: { projectId: true, taskId: true } },
        },
      },
    },
  });
  if (!attempt) return null;
  if (input.loopRunId !== undefined && attempt.loopNodeRun.loopRunId !== input.loopRunId) return null;
  return {
    attemptId: attempt.id,
    loopRunId: attempt.loopNodeRun.loopRunId,
    loopNodeRunId: attempt.loopNodeRunId,
    projectId: attempt.loopNodeRun.loopRun.projectId,
    taskId: attempt.loopNodeRun.loopRun.taskId,
  };
}

async function loadAuthorizedNodeForOpenWithPrisma(
  tx: OrchestrationEventsTx,
  input: { loopNodeRunId: string; actorUserId: string; actorType: OrchestrationActor["type"] },
): Promise<WorkflowInteractionOpenState> {
  const transaction = tx as unknown as WorkflowInteractionOpenTx;
  const node = await transaction.loopNodeRun.findUnique({
    where: { id: input.loopNodeRunId },
    select: {
      id: true,
      nodeKey: true,
      activationNo: true,
      attemptCount: true,
      status: true,
      version: true,
      attempts: {
        where: { executorType: "local", status: "running" },
        orderBy: { attempt: "desc" },
        take: 1,
        select: { attempt: true, agentRunId: true },
      },
      loopRun: {
        select: {
          id: true,
          projectId: true,
          taskId: true,
          status: true,
          version: true,
          projectionVersion: true,
          loopVersion: { select: { graph: true } },
        },
      },
    },
  });
  if (!node?.loopRun.projectId) throw validationError("Workflow interaction node is not project-scoped");

  const access = await assertCanReadProject({
    userId: input.actorUserId,
    projectId: node.loopRun.projectId,
    db: transaction as never,
  });
  const canManageProject = new Set(["owner", "maintainer", "contributor"]).has(access.role);
  if (input.actorType === "agent") {
    if (node.loopRun.taskId) {
      await assertCanDispatchTaskAgent({
        userId: input.actorUserId,
        taskId: node.loopRun.taskId,
        db: transaction as never,
      });
    } else if (!canManageProject) {
      throw authorizationDenied("Project write access required to open a requirement conversation");
    }
  } else if (access.role !== "owner" && access.role !== "maintainer") {
    throw authorizationDenied("Project administrator access required to open a requirement conversation");
  }

  if (!node.loopRun.loopVersion) throw validationError("Workflow interaction Loop version is missing");
  const graph = loopAuthoringGraphSchema.parse(node.loopRun.loopVersion.graph);
  const graphNode = graph.nodes.find((candidate) => candidate.key === node.nodeKey);
  const policySnapshot = graphNode && "interactionPolicy" in graphNode
    ? graphNode.interactionPolicy
    : undefined;
  if (!policySnapshot || policySnapshot.kind !== "requirement_conversation") {
    throw validationError("Loop node does not allow requirement conversations");
  }
  if (node.status !== "running" || !["pending", "running"].includes(node.loopRun.status)) {
    throw versionConflict("Workflow interaction runtime changed");
  }
  const activeAttempt = node.attempts[0];
  if (
    !activeAttempt?.agentRunId
    || activeAttempt.attempt !== node.attemptCount
  ) throw versionConflict("Workflow interaction AgentRun changed");

  return {
    permissionRole: input.actorType === "agent" ? "agent" : "project_admin",
    terminal: false,
    agentRunId: activeAttempt.agentRunId,
    projectId: node.loopRun.projectId,
    taskId: node.loopRun.taskId,
    loopRunId: node.loopRun.id,
    loopNodeRunId: node.id,
    activationNo: node.activationNo,
    policySnapshot,
    nodeRunVersion: node.version,
    loopRunStatus: node.loopRun.status as "pending" | "running",
    loopRunVersion: node.loopRun.version,
    loopRunProjectionVersion: node.loopRun.projectionVersion,
  };
}

async function loadAuthorizedForMutationWithPrisma(
  tx: OrchestrationEventsTx,
  input: {
    interactionId: string;
    actorUserId: string;
    actorType?: OrchestrationActor["type"];
    action: WorkflowInteractionPermissionAction;
  },
): Promise<WorkflowInteractionMutationState> {
  const transaction = tx as unknown as WorkflowInteractionAuthorizationTx;
  const interaction = await transaction.workflowInteraction.findUnique({
    where: { id: input.interactionId },
    select: {
      id: true,
      projectId: true,
      taskId: true,
      kind: true,
      status: true,
      version: true,
      loopRunId: true,
      loopNodeRunId: true,
      project: { select: { managerUserId: true } },
      loopNodeRun: {
        select: {
          id: true,
          loopRunId: true,
          status: true,
          version: true,
          loopRun: { select: { status: true, version: true, projectionVersion: true } },
        },
      },
    },
  });
  if (!interaction) throw validationError("Workflow interaction not found");

  let projectAccess: Awaited<ReturnType<typeof assertCanReadProject>> | null = null;
  try {
    projectAccess = await assertCanReadProject({
      userId: input.actorUserId,
      projectId: interaction.projectId,
      db: transaction as never,
    });
  } catch (error) {
    if (!interaction.taskId || !(error instanceof Error) || error.message !== "Project access denied") throw error;
  }
  let permissionRole: WorkflowInteractionPermissionRole = projectAccess?.role === "owner" || projectAccess?.role === "maintainer"
    ? "project_admin"
    : interaction.project.managerUserId === input.actorUserId
      ? "release_approver"
      : "viewer";

  if (interaction.taskId && permissionRole !== "project_admin") {
    if (input.actorType === "agent") {
      await assertCanDispatchTaskAgent({
        userId: input.actorUserId,
        taskId: interaction.taskId,
        db: transaction as never,
      });
      permissionRole = "agent";
    } else {
      const taskAccess = input.action === "reply"
        ? await assertCanCommentOnTask({ userId: input.actorUserId, taskId: interaction.taskId, db: transaction as never })
        : await assertCanReadTask({ userId: input.actorUserId, taskId: interaction.taskId, db: transaction as never });
      permissionRole = taskAccess.role === "creator"
        ? "task_creator"
        : taskAccess.role === "assignee"
          ? "task_assignee"
          : "task_collaborator";
    }
  } else if (input.actorType === "agent" && permissionRole !== "project_admin") {
    if (!projectAccess || !new Set(["owner", "maintainer", "contributor"]).has(projectAccess.role)) {
      throw authorizationDenied("Project write access required for Agent interaction messages");
    }
    permissionRole = "agent";
  }

  const node = interaction.loopNodeRun;
  const terminal = interaction.status !== "open"
    || ["completed", "failed", "cancelled", "exhausted"].includes(node.loopRun.status)
    || ["succeeded", "failed", "cancelled", "skipped"].includes(node.status);
  return {
    permissionRole,
    terminal,
    interaction: {
      id: interaction.id,
      projectId: interaction.projectId,
      taskId: interaction.taskId,
      kind: interaction.kind,
      status: interaction.status,
      version: interaction.version,
      loopRunId: interaction.loopRunId,
      loopNodeRunId: interaction.loopNodeRunId,
    },
    node: {
      id: node.id,
      loopRunId: node.loopRunId,
      status: node.status,
      version: node.version,
      loopRunStatus: node.loopRun.status,
      loopRunVersion: node.loopRun.version,
      loopRunProjectionVersion: node.loopRun.projectionVersion,
    },
  };
}

function confirmationEvents(
  input: ConfirmRequirementInput,
  state: WorkflowInteractionMutationState,
  result: ConfirmRequirementResult,
): OrchestrationEventEnvelope<JsonRecord>[] {
  const common = {
    correlationId: `interaction:${input.interactionId}`,
    commandId: input.commandId,
    actorType: "user" as const,
    actorId: input.actorUserId,
    occurredAt: input.occurredAt,
  };
  return [{
    id: boundedPersistenceId("event", [input.interactionId, "workflow.interaction.confirmed", input.commandId], 128),
    eventType: "workflow.interaction.confirmed",
    aggregateType: "workflow_interaction",
    aggregateId: input.interactionId,
    aggregateVersion: result.version,
    sequence: result.version,
    ...common,
    payload: { status: "confirmed", loopNodeRunId: state.node.id },
  }, {
    id: boundedPersistenceId("event", [state.node.id, "loop.node.ready", input.commandId], 128),
    eventType: "loop.node.ready",
    aggregateType: "loop_node",
    aggregateId: state.node.id,
    aggregateVersion: result.nodeVersion,
    sequence: result.nodeVersion,
    ...common,
    payload: { loopRunId: state.node.loopRunId, reason: "requirement_confirmed" },
  }];
}

function nodeStateEvent(input: {
  eventType: string;
  commandId: string;
  actor: OrchestrationActor;
  nodeRunId: string;
  nodeVersion: number;
  loopRunId: string;
  occurredAt: Date;
  payload: JsonRecord;
}): OrchestrationEventEnvelope<JsonRecord> {
  return {
    id: boundedPersistenceId("event", [input.nodeRunId, input.eventType, input.commandId], 128),
    eventType: input.eventType,
    aggregateType: "loop_node",
    aggregateId: input.nodeRunId,
    aggregateVersion: input.nodeVersion,
    sequence: input.nodeVersion,
    correlationId: `loop:${input.loopRunId}`,
    commandId: input.commandId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    occurredAt: input.occurredAt,
    payload: { loopRunId: input.loopRunId, ...input.payload },
  };
}

function interactionDecisionEvent(
  input: DecideWorkflowInteractionInput,
  version: number,
  loopNodeRunId: string,
): OrchestrationEventEnvelope<JsonRecord> {
  return {
    id: boundedPersistenceId("event", [input.interactionId, "workflow.interaction.decided", input.commandId], 128),
    eventType: "workflow.interaction.decided",
    aggregateType: "workflow_interaction",
    aggregateId: input.interactionId,
    aggregateVersion: version,
    sequence: version,
    correlationId: `interaction:${input.interactionId}`,
    commandId: input.commandId,
    actorType: "user",
    actorId: input.actorUserId,
    occurredAt: input.occurredAt,
    payload: {
      decision: input.decision,
      selectedEdgeId: input.selectedEdgeId,
      loopNodeRunId,
    },
  };
}

function assertText(value: string, label: string): void {
  if (!value.trim()) throw validationError(`${label} is required`);
}

function assertMutationPermission(permission: ReturnType<typeof evaluateWorkflowInteractionPermission>): void {
  if (permission.allowed) return;
  if (permission.reason === "interaction_read_only") {
    throw versionConflict("Workflow interaction is read-only");
  }
  throw authorizationDenied(permission.reason);
}

function assertExpectedVersion(value: number): void {
  if (!Number.isInteger(value) || value < 0) throw validationError("expectedVersion is invalid");
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw validationError("Interaction time is invalid");
}

function authorizationDenied(message: string): Error & { code: "authorization_denied" } {
  return Object.assign(new Error(message), { code: "authorization_denied" as const });
}

function validationError(message: string): Error & { code: "validation_failed" } {
  return Object.assign(new Error(message), { code: "validation_failed" as const });
}

function versionConflict(message: string): Error & { code: "version_conflict" } {
  return Object.assign(new Error(message), { code: "version_conflict" as const });
}
