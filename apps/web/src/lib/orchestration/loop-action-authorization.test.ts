import { describe, expect, it, vi } from "vitest";
import {
  authorizeLoopAssignment,
  authorizeLoopEffectRequest,
  authorizeLoopToolRequest,
  type LoopAuthorizationAssignment,
} from "./loop-action-authorization";

const now = new Date("2026-07-30T13:00:00.000Z");

const grant = {
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
  permission: "workspace_full" as const,
  workspaceBindingIds: ["workspace_1"],
  allowedRelativePathPrefixes: ["."],
  tools: ["filesystem", "shell", "git"],
  commandCategories: ["build", "test", "git_local"],
  operationTypes: ["workspace.write"],
  networkTargets: [],
  recipients: [],
  credentialRefs: [],
  allowProduction: false,
  limits: { maxConcurrency: 1, maxDurationMs: 3_600_000, maxTokens: 100_000, maxCostUsd: 20, maxToolCalls: 1_000 },
  policyVersion: "policy_v1",
  status: "active" as const,
  confirmedAt: "2026-07-30T12:00:00.000Z",
  expiresAt: "2026-07-31T12:00:00.000Z",
  revokedAt: null,
};

const workspaceWrite = {
  requiresUserGrant: true,
  spaceId: "space_1",
  projectId: "project_1",
  bindingId: "binding_1",
  nodeKey: "code",
  executionPlane: "local" as const,
  deviceId: "device_1",
  workerId: "local-worker:device_1",
  agentProfileId: "profile_1",
  provider: "codex",
  workspaceAccess: "write" as const,
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

const assignment: LoopAuthorizationAssignment = {
  projectId: "project_1",
  spaceId: "space_1",
  bindingId: "binding_1",
  loopRunId: "loop_run_1",
  loopRunVersion: 4,
  nodeRunId: "node_run_1",
  workerId: "local-worker:device_1",
  grantSnapshot: { automationGrantIds: ["grant_workspace"], grants: [grant] },
};

function dependencies() {
  return {
    assertResourceAccess: vi.fn().mockResolvedValue(undefined),
    assertLease: vi.fn().mockResolvedValue(undefined),
    evaluatePlatformPolicy: vi.fn().mockResolvedValue({ outcome: "allow" as const, reasonCode: "platform_policy_allow" }),
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Loop action authorization", () => {
  it.each([
    ["workspace write", workspaceWrite, "auto_approve"],
    ["undeclared shell category", { ...workspaceWrite, commandCategory: "shell_exec" }, "require_approval"],
    ["undeclared network host", { ...workspaceWrite, networkTarget: "api.example.com" }, "require_approval"],
    ["Workspace escape", { ...workspaceWrite, workspaceContained: false }, "deny"],
    ["production action", { ...workspaceWrite, production: true }, "deny"],
  ] as const)("authorizes %s", async (_label, action, outcome) => {
    const deps = dependencies();
    if (_label === "production action") {
      deps.evaluatePlatformPolicy.mockResolvedValue({ outcome: "deny", reasonCode: "production_target_denied" });
    }

    const result = await authorizeLoopToolRequest({ assignment, action, now }, deps);

    expect(result.outcome).toBe(outcome);
    expect(result.actionFingerprint).toMatch(/^sha256:/u);
    expect(deps.appendAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      actionFingerprint: result.actionFingerprint,
      outcome,
    }));
  });

  it("uses the same policy contract for assignment and external effects", async () => {
    const deps = dependencies();
    await expect(authorizeLoopAssignment({ assignment, action: workspaceWrite, now }, deps))
      .resolves.toMatchObject({ outcome: "auto_approve" });
    await expect(authorizeLoopEffectRequest({ assignment, action: workspaceWrite, now }, deps))
      .resolves.toMatchObject({ outcome: "auto_approve" });
    expect(deps.appendAuditEvent).toHaveBeenCalledTimes(2);
  });

  it("does not trust grant content omitted from the Run grant ID snapshot", async () => {
    const deps = dependencies();

    await expect(authorizeLoopToolRequest({
      assignment: {
        ...assignment,
        grantSnapshot: { automationGrantIds: [], grants: [grant] },
      },
      action: workspaceWrite,
      now,
    }, deps)).resolves.toMatchObject({
      outcome: "require_approval",
      matchedGrantId: null,
    });
  });

  it("uses one exact unconsumed runtime approval after current policy allows the action", async () => {
    const deps = {
      ...dependencies(),
      consumeOneTimeActionGrant: vi.fn().mockResolvedValue({ approvalId: "approval:effect" }),
    };

    await expect(authorizeLoopEffectRequest({
      assignment: {
        ...assignment,
        grantSnapshot: { automationGrantIds: [], grants: [] },
      },
      action: workspaceWrite,
      actionKey: "effect:logical-key",
      now,
    }, deps)).resolves.toMatchObject({
      outcome: "auto_approve",
      reasonCode: "runtime_safety_approval_matched",
      matchedGrantId: "approval:effect",
    });

    expect(deps.consumeOneTimeActionGrant).toHaveBeenCalledWith(expect.objectContaining({
      actionKey: "effect:logical-key",
      actionFingerprint: expect.stringMatching(/^sha256:/u),
      assignment: expect.objectContaining({ nodeRunId: "node_run_1" }),
      now,
    }));
    expect(deps.appendAuditEvent).toHaveBeenCalledOnce();
    expect(deps.appendAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "auto_approve",
      reasonCode: "runtime_safety_approval_matched",
      matchedGrantId: "approval:effect",
    }));
  });

  it("includes stable request context in the audit fingerprint without changing grant evaluation", async () => {
    const first = await authorizeLoopEffectRequest({
      assignment,
      action: workspaceWrite,
      fingerprintContext: { effectId: "effect_1", requestFingerprint: "request_hash_1" },
      now,
    }, dependencies());
    const second = await authorizeLoopEffectRequest({
      assignment,
      action: workspaceWrite,
      fingerprintContext: { effectId: "effect_1", requestFingerprint: "request_hash_2" },
      now,
    }, dependencies());

    expect(first.outcome).toBe("auto_approve");
    expect(second.outcome).toBe("auto_approve");
    expect(first.actionFingerprint).not.toBe(second.actionFingerprint);
  });
});
