export function planProjectOrchestrationBackfill(input: {
  projects: Array<{ id: string; status: string | null; version: number | null }>;
  tasks: Array<{ id: string; projectId: string; milestoneId: string | null }>;
  stages: Array<{ id: string; projectId: string }>;
  milestones: Array<{ id: string; projectId: string }>;
}): {
  projects: Array<Record<string, unknown>>;
  stages: Array<Record<string, unknown>>;
  milestones: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  skipped: string[];
  errors: Array<Record<string, unknown>>;
};

export function summarizeProjectOrchestrationBackfill(plan: ReturnType<typeof planProjectOrchestrationBackfill>): {
  projects: number;
  stages: number;
  milestones: number;
  tasks: number;
  skipped: number;
  errors: number;
};
