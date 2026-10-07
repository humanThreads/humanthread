export interface SpaceBackfillInput {
  users: Array<{ id: string; name: string }>;
  companies: Array<{ id: string; name: string }>;
  projects: Array<{
    id: string;
    name: string;
    ownerType: string;
    ownerUserId: string | null;
    companyId: string | null;
    spaceId: string | null;
  }>;
}

export interface SpaceBackfillPlan {
  personalSpaces: Array<{
    id: string;
    ownerUserId: string;
    name: string;
  }>;
  companySpaces: Array<{
    id: string;
    companyId: string;
    name: string;
  }>;
  projectAssignments: Array<{
    projectId: string;
    spaceId: string;
  }>;
  skippedProjectIds: string[];
  errors: Array<{
    projectId: string;
    message: string;
  }>;
}

export function planSpaceBackfill(input: SpaceBackfillInput): SpaceBackfillPlan;
export function summarizeSpaceBackfill(plan: SpaceBackfillPlan): {
  personalSpaces: number;
  companySpaces: number;
  projectAssignments: number;
  skippedProjects: number;
  errors: number;
};
