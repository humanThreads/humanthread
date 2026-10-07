export interface LoopLocalConfigProject {
  id: string;
  localPath: string | null;
}

export interface LoopLocalConfigGrant {
  id: string;
  status: string;
  version: number;
  revokedAt: string | null;
  scope: unknown;
}

export interface LoopLocalGrantUpdate {
  id: string;
  sourceVersion: number;
  sourceStatus: string;
  status: "revoked";
  version: number;
  revokedAt: string;
  scope: Record<string, unknown>;
}

export function planLoopLocalConfigurationBackfill(input: {
  projects: LoopLocalConfigProject[];
  grants: LoopLocalConfigGrant[];
  migratedAt: string;
}): {
  workspaceCreates: never[];
  grantUpdates: LoopLocalGrantUpdate[];
  warnings: Array<{ id: string; code: "manual_workspace_configuration_required" }>;
  errors: Array<{ id: string; code: "invalid_grant_scope" }>;
};

export function summarizeLoopLocalConfigurationBackfill(input: {
  projects: LoopLocalConfigProject[];
  grants: LoopLocalConfigGrant[];
  migratedAt: string;
}): {
  projects: number;
  manualWorkspaceConfigurations: number;
  grants: number;
  grantUpdates: number;
  errors: number;
};

export function buildLoopLocalGrantBackfillWhere(grant: LoopLocalGrantUpdate): {
  id: string;
  version: number;
  status: string;
};
