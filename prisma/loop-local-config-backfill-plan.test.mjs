import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  planLoopLocalConfigurationBackfill,
  summarizeLoopLocalConfigurationBackfill,
} from "./loop-local-config-backfill-plan.mjs";

const migratedAt = "2026-07-31T08:00:00.000Z";

describe("Loop local configuration backfill planner", () => {
  it("never copies a shared Project.localPath into a device Workspace", () => {
    const plan = planLoopLocalConfigurationBackfill({
      projects: [{ id: "project_1", localPath: "/Users/shared/Atlas" }],
      grants: [],
      migratedAt,
    });

    assert.deepEqual(plan.workspaceCreates, []);
    assert.deepEqual(plan.warnings, [{
      id: "project_1",
      code: "manual_workspace_configuration_required",
    }]);
  });

  it("revokes a legacy absolute-path grant without retaining its path", () => {
    const legacyScope = {
      id: "grant_1",
      permission: "workspace_full",
      workspaceRealpath: "/Users/shared/Atlas",
      allowedPathPrefixes: ["/Users/shared/Atlas"],
      status: "active",
      revokedAt: null,
    };
    const plan = planLoopLocalConfigurationBackfill({
      projects: [],
      grants: [{ id: "grant_1", status: "active", version: 2, revokedAt: null, scope: legacyScope }],
      migratedAt,
    });

    assert.equal(plan.grantUpdates.length, 1);
    assert.deepEqual(plan.grantUpdates[0], {
      id: "grant_1",
      sourceVersion: 2,
      sourceStatus: "active",
      status: "revoked",
      version: 3,
      revokedAt: migratedAt,
      scope: {
        id: "grant_1",
        permission: "none",
        workspaceBindingIds: [],
        allowedRelativePathPrefixes: [],
        status: "revoked",
        revokedAt: migratedAt,
      },
    });
    assert.doesNotMatch(JSON.stringify(plan), /\/Users\/shared/u);
  });

  it("is idempotent after applying the planned grant update", () => {
    const migratedScope = {
      id: "grant_1",
      permission: "none",
      workspaceBindingIds: [],
      allowedRelativePathPrefixes: [],
      status: "revoked",
      revokedAt: migratedAt,
    };
    const input = {
      projects: [{ id: "project_1", localPath: null }],
      grants: [{ id: "grant_1", status: "revoked", version: 3, revokedAt: migratedAt, scope: migratedScope }],
      migratedAt,
    };

    assert.deepEqual(planLoopLocalConfigurationBackfill(input), {
      workspaceCreates: [],
      grantUpdates: [],
      warnings: [],
      errors: [],
    });
    assert.deepEqual(summarizeLoopLocalConfigurationBackfill(input), {
      projects: 1,
      manualWorkspaceConfigurations: 0,
      grants: 1,
      grantUpdates: 0,
      errors: 0,
    });
  });
});
