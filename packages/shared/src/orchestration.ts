export type OrchestrationActor =
  | { type: "user"; id: string }
  | { type: "agent"; id: string; runId: string }
  | { type: "worker"; id: string }
  | { type: "system"; id: string };

export interface OrchestrationCommand<TPayload> {
  commandId: string;
  correlationId: string;
  causationId?: string;
  actor: OrchestrationActor;
  expectedVersion?: number;
  payload: TPayload;
  issuedAt: Date;
}

export type OrchestrationAggregateType =
  | "project"
  | "stage"
  | "milestone"
  | "task"
  | "document"
  | "loop"
  | "run"
  | "approval"
  | "workspace"
  | "loop_definition"
  | "loop_version"
  | "loop_binding"
  | "loop_node"
  | "loop_effect"
  | "workflow_interaction"
  | "notification"
  | "knowledge";

export interface AggregateRef {
  type: OrchestrationAggregateType;
  id: string;
  version: number;
}

export interface OrchestrationEventEnvelope<TPayload = unknown> {
  id: string;
  eventType: string;
  aggregateType: OrchestrationAggregateType;
  aggregateId: string;
  aggregateVersion: number;
  sequence: number;
  correlationId: string;
  causationId?: string;
  commandId?: string;
  actorType: OrchestrationActor["type"];
  actorId: string;
  occurredAt: Date;
  payload: TPayload;
}

export type OrchestrationErrorCode =
  | "authentication_required"
  | "authorization_denied"
  | "validation_failed"
  | "policy_denied"
  | "version_conflict"
  | "stale_lease"
  | "sequence_gap"
  | "not_found"
  | "budget_exhausted"
  | "provider_error"
  | "workspace_conflict"
  | "task_invalid_transition"
  | "task_acceptance_required"
  | "task_acceptance_evidence_required"
  | "task_actor_cannot_complete";

export type CommandResult<T> =
  | { ok: true; result: T }
  | { ok: false; code: OrchestrationErrorCode; error: string };
