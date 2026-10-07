export interface DevelopmentModeBackfillProject {
  id: string;
  developmentTemplateKey: string | null;
  developmentTemplateVersion: number | null;
  developmentTemplateConfig: unknown | null;
  productionBranch: string | null;
  stagingBranch: string | null;
  releaseAgentProfileId: string | null;
}

export interface DevelopmentModeBackfillPlan {
  updates: never[];
  errors: Array<{ id: string; code: "partial_configuration" }>;
}

export function planDevelopmentModeBackfill(input: {
  projects: DevelopmentModeBackfillProject[];
}): DevelopmentModeBackfillPlan;

export function summarizeDevelopmentModeBackfill(input: {
  projects: DevelopmentModeBackfillProject[];
}): { processed: number; updated: number; skipped: number; errors: number };
