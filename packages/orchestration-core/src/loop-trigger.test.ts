import { describe, expect, it } from "vitest";
import {
  bindingMatchesMilestoneEvent,
  buildLoopTriggerIdentity,
  bindingMatchesTaskEvent,
  resolveLoopExecutionSnapshot,
  resolveLoopTriggerSnapshots,
} from "./loop-trigger";

const binding = {
  id: "binding_1",
  projectId: "project_1",
  loopDefinitionId: "loop_definition_1",
  activeVersionId: "loop_version_1",
  status: "enabled",
  version: 2,
  createdByUserId: "user_owner",
  triggerPolicy: { manual: true, taskEvents: ["task.completed"] },
  parameterOverrides: { limits: { maxStages: 3, maxRepeatCount: 2, maxTransitions: 8 } },
  notificationPolicy: { onFailure: true },
  automationGrantIds: ["grant_1"],
  allowedAgentProfileIds: ["profile_codex"],
  allowedProviders: ["codex"],
  activeVersion: {
    id: "loop_version_1",
    status: "published",
    maxStages: 4,
    maxRepeatCount: 3,
    platformMaxTransitions: 12,
  },
};

const latestVersion = {
  id: "loop_version_2",
  status: "published",
  maxStages: 6,
  maxRepeatCount: 4,
  platformMaxTransitions: 20,
};

describe("Loop trigger contracts", () => {
  it("derives bounded stable run and receipt identities", () => {
    const first = buildLoopTriggerIdentity({
      bindingId: "binding_1",
      triggerType: "manual",
      sourceEventId: "command_1",
    });
    expect(buildLoopTriggerIdentity({
      bindingId: "binding_1",
      triggerType: "manual",
      sourceEventId: "command_1",
    })).toEqual(first);
    expect(first.runId.length).toBeLessThanOrEqual(96);
    expect(first.triggerReceiptId.length).toBeLessThanOrEqual(128);
  });

  it("keeps trigger identities distinct when IDs contain delimiter characters", () => {
    const first = buildLoopTriggerIdentity({
      bindingId: "a",
      triggerType: "manual",
      sourceEventId: "b\0manual\0c",
    });
    const second = buildLoopTriggerIdentity({
      bindingId: "a\0manual\0b",
      triggerType: "manual",
      sourceEventId: "c",
    });

    expect(first).not.toEqual(second);
  });

  it("builds stable identities for scheduled and catch-up triggers", () => {
    expect(buildLoopTriggerIdentity({
      bindingId: "binding_1", triggerType: "scheduled", sourceEventId: "a".repeat(32),
    })).toEqual(buildLoopTriggerIdentity({
      bindingId: "binding_1", triggerType: "scheduled", sourceEventId: "a".repeat(32),
    }));
    expect(buildLoopTriggerIdentity({
      bindingId: "binding_1", triggerType: "catch_up", sourceEventId: "a".repeat(32),
    }).runId).not.toBe(buildLoopTriggerIdentity({
      bindingId: "binding_1", triggerType: "scheduled", sourceEventId: "a".repeat(32),
    }).runId);
  });

  it("lowers published budgets through validated binding overrides", () => {
    expect(resolveLoopTriggerSnapshots(binding)).toMatchObject({
      budgetSnapshot: { maxStages: 3, maxRepeatCount: 2, maxTransitions: 8 },
      grantSnapshot: { automationGrantIds: ["grant_1"] },
      bindingSnapshot: {
        allowedAgentProfileIds: ["profile_codex"],
        allowedProviders: ["codex"],
        createdByUserId: "user_owner",
      },
      policySnapshot: {
        triggerPolicy: { manual: true, taskEvents: ["task.completed"] },
        notificationPolicy: { onFailure: true },
      },
    });
  });

  it("follows the latest published version by default", () => {
    expect(resolveLoopTriggerSnapshots({
      ...binding,
      parameterOverrides: {},
      loopDefinition: { scope: "project", latestPublishedVersion: latestVersion },
    })).toMatchObject({
      bindingSnapshot: {
        activeVersionId: "loop_version_2",
        versionPolicy: "latest",
      },
      budgetSnapshot: {
        maxStages: 6,
        maxRepeatCount: 4,
        maxTransitions: 20,
      },
    });
  });

  it("uses the Definition active version even when a legacy Binding is pinned", () => {
    expect(resolveLoopTriggerSnapshots({
      ...binding,
      parameterOverrides: { versionPolicy: "pinned" },
      loopDefinition: { scope: "project", latestPublishedVersion: latestVersion },
    })).toMatchObject({
      bindingSnapshot: {
        activeVersionId: "loop_version_2",
        versionPolicy: "latest",
      },
      budgetSnapshot: {
        maxStages: 6,
        maxRepeatCount: 4,
        maxTransitions: 20,
      },
    });
  });

  it("rejects an unknown version policy", () => {
    expect(() => resolveLoopTriggerSnapshots({
      ...binding,
      parameterOverrides: { versionPolicy: "v3" },
    })).toThrowError(expect.objectContaining({ code: "validation_failed" }));
  });

  it("composes Project Worker resources with Binding stage policy into the immutable snapshot", () => {
    const snapshots = resolveLoopTriggerSnapshots({
      ...binding,
      project: {
        workerPoolId: "a".repeat(32),
        workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
        workerBranchPolicy: { allowedBranches: ["main"] },
      },
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    });

    expect(snapshots.bindingSnapshot).toMatchObject({
      workerExecution: {
        workerPoolId: "a".repeat(32),
        workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
        workerBranchPolicy: { allowedBranches: ["main"] },
        workerStageConfigurations: {
          work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
        },
      },
    });
  });

  it("pins a selected Linux Worker Pool instead of inferring Local Agent execution", () => {
    const snapshots = resolveLoopTriggerSnapshots({
      ...binding,
      project: {
        workerPoolId: "a".repeat(32),
        workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
        workerBranchPolicy: { allowedBranches: ["*-HT-*"] },
      },
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    });

    expect(resolveLoopExecutionSnapshot({
      target: { type: "linux_worker_pool", workerPoolId: "a".repeat(32), poolDisplayName: "ht-agent" },
      bindingSnapshot: snapshots.bindingSnapshot,
      resolvedAt: new Date("2026-08-29T10:00:00.000Z"),
    })).toEqual({
      target: { type: "linux_worker_pool", workerPoolId: "a".repeat(32), poolDisplayName: "ht-agent" },
      workerExecution: snapshots.bindingSnapshot.workerExecution,
      resolvedAt: "2026-08-29T10:00:00.000Z",
    });
  });

  it("rejects a Linux Worker selection when the Binding has no complete Worker configuration", () => {
    const snapshots = resolveLoopTriggerSnapshots(binding);

    expect(() => resolveLoopExecutionSnapshot({
      target: { type: "linux_worker_pool", workerPoolId: "a".repeat(32), poolDisplayName: "ht-agent" },
      bindingSnapshot: snapshots.bindingSnapshot,
      resolvedAt: new Date("2026-08-29T10:00:00.000Z"),
    })).toThrowError(expect.objectContaining({ code: "validation_failed" }));
  });

  it("keeps an explicit Local Agent target local when the Binding also has a Worker configuration", () => {
    const snapshots = resolveLoopTriggerSnapshots({
      ...binding,
      project: {
        workerPoolId: "a".repeat(32),
        workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
        workerBranchPolicy: { allowedBranches: ["*-HT-*"] },
      },
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    });

    expect(resolveLoopExecutionSnapshot({
      target: {
        type: "local_agent",
        agentProfileId: "profile_codex",
        profileDisplayName: "Gelsang Codex",
        provider: "codex",
      },
      bindingSnapshot: snapshots.bindingSnapshot,
      resolvedAt: new Date("2026-08-29T10:00:00.000Z"),
    })).toEqual({
      target: {
        type: "local_agent",
        agentProfileId: "profile_codex",
        profileDisplayName: "Gelsang Codex",
        provider: "codex",
      },
      resolvedAt: "2026-08-29T10:00:00.000Z",
    });
  });

  it("falls back to a complete legacy Binding resource until Project backfill runs", () => {
    const snapshots = resolveLoopTriggerSnapshots({
      ...binding,
      project: { workerPoolId: null, workerRepositoryUrl: null, workerBranchPolicy: null },
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
      workerBranchPolicy: { allowedBranches: ["main"] },
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    });
    expect(snapshots.bindingSnapshot.workerExecution?.workerPoolId).toBe("a".repeat(32));
  });

  it("rejects persisted overrides that raise a published budget", () => {
    expect(() => resolveLoopTriggerSnapshots({
      ...binding,
      parameterOverrides: { limits: { maxTransitions: 13 } },
    })).toThrowError(expect.objectContaining({ code: "validation_failed" }));
  });

  it("matches only enabled Task event declarations", () => {
    expect(bindingMatchesTaskEvent(binding, "task.completed")).toBe(true);
    expect(bindingMatchesTaskEvent(binding, "task.started")).toBe(false);
    expect(bindingMatchesTaskEvent({ ...binding, status: "disabled" }, "task.completed")).toBe(false);
  });

  it("matches enabled milestone release events and keeps their identities distinct", () => {
    const releaseBinding = {
      ...binding,
      triggerPolicy: {
        manual: true,
        taskEvents: [],
        milestoneEvents: ["milestone.release_ready"],
      },
    };
    expect(bindingMatchesMilestoneEvent(releaseBinding, "milestone.release_ready")).toBe(true);
    expect(bindingMatchesMilestoneEvent(releaseBinding, "milestone.other")).toBe(false);
    expect(buildLoopTriggerIdentity({
      bindingId: "binding_1",
      triggerType: "milestone_event",
      sourceEventId: "event_release_ready",
    })).not.toEqual(buildLoopTriggerIdentity({
      bindingId: "binding_1",
      triggerType: "task_event",
      sourceEventId: "event_release_ready",
    }));
  });
});
