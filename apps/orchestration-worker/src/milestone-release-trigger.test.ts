import { describe, expect, it, vi } from "vitest";
import {
  handleMilestoneReleaseEvent,
  resolveWorkerReleaseWorktreePaths,
  resolveWorkerRepositoryPath,
} from "./milestone-release-trigger";

const task = {
  taskId: "task_1",
  taskNumber: 100001,
  statusCategory: "completed",
  taskBranch: "2026-HT100001",
  remoteHeadCommit: "a".repeat(40),
  taskDocument: { documentId: "doc_1", version: 2 },
  knowledgeRefs: [{ path: "docs/knowledge/task.md", commit: "a".repeat(40) }],
  testReport: { ref: "report_1", status: "passed" as const },
  activeBlockerCount: 0,
};

const binding = {
  id: "binding_release_1",
  projectId: "project_1",
  loopDefinitionId: "definition_release",
  activeVersionId: "version_release",
  status: "enabled",
  version: 3,
  createdByUserId: "user_owner",
  triggerPolicy: { manual: false, taskEvents: [], milestoneEvents: ["milestone.release_ready"] },
  parameterOverrides: {},
  notificationPolicy: {},
  automationGrantIds: [],
  allowedAgentProfileIds: ["profile_release"],
  allowedProviders: ["codex"],
  activeVersion: { id: "version_release", status: "published", maxStages: 8, maxRepeatCount: 2, platformMaxTransitions: 24 },
};

const publishedVersions = [{
  loopDefinitionId: "definition_release",
  loopVersionId: "version_release",
  scope: "project" as const,
  graph: {
    schemaVersion: 1 as const,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    limits: { maxStages: 2, maxRepeatCount: 1 },
    nodes: [
      { key: "start", nodeId: "release_start", label: "Start", type: "start" as const },
      { key: "end", nodeId: "release_end", label: "End", type: "end" as const },
    ],
    edges: [{ id: "start-end", source: "start", target: "end", kind: "normal" as const, outcome: "success" as const }],
  },
}];

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    flags: { graphV1: true },
    now: () => new Date("2026-08-03T08:00:00.000Z"),
    loadMilestone: vi.fn().mockResolvedValue({
      id: "milestone_1",
      projectId: "project_1",
      version: 4,
      blockers: 0,
      tasks: [task],
      stagingBranch: "staging",
      productionBranch: "main",
      stagingBaseCommit: "b".repeat(40),
      productionBaseCommit: "c".repeat(40),
    }),
    listEnabledBindings: vi.fn().mockResolvedValue([binding]),
    readPublishedVersions: vi.fn().mockResolvedValue(publishedVersions),
    snapshotBindingGrants: vi.fn().mockResolvedValue([]),
    createReleaseRunAndSnapshot: vi.fn().mockResolvedValue({ runId: "loop_run_release_1", snapshotId: "snapshot_1" }),
    ...overrides,
  };
}

const event = {
  id: "event_release_ready_1",
  eventType: "milestone.release_ready",
  aggregateType: "milestone",
  aggregateId: "milestone_1",
  correlationId: "milestone:milestone_1",
  occurredAt: "2026-08-03T08:00:00.000Z",
  payload: {
    projectId: "project_1",
    milestoneId: "milestone_1",
    milestoneVersion: 4,
    releaseWorktreePaths: {
      staging: ".worktrees/release-staging",
      production: ".worktrees/release-production",
    },
  },
};

describe("Milestone release trigger", () => {
  it("resolves repositories from worker-local configuration without reading Project.localPath", () => {
    expect(resolveWorkerRepositoryPath("project_1", {
      HUMANTHREAD_WORKER_REPOSITORIES: JSON.stringify({ project_1: "/workspace/order-service" }),
    })).toBe("/workspace/order-service");
    expect(resolveWorkerRepositoryPath("project_1", {})).toBeNull();
    expect(resolveWorkerRepositoryPath("project_1", { HUMANTHREAD_WORKER_REPOSITORIES: "not-json" })).toBeNull();
  });

  it("accepts only explicit repository-relative release worktree paths", () => {
    expect(resolveWorkerReleaseWorktreePaths("project_1", {
      HUMANTHREAD_RELEASE_WORKTREES: JSON.stringify({
        project_1: { staging: ".worktrees/release-staging", production: ".worktrees/release-production" },
      }),
    })).toEqual({ staging: ".worktrees/release-staging", production: ".worktrees/release-production" });
    expect(resolveWorkerReleaseWorktreePaths("project_1", {
      HUMANTHREAD_RELEASE_WORKTREES: JSON.stringify({
        project_1: { staging: "/tmp/release-staging", production: ".worktrees/release-production" },
      }),
    })).toBeNull();
  });

  it("creates one version-pinned Release Run and immutable snapshot per matching binding", async () => {
    const deps = dependencies();

    await expect(handleMilestoneReleaseEvent(event, deps as never)).resolves.toEqual({ matched: 1, triggered: 1 });
    expect(deps.createReleaseRunAndSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      run: expect.objectContaining({
        bindingId: "binding_release_1",
        loopVersionId: "version_release",
        triggerType: "milestone_event",
        sourceEventId: "event_release_ready_1",
        inputSnapshot: expect.objectContaining({
          stagingBranch: "staging",
          productionBranch: "main",
          releaseWorktreePaths: {
            staging: ".worktrees/release-staging",
            production: ".worktrees/release-production",
          },
        }),
        runGraphSnapshot: expect.objectContaining({ rootLoopVersionId: "version_release" }),
      }),
      snapshot: expect.objectContaining({
        projectId: "project_1",
        milestoneId: "milestone_1",
        milestoneVersion: 4,
        triggerType: "milestone_event",
        stagingBaseCommit: "b".repeat(40),
        productionBaseCommit: "c".repeat(40),
        tasks: [{
          taskId: "task_1",
          taskNumber: 100001,
          branch: "2026-HT100001",
          headCommit: "a".repeat(40),
          taskDocument: { documentId: "doc_1", version: 2 },
          knowledgeRefs: task.knowledgeRefs,
          testReportRef: "report_1",
        }],
      }),
    }));
  });

  it("acknowledges an event when the milestone is no longer ready", async () => {
    const deps = dependencies({
      loadMilestone: vi.fn().mockResolvedValue({
        ...dependencies().loadMilestone,
        id: "milestone_1",
        projectId: "project_1",
        version: 4,
        blockers: 1,
        tasks: [task],
      }),
    });
    await expect(handleMilestoneReleaseEvent(event, deps as never)).resolves.toEqual({ matched: 0, triggered: 0 });
    expect(deps.createReleaseRunAndSnapshot).not.toHaveBeenCalled();
  });

  it("does not create a duplicate run for an unmatched binding", async () => {
    const deps = dependencies({
      listEnabledBindings: vi.fn().mockResolvedValue([{ ...binding, triggerPolicy: { ...binding.triggerPolicy, milestoneEvents: ["manual"] } }]),
    });
    await expect(handleMilestoneReleaseEvent(event, deps as never)).resolves.toEqual({ matched: 0, triggered: 0 });
    expect(deps.createReleaseRunAndSnapshot).not.toHaveBeenCalled();
  });

  it("uses the same source identity when the ready event is delivered twice", async () => {
    const deps = dependencies();
    await handleMilestoneReleaseEvent(event, deps as never);
    await handleMilestoneReleaseEvent(event, deps as never);
    const calls = vi.mocked(deps.createReleaseRunAndSnapshot).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0].run.id).toBe(calls[1]?.[0].run.id);
    expect(calls[0]?.[0].run.triggerReceiptId).toBe(calls[1]?.[0].run.triggerReceiptId);
  });
});
