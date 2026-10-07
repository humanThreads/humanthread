export interface LegacyTaskEventForBackfill {
  id: string;
  taskId: string;
  workflowInstanceId: string;
  type: string;
  actorType: string;
  actorUserId: string | null;
  message: string | null;
  payload: unknown;
  createdAt: Date;
}

export interface OrchestrationEventBackfillPlan {
  events: Array<Record<string, unknown>>;
  skippedEventIds: string[];
  errors: Array<{ taskEventId: string; message: string }>;
}

export function planOrchestrationEventBackfill(input: {
  taskEvents: LegacyTaskEventForBackfill[];
  existingEventIds: string[];
}): OrchestrationEventBackfillPlan;

export function summarizeOrchestrationEventBackfill(plan: OrchestrationEventBackfillPlan): {
  events: number;
  skipped: number;
  errors: number;
};
