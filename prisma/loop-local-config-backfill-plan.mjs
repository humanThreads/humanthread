function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function planLoopLocalConfigurationBackfill(input) {
  const workspaceCreates = [];
  const warnings = input.projects
    .filter((project) => typeof project.localPath === "string" && project.localPath.trim().length > 0)
    .map((project) => ({ id: project.id, code: "manual_workspace_configuration_required" }));
  const grantUpdates = [];
  const errors = [];

  for (const grant of input.grants) {
    if (!isRecord(grant.scope)) {
      errors.push({ id: grant.id, code: "invalid_grant_scope" });
      continue;
    }
    const legacy = hasOwn(grant.scope, "workspaceRealpath") || hasOwn(grant.scope, "allowedPathPrefixes");
    if (!legacy) continue;
    const {
      workspaceRealpath: _workspaceRealpath,
      allowedPathPrefixes: _allowedPathPrefixes,
      workspaceBindingIds: _workspaceBindingIds,
      allowedRelativePathPrefixes: _allowedRelativePathPrefixes,
      ...retained
    } = grant.scope;
    grantUpdates.push({
      id: grant.id,
      sourceVersion: grant.version,
      sourceStatus: grant.status,
      status: "revoked",
      version: grant.version + 1,
      revokedAt: input.migratedAt,
      scope: {
        ...retained,
        permission: "none",
        workspaceBindingIds: [],
        allowedRelativePathPrefixes: [],
        status: "revoked",
        revokedAt: input.migratedAt,
      },
    });
  }

  return { workspaceCreates, grantUpdates, warnings, errors };
}

export function summarizeLoopLocalConfigurationBackfill(input) {
  const plan = planLoopLocalConfigurationBackfill(input);
  return {
    projects: input.projects.length,
    manualWorkspaceConfigurations: plan.warnings.length,
    grants: input.grants.length,
    grantUpdates: plan.grantUpdates.length,
    errors: plan.errors.length,
  };
}

export function buildLoopLocalGrantBackfillWhere(grant) {
  return { id: grant.id, version: grant.sourceVersion, status: grant.sourceStatus };
}
