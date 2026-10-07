export interface UserTaskBackfillEvent {
  actorUserId: string | null;
  message: string | null;
  createdAt: Date;
}

export interface UserTaskBackfillInput {
  tasks: Array<Record<string, unknown> & {
    id: string;
    events: UserTaskBackfillEvent[];
    blockers: Array<{ id: string }>;
  }>;
}

export interface UserTaskBackfillPlan {
  processed: number;
  tasks: Array<Record<string, unknown> & { taskId: string }>;
  blockers: Array<Record<string, unknown> & { id: string; taskId: string }>;
  skipped: number;
  errors: Array<{ taskId: string; code: string }>;
}

export function planUserTaskBackfill(input: UserTaskBackfillInput): UserTaskBackfillPlan;
export function summarizeUserTaskBackfill(plan: UserTaskBackfillPlan): {
  processed: number;
  migrated: number;
  blockers: number;
  skipped: number;
  errors: number;
};
