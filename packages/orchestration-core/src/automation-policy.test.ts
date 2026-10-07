import {
  automationActionSchema,
  type AutomationAction,
  type AutomationGrantSnapshot,
} from "@humanthread/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  evaluateAutomationGrant,
  reconcileLiveAutomationGrant,
  reconcileLiveAutomationGrants,
} from "./automation-policy";

const now = new Date("2026-07-30T13:00:00.000Z");
const workspaceGrant: AutomationGrantSnapshot = {
  id: "grant_workspace",
  spaceId: "space_1",
  projectId: "project_1",
  bindingIds: ["binding_1"],
  nodeKeys: ["code"],
  executionPlanes: ["local"],
  deviceIds: ["device_1"],
  workerIds: ["local-worker:device_1"],
  agentProfileIds: ["profile_1"],
  providers: ["codex"],
  permission: "workspace_full",
  workspaceBindingIds: ["workspace_1"],
  allowedRelativePathPrefixes: ["."],
  tools: ["filesystem", "git", "shell"],
  commandCategories: ["build", "git_local", "test"],
  operationTypes: ["workspace.write"],
  networkTargets: [],
  recipients: [],
  credentialRefs: [],
  allowProduction: false,
  limits: {
    maxConcurrency: 1,
    maxDurationMs: 3_600_000,
    maxTokens: 100_000,
    maxCostUsd: 20,
    maxToolCalls: 1_000,
  },
  policyVersion: "policy_v1",
  status: "active",
  confirmedAt: "2026-07-30T12:00:00.000Z",
  expiresAt: "2026-07-31T12:00:00.000Z",
  revokedAt: null,
};
const workspaceEdit: AutomationAction = {
  requiresUserGrant: true,
  spaceId: "space_1",
  projectId: "project_1",
  bindingId: "binding_1",
  nodeKey: "code",
  executionPlane: "local",
  deviceId: "device_1",
  workerId: "local-worker:device_1",
  agentProfileId: "profile_1",
  provider: "codex",
  workspaceAccess: "write",
  workspaceBindingId: "workspace_1",
  relativePath: "src/index.ts",
  workspaceContained: true,
  tool: "filesystem",
  commandCategory: null,
  operationType: "workspace.write",
  networkTarget: null,
  recipient: null,
  credentialRef: null,
  production: false,
  usage: { concurrency: 1, durationMs: 1_000, tokens: 100, costUsd: 0.01, toolCalls: 1 },
  policyVersion: "policy_v1",
};
const platformAllow = { outcome: "allow" as const, reasonCode: "platform_policy_allow" };

function fixture(
  action: AutomationAction,
  grants: AutomationGrantSnapshot[] = [workspaceGrant],
  policyDecision = platformAllow,
) {
  return { action, grants, now, policyDecision };
}

describe("evaluateAutomationGrant", () => {
  it.each([
    ["workspace edit", fixture(workspaceEdit), "auto_approve", "grant_workspace"],
    ["git push", fixture({ ...workspaceEdit, tool: "git", commandCategory: "git_push" }), "require_approval", null],
    ["recipient outside allowlist", fixture({ ...workspaceEdit, recipient: "outside@example.com" }), "require_approval", null],
    ["revoked grant", fixture(workspaceEdit, [{ ...workspaceGrant, revokedAt: "2026-07-30T12:30:00.000Z" }]), "require_approval", null],
  ] as const)("evaluates %s", (_label, candidate, outcome, matchedGrantId) => {
    expect(evaluateAutomationGrant(candidate)).toEqual(expect.objectContaining({ outcome, matchedGrantId }));
  });

  it("denies a locally attested Workspace escape even when a grant otherwise matches", () => {
    expect(evaluateAutomationGrant(fixture({
      ...workspaceEdit,
      workspaceContained: false,
    }))).toEqual({
      outcome: "deny",
      reasonCode: "workspace_scope_denied",
      matchedGrantId: null,
    });
  });

  it("denies an action allowed by a grant when current platform policy denies it", () => {
    expect(evaluateAutomationGrant(fixture(workspaceEdit, [workspaceGrant], {
      outcome: "deny",
      reasonCode: "production_target_denied",
    }))).toEqual({
      outcome: "deny",
      reasonCode: "production_target_denied",
      matchedGrantId: null,
    });
  });

  it("reserves allow for low-risk actions that do not require a user grant", () => {
    expect(evaluateAutomationGrant(fixture({
      ...workspaceEdit,
      requiresUserGrant: false,
      workspaceAccess: "none",
      workspaceBindingId: null,
      relativePath: null,
      workspaceContained: null,
      tool: null,
      operationType: null,
    }, []))).toEqual({
      outcome: "allow",
      reasonCode: "low_risk_platform_action",
      matchedGrantId: null,
    });
  });

  it("requires the action Workspace binding and relative prefix to match the grant", () => {
    expect(evaluateAutomationGrant(fixture({
      ...workspaceEdit,
      workspaceBindingId: "workspace_other",
    }))).toEqual({
      outcome: "require_approval",
      reasonCode: "automation_grant_scope_miss",
      matchedGrantId: null,
    });
    expect(evaluateAutomationGrant(fixture({
      ...workspaceEdit,
      relativePath: "docs/report.md",
    }, [{ ...workspaceGrant, allowedRelativePathPrefixes: ["src"] }]))).toEqual({
      outcome: "require_approval",
      reasonCode: "automation_grant_scope_miss",
      matchedGrantId: null,
    });
  });

  it("rejects a traversal-shaped relative Workspace path before policy evaluation", () => {
    expect(automationActionSchema.safeParse({
      ...workspaceEdit,
      relativePath: "../secrets.txt",
    }).success).toBe(false);
  });

  it("requires every used identity, operation, target, and budget dimension to match", () => {
    for (const action of [
      { ...workspaceEdit, bindingId: "binding_other" },
      { ...workspaceEdit, nodeKey: "review" },
      { ...workspaceEdit, provider: "other" },
      { ...workspaceEdit, operationType: "workspace.delete" },
      { ...workspaceEdit, networkTarget: "api.example.com" },
      { ...workspaceEdit, credentialRef: "credential_1" },
      { ...workspaceEdit, usage: { ...workspaceEdit.usage, concurrency: 2 } },
      { ...workspaceEdit, policyVersion: "policy_v2" },
    ] satisfies AutomationAction[]) {
      expect(evaluateAutomationGrant(fixture(action))).toEqual({
        outcome: "require_approval",
        reasonCode: "automation_grant_scope_miss",
        matchedGrantId: null,
      });
    }
  });

  it("never treats an empty optional-dimension allowlist as unrestricted", () => {
    fc.assert(fc.property(
      fc.constantFrom(
        ["tool", "tools"],
        ["commandCategory", "commandCategories"],
        ["operationType", "operationTypes"],
        ["networkTarget", "networkTargets"],
        ["recipient", "recipients"],
        ["credentialRef", "credentialRefs"],
      ),
      fc.stringMatching(/^[a-z][a-z0-9._-]{0,30}$/u),
      ([actionField, grantField], requested) => {
        const action = { ...workspaceEdit, [actionField]: requested } as AutomationAction;
        const grant = { ...workspaceGrant, [grantField]: [] } as AutomationGrantSnapshot;

        expect(evaluateAutomationGrant(fixture(action, [grant]))).toEqual({
          outcome: "require_approval",
          reasonCode: "automation_grant_scope_miss",
          matchedGrantId: null,
        });
      },
    ));
  });
});

describe("reconcileLiveAutomationGrant", () => {
  it("uses the immutable Run scope and excludes a live row whose scope was expanded", () => {
    expect(reconcileLiveAutomationGrant({
      snapshot: workspaceGrant,
      live: {
        id: "grant_workspace",
        spaceId: "space_1",
        projectId: "project_1",
        policyVersion: "policy_v1",
        status: "active",
        scope: workspaceGrant,
        expiresAt: "2026-07-31T12:00:00.000Z",
        revokedAt: null,
      },
    })).toEqual(workspaceGrant);

    expect(reconcileLiveAutomationGrant({
      snapshot: workspaceGrant,
      live: {
        id: "grant_workspace",
        spaceId: "space_1",
        projectId: "project_1",
        policyVersion: "policy_v1",
        status: "active",
        scope: { ...workspaceGrant, networkTargets: ["api.unconfirmed.example"] },
        expiresAt: "2026-07-31T12:00:00.000Z",
        revokedAt: null,
      },
    })).toBeNull();
  });

  it("overlays only a valid live revocation onto the immutable Run scope", () => {
    expect(reconcileLiveAutomationGrant({
      snapshot: workspaceGrant,
      live: {
        id: "grant_workspace",
        spaceId: "space_1",
        projectId: "project_1",
        policyVersion: "policy_v1",
        status: "revoked",
        scope: workspaceGrant,
        expiresAt: "2026-07-31T12:00:00.000Z",
        revokedAt: "2026-07-30T13:30:00.000Z",
      },
    })).toEqual({
      ...workspaceGrant,
      status: "revoked",
      revokedAt: "2026-07-30T13:30:00.000Z",
    });
  });

  it("requires grant content, Run grant IDs, and the live row to agree", () => {
    const live = [{
      id: "grant_workspace",
      spaceId: "space_1",
      projectId: "project_1",
      policyVersion: "policy_v1",
      status: "active",
      scope: workspaceGrant,
      expiresAt: "2026-07-31T12:00:00.000Z",
      revokedAt: null,
    }];
    expect(reconcileLiveAutomationGrants({
      grantSnapshot: { automationGrantIds: ["grant_workspace"], grants: [workspaceGrant] },
      live,
    })).toEqual([workspaceGrant]);
    expect(reconcileLiveAutomationGrants({
      grantSnapshot: { automationGrantIds: [], grants: [workspaceGrant] },
      live,
    })).toEqual([]);
  });
});
