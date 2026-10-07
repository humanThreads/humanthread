import { describe, expect, it, vi } from "vitest";
import type { LoopGraphV2 } from "@humanthread/shared";
import { resolveRunGraphSnapshotV2 } from "@humanthread/orchestration-core";
import {
  dispatchProductionReadyNode,
  evaluateLocalExecutionReadiness,
  expirePendingRuntimeSafetyApprovals,
  loadWaitingConfigurationCandidates,
  loadPersistedLocalExecutionReadiness,
  loadWaitingLoopCandidates,
  matchReadyNodeRuntimeApproval,
  recoverExpiredRunAtomically,
  resumeWaitingConfigurationNodes,
  resolveReadyLoopGraph,
  resolveProductionOutboxTopics,
} from "./production-runtime";

const readyGraphV2 = {
  schemaVersion: 2,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 3, maxRepeatCount: 2 },
  nodes: [
    { key: "start", nodeId: "start_v2", label: "Start", type: "start" },
    {
      key: "work",
      nodeId: "work_v2",
      label: "Work",
      type: "agent_action",
      executionTarget: "local",
      promptTemplate: "Work",
      offlinePolicy: "local_capable",
    },
    { key: "end", nodeId: "end_v2", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-work", source: "start", target: "work", kind: "normal", outcome: "success" },
    { id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" },
  ],
  routingMetadata: {
    work_v2: { responsibility: "Complete the work stage." },
  },
} satisfies LoopGraphV2;

describe("resolveReadyLoopGraph", () => {
  it("resolves a V2 run snapshot without sending routing metadata through the V1 schema", () => {
    const snapshot = resolveRunGraphSnapshotV2({
      rootLoopVersionId: "loop_version_v2",
      versions: [{
        loopDefinitionId: "loop_definition_v2",
        loopVersionId: "loop_version_v2",
        scope: "project",
        graph: readyGraphV2,
      }],
    });

    const graph = resolveReadyLoopGraph({
      loopVersionId: "loop_version_v2",
      runGraphSnapshot: snapshot,
      publishedGraph: readyGraphV2,
    });

    expect(graph.schemaVersion).toBe(1);
    expect(graph.nodes.find((node) => node.key === "work")).toMatchObject({
      nodeId: "work_v2",
      type: "agent_action",
      promptTemplate: "Work",
    });
    expect(() => resolveReadyLoopGraph({
      loopVersionId: "loop_version_other",
      runGraphSnapshot: snapshot,
      publishedGraph: readyGraphV2,
    })).toThrow(/outside.*snapshot/iu);
  });

  it("falls back to the published graph for legacy runs without a snapshot", () => {
    const { routingMetadata: _routingMetadata, ...legacyGraph } = readyGraphV2;
    const graph = resolveReadyLoopGraph({
      loopVersionId: "loop_version_legacy",
      runGraphSnapshot: null,
      publishedGraph: {
        ...legacyGraph,
        schemaVersion: 1,
      },
    });

    expect(graph.schemaVersion).toBe(1);
    expect(graph.nodes).toHaveLength(3);
  });
});

const readyCandidate = {
  loopRunId: "loop_run_1",
  projectId: "project_1",
  nodeRunId: "node_run_1",
  nodeRunVersion: 1,
  nodeKey: "start",
  activationNo: 1,
  attemptCount: 0,
  inputSnapshot: { objective: "Ship" },
  bindingSnapshot: {},
  agentProfileId: "profile_1",
  node: {
    key: "start",
    label: "Start",
    type: "start" as const,
  },
};

const assignment = {
  loopRunId: "loop_run_1",
  nodeRunId: "node_run_1",
  nodeRunVersion: 1,
  nodeKey: "start",
  activationNo: 1,
  inputSnapshot: { objective: "Ship" },
  executionTarget: "platform" as const,
  attemptId: "loop_attempt:1",
  occurredAt: new Date("2026-07-31T02:00:00.000Z"),
  correlationId: "loop:loop_run_1",
  actor: { type: "system" as const, id: "loop-scheduler" },
};

function dispatchDependencies() {
  const tx = {
    loopNodeRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    loopRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    approvalRequest: { create: vi.fn().mockResolvedValue({ id: "approval_1" }) },
  };
  return {
    tx,
    activate: vi.fn().mockResolvedValue({ status: "activated" }),
    db: { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) },
  };
}

describe("dispatchProductionReadyNode", () => {
  it("activates an allowed no-human node without an approval transaction", async () => {
    const dependencies = dispatchDependencies();

    await dispatchProductionReadyNode(readyCandidate, assignment, dependencies);

    expect(dependencies.activate).toHaveBeenCalledWith(assignment);
    expect(dependencies.db.$transaction).not.toHaveBeenCalled();
    expect(dependencies.tx.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("persists a declared Human Gate as one durable approval wait", async () => {
    const dependencies = dispatchDependencies();
    const candidate = {
      ...readyCandidate,
      nodeKey: "review",
      nodeRunId: "node_run_review_1",
      node: {
        key: "review",
        label: "Review",
        type: "human_gate" as const,
        executionTarget: "platform" as const,
        prompt: "Review",
      },
      humanGateRoutes: {
        pass: ["review_to_end"],
        rework: ["review_to_code"],
        reject: ["review_to_rejected"],
      },
    };

    await dispatchProductionReadyNode(candidate, {
      ...assignment,
      nodeRunId: "node_run_review_1",
      nodeKey: "review",
      executionTarget: "platform",
      agentRun: undefined,
    }, dependencies);

    expect(dependencies.activate).not.toHaveBeenCalled();
    expect(dependencies.db.$transaction).toHaveBeenCalledOnce();
    expect(dependencies.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_approval", waitingReason: "human_gate" }),
    }));
    expect(dependencies.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting" }),
    }));
    expect(dependencies.tx.approvalRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "loop_human_gate",
        status: "pending",
        requestPayload: expect.objectContaining({
          routes: { pass: ["review_to_end"], rework: ["review_to_code"], reject: ["review_to_rejected"] },
        }),
      }),
    }));
  });

  it("persists a runtime safety wait when assignment policy requires approval", async () => {
    const dependencies = dispatchDependencies();

    await dispatchProductionReadyNode({
      ...readyCandidate,
      node: { key: "publish", label: "Publish", type: "platform_action" as const, executionTarget: "platform" as const },
      policyDecision: {
        outcome: "require_approval" as const,
        reasonCode: "automation_grant_scope_miss",
        matchedGrantId: null,
      },
      actionFingerprint: "sha256:git-push",
    }, assignment, dependencies);

    expect(dependencies.activate).not.toHaveBeenCalled();
    expect(dependencies.tx.approvalRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "loop_runtime_safety",
        requestPayload: expect.objectContaining({ actionFingerprint: "sha256:git-push" }),
      }),
    }));
  });

  it("defaults an unevaluated local agent node to automatic assignment", async () => {
    const dependencies = dispatchDependencies();
    const candidate = {
      ...readyCandidate,
      nodeKey: "code",
      nodeRunId: "node_run_code_1",
      agentProfileId: "profile_1",
      node: {
        key: "code",
        label: "Code",
        type: "agent_action" as const,
        executionTarget: "local" as const,
        promptTemplate: "Implement",
      },
    };

    await dispatchProductionReadyNode(candidate, {
      ...assignment,
      nodeKey: "code",
      nodeRunId: "node_run_code_1",
      executionTarget: "local",
      agentRun: {
        id: "agent_run_1",
        projectId: "project_1",
        agentProfileId: "profile_1",
        inputSnapshot: { objective: "Ship" },
      },
    }, dependencies);

    expect(dependencies.activate).toHaveBeenCalledOnce();
    expect(dependencies.tx.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("waits for missing local configuration without creating an AgentRun", async () => {
    const dependencies = dispatchDependencies();
    const waitForConfiguration = vi.fn().mockResolvedValue({ status: "waiting_configuration" });
    const candidate = {
      ...readyCandidate,
      nodeKey: "code",
      nodeRunId: "node_run_code_1",
      agentProfileId: "profile_codex",
      localExecutionReadiness: {
        ready: false as const,
        reason: "workspace_missing" as const,
        configurationVersion: "binding:3|workspace:0",
        evidence: {
          bindingId: "binding_1",
          bindingVersion: 3,
          agentProfileId: "profile_codex",
          provider: "codex",
          workerId: "local-worker:device_1",
          workerVersion: 4,
          deviceId: "device_1",
          runtimeProfileId: "runtime_1",
          runtimeVersion: 2,
          workspaceBindingId: null,
          workspaceConfigurationVersion: null,
          automationGrantId: "grant_1",
          automationGrantVersion: 1,
        },
      },
      configurationRecipientUserId: "user_1",
      node: {
        key: "code",
        label: "Code",
        type: "agent_action" as const,
        executionTarget: "local" as const,
        promptTemplate: "Implement",
      },
    };

    await expect(dispatchProductionReadyNode(candidate, {
      ...assignment,
      nodeKey: "code",
      nodeRunId: "node_run_code_1",
      executionTarget: "local",
      agentRun: {
        id: "agent_run_1",
        projectId: "project_1",
        agentProfileId: "profile_codex",
        inputSnapshot: { objective: "Ship" },
      },
    }, {
      ...dependencies,
      waitForConfiguration,
    } as never)).resolves.toMatchObject({ status: "waiting_configuration" });

    expect(waitForConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      nodeRunId: "node_run_code_1",
      waitingReason: "workspace_missing",
      configurationVersion: "binding:3|workspace:0",
    }));
    expect(dependencies.activate).not.toHaveBeenCalled();
  });
});

describe("evaluateLocalExecutionReadiness", () => {
  const readyInput = {
    binding: {
      id: "binding_1",
      version: 3,
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    },
    profile: { id: "profile_codex", provider: "codex", status: "active" },
    adapterRegistered: true,
    worker: {
      id: "local-worker:device_1",
      localDeviceId: "device_1",
      status: "online",
      version: 4,
      lastHeartbeatAt: new Date("2026-07-31T01:59:30.000Z"),
      providers: ["codex"],
    },
    runtime: {
      id: "runtime_1",
      localDeviceId: "device_1",
      provider: "codex",
      status: "ready",
      version: 2,
    },
    workspace: {
      id: "workspace_1",
      projectId: "project_1",
      localDeviceId: "device_1",
      status: "ready",
      configurationVersion: 5,
    },
    grant: {
      id: "grant_1",
      status: "active",
      version: 1,
      workspaceBindingIds: ["workspace_1"],
      agentProfileIds: ["profile_codex"],
      providers: ["codex"],
      deviceIds: ["device_1"],
      workerIds: ["local-worker:device_1"],
    },
    projectId: "project_1",
    now: new Date("2026-07-31T02:00:00.000Z"),
    workerHeartbeatTimeoutMs: 60_000,
  } as const;

  it("returns stable ordered reasons before any local lease can be created", () => {
    expect(evaluateLocalExecutionReadiness({
      ...readyInput,
      binding: { ...readyInput.binding, allowedProviders: ["claude"] },
      workspace: null,
    })).toMatchObject({ ready: false, reason: "provider_not_allowed" });
    expect(evaluateLocalExecutionReadiness({
      ...readyInput,
      workspace: null,
    })).toMatchObject({ ready: false, reason: "workspace_missing" });
    expect(evaluateLocalExecutionReadiness({
      ...readyInput,
      runtime: { ...readyInput.runtime, status: "unauthenticated" as const },
    })).toMatchObject({ ready: false, reason: "runtime_unauthenticated" });
    expect(evaluateLocalExecutionReadiness(readyInput)).toMatchObject({
      ready: true,
      reason: null,
      configurationVersion: expect.stringMatching(/^configuration:[a-f0-9]{64}$/u),
    });
    expect(evaluateLocalExecutionReadiness({ ...readyInput, grant: null })).toMatchObject({
      ready: true,
      reason: null,
    });
  });

  it("changes the configuration version when a same-version runtime binding is replaced", () => {
    const original = evaluateLocalExecutionReadiness(readyInput);
    const replaced = evaluateLocalExecutionReadiness({
      ...readyInput,
      runtime: { ...readyInput.runtime, id: "runtime_replacement" },
    });

    expect(replaced.configurationVersion).not.toBe(original.configurationVersion);
  });
});

describe("resumeWaitingConfigurationNodes", () => {
  it("keeps the same activation waiting until readiness changes, then marks it ready once", async () => {
    const candidate = {
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 2,
      activationNo: 1,
      waitingReason: "workspace_missing",
      configurationVersion: "configuration:old",
    };
    const resume = vi.fn().mockResolvedValue({ status: "ready", nodeRunVersion: 3 });
    const evaluate = vi.fn()
      .mockResolvedValueOnce({
        recipientUserId: "user_1",
        readiness: {
          ready: false,
          reason: "workspace_missing",
          configurationVersion: "configuration:old",
          evidence: { bindingId: "binding_1", bindingVersion: 3 },
        },
      })
      .mockResolvedValueOnce({
        recipientUserId: "user_1",
        readiness: {
          ready: true,
          reason: null,
          configurationVersion: "configuration:new",
          evidence: { bindingId: "binding_1", bindingVersion: 3 },
        },
      });
    const loadWaiting = vi.fn().mockResolvedValue([candidate]);

    await expect(resumeWaitingConfigurationNodes({
      limit: 10,
      now: new Date("2026-07-31T02:00:00.000Z"),
      loadWaiting,
      evaluate,
      resume,
    })).resolves.toEqual({ scanned: 1, resumed: 0, refreshed: 0, contended: 0 });
    await expect(resumeWaitingConfigurationNodes({
      limit: 10,
      now: new Date("2026-07-31T02:00:10.000Z"),
      loadWaiting,
      evaluate,
      resume,
    })).resolves.toEqual({ scanned: 1, resumed: 1, refreshed: 0, contended: 0 });

    expect(resume).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 2,
    }));
  });

  it("refreshes a changed blocking configuration but skips an unchanged wait", async () => {
    const candidate = {
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 2,
      activationNo: 1,
      waitingReason: "workspace_missing",
      configurationVersion: "configuration:old",
    };
    const waitForConfiguration = vi.fn().mockResolvedValue({
      status: "waiting_configuration",
      nodeRunVersion: 3,
    });
    const evaluate = vi.fn()
      .mockResolvedValueOnce({
        recipientUserId: "user_1",
        readiness: {
          ready: false,
          reason: "runtime_missing",
          configurationVersion: "configuration:new",
          evidence: { bindingId: "binding_1", bindingVersion: 3 },
        },
      })
      .mockResolvedValueOnce({
        recipientUserId: "user_1",
        readiness: {
          ready: false,
          reason: "workspace_missing",
          configurationVersion: "configuration:old",
          evidence: { bindingId: "binding_1", bindingVersion: 3 },
        },
      });
    const loadWaiting = vi.fn().mockResolvedValue([candidate]);

    await expect(resumeWaitingConfigurationNodes({
      limit: 10,
      now: new Date("2026-07-31T02:00:00.000Z"),
      loadWaiting,
      evaluate,
      resume: vi.fn(),
      waitForConfiguration,
    })).resolves.toEqual({ scanned: 1, resumed: 0, refreshed: 1, contended: 0 });
    await expect(resumeWaitingConfigurationNodes({
      limit: 10,
      now: new Date("2026-07-31T02:00:10.000Z"),
      loadWaiting,
      evaluate,
      resume: vi.fn(),
      waitForConfiguration,
    })).resolves.toEqual({ scanned: 1, resumed: 0, refreshed: 0, contended: 0 });

    expect(waitForConfiguration).toHaveBeenCalledOnce();
    expect(waitForConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      nodeRunId: "node_run_1",
      nodeRunVersion: 2,
      waitingReason: "runtime_missing",
      configurationVersion: "configuration:new",
    }));
  });

  it("counts stale resume and refresh races without failing the recovery scan", async () => {
    const staleLease = Object.assign(new Error("stale"), { code: "stale_lease" });
    const readyCandidate = {
      loopRunId: "loop_run_ready",
      projectId: "project_1",
      nodeRunId: "node_run_ready",
      nodeRunVersion: 2,
      activationNo: 1,
      waitingReason: "workspace_missing",
      configurationVersion: "configuration:old",
    };
    const changedCandidate = {
      ...readyCandidate,
      loopRunId: "loop_run_changed",
      nodeRunId: "node_run_changed",
    };

    await expect(resumeWaitingConfigurationNodes({
      limit: 10,
      now: new Date("2026-07-31T02:00:00.000Z"),
      loadWaiting: vi.fn().mockResolvedValue([readyCandidate, changedCandidate]),
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          recipientUserId: "user_1",
          readiness: {
            ready: true,
            reason: null,
            configurationVersion: "configuration:ready",
            evidence: { bindingId: "binding_1", bindingVersion: 3 },
          },
        })
        .mockResolvedValueOnce({
          recipientUserId: "user_1",
          readiness: {
            ready: false,
            reason: "runtime_missing",
            configurationVersion: "configuration:new",
            evidence: { bindingId: "binding_1", bindingVersion: 3 },
          },
        }),
      resume: vi.fn().mockRejectedValue(staleLease),
      waitForConfiguration: vi.fn().mockRejectedValue(staleLease),
    })).resolves.toEqual({ scanned: 2, resumed: 0, refreshed: 0, contended: 2 });
  });
});

describe("loadWaitingConfigurationCandidates", () => {
  it("loads graph nodes waiting on local configuration from every Project", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "node_run_1",
      loopRunId: "loop_run_1",
      activationNo: 1,
      version: 2,
      waitingReason: "workspace_missing",
      readinessEvidence: { configurationVersion: "configuration:old" },
      loopRun: { projectId: "project_1" },
    }]);

    await expect(loadWaitingConfigurationCandidates(10, {
      loopNodeRun: { findMany },
    } as never)).resolves.toEqual([{
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 2,
      activationNo: 1,
      waitingReason: "workspace_missing",
      configurationVersion: "configuration:old",
    }]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: "waiting_configuration",
        loopRun: {
          engineKind: "graph_v1",
          status: "waiting",
        },
      },
      take: 10,
    }));
  });
});

describe("loadPersistedLocalExecutionReadiness", () => {
  it("assembles redacted current device facts from the immutable binding snapshot", async () => {
    const findWorkers = vi.fn().mockResolvedValue([{
      id: "local-worker:device_1",
      localDeviceId: "device_1",
      status: "online",
      version: 4,
      lastHeartbeatAt: new Date("2026-07-31T01:59:30.000Z"),
      capabilities: ["workspace", "commands", "codex"],
      localDevice: { userId: "user_owner", status: "authorized" },
    }]);
    const db = {
      loopNodeRun: { findUnique: vi.fn().mockResolvedValue({
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "code",
        loopRun: {
          projectId: "project_1",
          bindingSnapshot: {
            id: "binding_1",
            version: 3,
            createdByUserId: "user_owner",
            allowedAgentProfileIds: ["profile_codex"],
            allowedProviders: ["codex"],
          },
          grantSnapshot: { automationGrantIds: ["grant_1"] },
          project: { spaceId: "space_1", ownerType: "personal", ownerUserId: "user_owner", companyId: null },
        },
      }) },
      agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_codex", provider: "codex", status: "active" }) },
      agentWorker: { findMany: findWorkers },
      deviceAgentRuntimeProfile: { findFirst: vi.fn().mockResolvedValue({
        id: "runtime_1", localDeviceId: "device_1", provider: "codex", status: "ready", version: 2,
      }) },
      projectDeviceWorkspace: { findFirst: vi.fn().mockResolvedValue({
        id: "workspace_1", projectId: "project_1", localDeviceId: "device_1", status: "ready", configurationVersion: 5,
      }) },
      automationGrant: { findMany: vi.fn().mockResolvedValue([{
        id: "grant_1",
        status: "active",
        version: 1,
        expiresAt: null,
        revokedAt: null,
        scope: {
          workspaceBindingIds: ["workspace_1"],
          agentProfileIds: ["profile_codex"],
          providers: ["codex"],
          deviceIds: ["device_1"],
          workerIds: ["local-worker:device_1"],
        },
      }]) },
    };

    await expect(loadPersistedLocalExecutionReadiness({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      now: new Date("2026-07-31T02:00:00.000Z"),
    }, db as never)).resolves.toMatchObject({
      recipientUserId: "user_owner",
      readiness: {
        ready: true,
        reason: null,
        evidence: {
          bindingId: "binding_1",
          agentProfileId: "profile_codex",
          workerId: "local-worker:device_1",
          runtimeProfileId: "runtime_1",
          workspaceBindingId: "workspace_1",
          automationGrantId: "grant_1",
        },
      },
    });
    expect(JSON.stringify(await loadPersistedLocalExecutionReadiness({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      now: new Date("2026-07-31T02:00:00.000Z"),
    }, db as never))).not.toContain("/Users/");
    expect(findWorkers.mock.calls[0]?.[0]?.where).not.toHaveProperty("spaceId");
  });

  it("treats a complete immutable Linux Worker configuration as dispatchable without a Desktop device", async () => {
    const findWorkers = vi.fn();
    const db = {
      loopNodeRun: { findUnique: vi.fn().mockResolvedValue({
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "code",
        loopRun: {
          projectId: "project_1",
          bindingSnapshot: {
            id: "binding_1",
            version: 3,
            createdByUserId: "user_owner",
            allowedAgentProfileIds: ["profile_codex"],
            allowedProviders: ["codex"],
            workerExecution: {
              workerPoolId: "a".repeat(32),
              workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
              workerBranchPolicy: { allowedBranches: ["main"] },
              workerStageConfigurations: {
                code: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
              },
            },
          },
          grantSnapshot: { automationGrantIds: [] },
          project: { spaceId: "space_1", ownerType: "personal", ownerUserId: "user_owner", companyId: null },
        },
      }) },
      agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_codex", provider: "codex", status: "active" }) },
      workerPool: { findFirst: vi.fn().mockResolvedValue({
        id: "a".repeat(32),
        status: "active",
        maxConcurrentRuns: 2,
        sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date("2026-08-23T07:59:30.000Z"), linuxRuns: [] }],
      }) },
      agentWorker: { findMany: findWorkers },
      deviceAgentRuntimeProfile: { findFirst: vi.fn() },
      projectDeviceWorkspace: { findFirst: vi.fn() },
      automationGrant: { findMany: vi.fn() },
    };

    await expect(loadPersistedLocalExecutionReadiness({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      now: new Date("2026-08-23T08:00:00.000Z"),
    }, db as never)).resolves.toMatchObject({
      recipientUserId: "user_owner",
      readiness: {
        ready: true,
        reason: null,
        evidence: { agentProfileId: "profile_codex", provider: null, workerId: `linux-pool:${"a".repeat(32)}` },
      },
    });
    expect(findWorkers).not.toHaveBeenCalled();
    expect(db.agentProfile.findFirst).not.toHaveBeenCalled();
  });

  it("waits for Project repository credentials before dispatching to a Linux Worker", async () => {
    const db = {
      loopNodeRun: { findUnique: vi.fn().mockResolvedValue({
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "code",
        loopRun: {
          projectId: "project_1",
          executionSnapshot: {
            target: { type: "linux_worker_pool", workerPoolId: "a".repeat(32), poolDisplayName: "default-pool" },
          },
          bindingSnapshot: {
            id: "binding_1",
            version: 3,
            createdByUserId: "user_owner",
            allowedAgentProfileIds: ["profile_codex"],
            allowedProviders: ["codex"],
            workerExecution: {
              workerPoolId: "a".repeat(32),
              workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
              workerBranchPolicy: { allowedBranches: ["main"] },
              workerStageConfigurations: {
                code: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
              },
            },
          },
          grantSnapshot: { automationGrantIds: [] },
          project: {
            spaceId: "space_1",
            ownerType: "personal",
            ownerUserId: "user_owner",
            companyId: null,
            repositoryConfiguration: {
              schemaVersion: 1,
              provider: "github",
              creationMode: "existing",
              privateBaseUrl: null,
              privateWebUrl: null,
              privateTokenHelpUrl: null,
              authMode: "project_token",
              verification: {
                status: "pending_verification",
                verifiedAt: null,
                defaultBranch: null,
                headSha: null,
                failureCode: null,
                apiChecked: false,
              },
            },
          },
        },
      }) },
      workerPool: { findFirst: vi.fn().mockResolvedValue({
        id: "a".repeat(32),
        status: "active",
        maxConcurrentRuns: 2,
        sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date("2026-08-23T07:59:30.000Z"), linuxRuns: [] }],
      }) },
      agentProfile: { findFirst: vi.fn() },
      agentWorker: { findMany: vi.fn() },
      deviceAgentRuntimeProfile: { findFirst: vi.fn() },
      projectDeviceWorkspace: { findFirst: vi.fn() },
      automationGrant: { findMany: vi.fn() },
    };

    await expect(loadPersistedLocalExecutionReadiness({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      now: new Date("2026-08-23T08:00:00.000Z"),
    }, db as never)).resolves.toMatchObject({
      readiness: {
        ready: false,
        reason: "repository_credential_unverified",
        evidence: { workerId: `linux-pool:${"a".repeat(32)}` },
      },
    });
  });

  it("holds a Linux Worker assignment until the binding allows an audit Agent Profile", async () => {
    const db = {
      loopNodeRun: { findUnique: vi.fn().mockResolvedValue({
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "code",
        loopRun: {
          projectId: "project_1",
          bindingSnapshot: {
            id: "binding_1",
            version: 3,
            createdByUserId: "user_owner",
            allowedAgentProfileIds: [],
            allowedProviders: [],
            workerExecution: {
              workerPoolId: "a".repeat(32),
              workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
              workerBranchPolicy: { allowedBranches: ["main"] },
              workerStageConfigurations: {
                code: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
              },
            },
          },
          grantSnapshot: { automationGrantIds: [] },
          project: { spaceId: "space_1", ownerType: "personal", ownerUserId: "user_owner", companyId: null },
        },
      }) },
      agentProfile: { findFirst: vi.fn() },
      workerPool: { findFirst: vi.fn().mockResolvedValue({
        id: "a".repeat(32),
        status: "active",
        maxConcurrentRuns: 2,
        sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date("2026-08-23T07:59:30.000Z"), linuxRuns: [] }],
      }) },
      agentWorker: { findMany: vi.fn() },
      deviceAgentRuntimeProfile: { findFirst: vi.fn() },
      projectDeviceWorkspace: { findFirst: vi.fn() },
      automationGrant: { findMany: vi.fn() },
    };

    await expect(loadPersistedLocalExecutionReadiness({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      now: new Date("2026-08-23T08:00:00.000Z"),
    }, db as never)).resolves.toMatchObject({
      readiness: {
        ready: false,
        reason: "profile_not_allowed",
        evidence: { agentProfileId: null, workerId: `linux-pool:${"a".repeat(32)}` },
      },
    });
    expect(db.agentProfile.findFirst).not.toHaveBeenCalled();
  });

  it("holds a Linux Worker assignment until its token-owned Pool has a fresh Session", async () => {
    const findPool = vi.fn().mockResolvedValue({
      id: "a".repeat(32), status: "active", maxConcurrentRuns: 2, sessions: [],
    });
    const db = {
      loopNodeRun: { findUnique: vi.fn().mockResolvedValue({
        id: "node_run_1", loopRunId: "loop_run_1", nodeKey: "code",
        loopRun: {
          projectId: "project_1",
          bindingSnapshot: {
            id: "binding_1", version: 3, createdByUserId: "user_owner",
            allowedAgentProfileIds: ["profile_codex"], allowedProviders: ["codex"],
            workerExecution: {
              workerPoolId: "a".repeat(32), workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
              workerBranchPolicy: { allowedBranches: ["main"] },
              workerStageConfigurations: { code: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" } },
            },
          },
          grantSnapshot: { automationGrantIds: [] }, project: { spaceId: "space_1", ownerType: "personal", ownerUserId: "user_owner", companyId: null },
        },
      }) },
      agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_codex", provider: "codex", status: "active" }) },
      workerPool: { findFirst: findPool },
      agentWorker: { findMany: vi.fn() }, deviceAgentRuntimeProfile: { findFirst: vi.fn() },
      projectDeviceWorkspace: { findFirst: vi.fn() }, automationGrant: { findMany: vi.fn() },
    };

    await expect(loadPersistedLocalExecutionReadiness({
      loopRunId: "loop_run_1", nodeRunId: "node_run_1", now: new Date("2026-08-23T08:00:00.000Z"),
    }, db as never)).resolves.toMatchObject({ readiness: { ready: false, reason: "worker_offline" } });
    expect(findPool).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "a".repeat(32), ownerType: "personal", ownerUserId: "user_owner", companyId: null, status: "active", revokedAt: null },
    }));
  });

  it("uses the Project company Pool even when the Binding creator is a different member", async () => {
    const findPool = vi.fn().mockResolvedValue({
      id: "a".repeat(32), status: "active", maxConcurrentRuns: 2,
      sessions: [{ requestedConcurrency: 2, lastSeenAt: new Date("2026-08-23T07:59:30.000Z"), linuxRuns: [] }],
    });
    const db = {
      loopNodeRun: { findUnique: vi.fn().mockResolvedValue({
        id: "node_run_1", loopRunId: "loop_run_1", nodeKey: "code",
        loopRun: {
          projectId: "project_1",
          bindingSnapshot: {
            id: "binding_1", version: 3, createdByUserId: "user_member",
            allowedAgentProfileIds: ["profile_codex"], allowedProviders: ["codex"],
            workerExecution: {
              workerPoolId: "a".repeat(32), workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
              workerBranchPolicy: { allowedBranches: ["main"] },
              workerStageConfigurations: { code: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" } },
            },
          },
          grantSnapshot: { automationGrantIds: [] },
          project: { spaceId: "space_1", ownerType: "company", ownerUserId: null, companyId: "company_1" },
        },
      }) },
      agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_codex", provider: "codex", status: "active" }) },
      workerPool: { findFirst: findPool },
      agentWorker: { findMany: vi.fn() }, deviceAgentRuntimeProfile: { findFirst: vi.fn() },
      projectDeviceWorkspace: { findFirst: vi.fn() }, automationGrant: { findMany: vi.fn() },
    };
    await expect(loadPersistedLocalExecutionReadiness({ loopRunId: "loop_run_1", nodeRunId: "node_run_1", now: new Date("2026-08-23T08:00:00.000Z") }, db as never)).resolves.toMatchObject({ readiness: { ready: true } });
    expect(findPool).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "a".repeat(32), ownerType: "company", ownerUserId: null, companyId: "company_1", status: "active", revokedAt: null },
    }));
  });

  it("selects the live Grant-authorized Worker when an older device sorts first", async () => {
    const db = {
      loopNodeRun: { findUnique: vi.fn().mockResolvedValue({
        id: "node_run_1",
        loopRunId: "loop_run_1",
        nodeKey: "code",
        loopRun: {
          projectId: "project_1",
          bindingSnapshot: {
            id: "binding_1",
            version: 3,
            createdByUserId: "user_owner",
            allowedAgentProfileIds: ["profile_codex"],
            allowedProviders: ["codex"],
          },
          grantSnapshot: { automationGrantIds: ["grant_new_device"] },
          project: { spaceId: "space_1" },
        },
      }) },
      agentProfile: { findFirst: vi.fn().mockResolvedValue({ id: "profile_codex", provider: "codex", status: "active" }) },
      agentWorker: { findMany: vi.fn().mockResolvedValue([
        {
          id: "local-worker:device-old",
          localDeviceId: "device-old",
          status: "online",
          version: 1,
          lastHeartbeatAt: new Date("2026-07-31T01:00:00.000Z"),
          capabilities: ["codex"],
          localDevice: { userId: "user_owner", status: "authorized" },
        },
        {
          id: "local-worker:device-new",
          localDeviceId: "device-new",
          status: "online",
          version: 1,
          lastHeartbeatAt: new Date("2026-07-31T01:59:59.000Z"),
          capabilities: ["workspace", "commands", "codex"],
          localDevice: { userId: "user_owner", status: "authorized" },
        },
      ]) },
      deviceAgentRuntimeProfile: { findFirst: vi.fn().mockImplementation(({ where }: { where: { localDeviceId: string } }) => (
        where.localDeviceId === "device-new"
          ? Promise.resolve({ id: "runtime-new", localDeviceId: "device-new", provider: "codex", status: "ready", version: 2 })
          : Promise.resolve({ id: "runtime-old", localDeviceId: "device-old", provider: "codex", status: "ready", version: 1 })
      )) },
      projectDeviceWorkspace: { findFirst: vi.fn().mockImplementation(({ where }: { where: { localDeviceId: string } }) => (
        where.localDeviceId === "device-new"
          ? Promise.resolve({ id: "workspace-new", projectId: "project_1", localDeviceId: "device-new", status: "ready", configurationVersion: 2 })
          : Promise.resolve({ id: "workspace-old", projectId: "project_1", localDeviceId: "device-old", status: "ready", configurationVersion: 1 })
      )) },
      automationGrant: { findMany: vi.fn().mockResolvedValue([{
        id: "grant_new_device",
        status: "active",
        version: 1,
        expiresAt: null,
        revokedAt: null,
        scope: {
          workspaceBindingIds: ["workspace-new"],
          agentProfileIds: ["profile_codex"],
          providers: ["codex"],
          deviceIds: ["device-new"],
          workerIds: ["local-worker:device-new"],
        },
      }]) },
    };

    await expect(loadPersistedLocalExecutionReadiness({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      now: new Date("2026-07-31T02:00:00.000Z"),
    }, db as never)).resolves.toMatchObject({
      readiness: {
        ready: true,
        reason: null,
        evidence: {
          workerId: "local-worker:device-new",
          deviceId: "device-new",
          runtimeProfileId: "runtime-new",
          workspaceBindingId: "workspace-new",
          automationGrantId: "grant_new_device",
        },
      },
    });
  });

  it("expires pending runtime safety approvals and fails their waiting Loop state", async () => {
    const tx = {
      approvalRequest: {
        findMany: vi.fn().mockResolvedValue([{
          id: "approval_1",
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
        }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loopNodeRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      loopRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const now = new Date("2026-08-06T17:00:00.000Z");

    await expect(expirePendingRuntimeSafetyApprovals(now, db)).resolves.toEqual({ expired: 1 });
    expect(tx.approvalRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { type: "loop_runtime_safety", status: "pending", expiresAt: { lte: now } },
    }));
    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "approval_1", status: "pending" },
      data: expect.objectContaining({ status: "expired" }),
    }));
    expect(tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "node_run_1", loopRunId: "loop_run_1", status: "waiting_approval" },
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "loop_run_1", status: "waiting" },
      data: expect.objectContaining({ status: "failed", statusReason: "runtime_safety_expired" }),
    }));
  });
});

describe("matchReadyNodeRuntimeApproval", () => {
  it("matches only an approved, live, exact-action grant for the same NodeRun", () => {
    const now = new Date("2026-07-31T02:00:00.000Z");
    const approval = {
      id: "approval:assignment",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      type: "loop_runtime_safety",
      status: "approved",
      requestPayload: { actionFingerprint: "sha256:assignment" },
      grantPayload: {
        kind: "one_time_action",
        approvalId: "approval:assignment",
        actionFingerprint: "sha256:assignment",
        expiresAt: "2026-07-31T03:00:00.000Z",
        consumedAt: null,
      },
      expiresAt: new Date("2026-07-31T01:30:00.000Z"),
    };

    expect(matchReadyNodeRuntimeApproval({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      actionFingerprint: "sha256:assignment",
      approvals: [approval],
      now,
    })).toEqual({
      outcome: "auto_approve",
      reasonCode: "runtime_safety_approval_matched",
      matchedGrantId: "approval:assignment",
    });
    expect(matchReadyNodeRuntimeApproval({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      actionFingerprint: "sha256:other",
      approvals: [approval],
      now,
    })).toBeNull();
  });
});

describe("recoverExpiredRunAtomically", () => {
  it("writes the orphan transition and recovery signal in one transaction", async () => {
    const tx = {
      agentRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      agentWorker: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      outboxMessage: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const now = new Date("2026-07-21T00:10:00.000Z");

    await expect(recoverExpiredRunAtomically({
      id: "agent_run_1",
      loopRunId: "loop_run_1",
      leaseGeneration: 3,
      workerId: "worker_1",
      now,
    }, db)).resolves.toBe(true);

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "agent_run_1",
        leaseGeneration: 3,
        leaseExpiresAt: { lte: now },
      }),
      data: expect.objectContaining({ status: "orphaned", finishedAt: now }),
    }));
    expect(tx.outboxMessage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        topic: "run.recover",
        aggregateId: "loop_run_1",
        payload: {
          loopRunId: "loop_run_1",
          runId: "agent_run_1",
          reason: "orphaned",
        },
      }),
    }));
    expect(tx.agentWorker.updateMany).toHaveBeenCalledWith({
      where: { id: "worker_1", activeRunCount: { gt: 0 } },
      data: { activeRunCount: { decrement: 1 } },
    });
  });

  it("does not release Worker capacity when the expired lease loses the CAS", async () => {
    const tx = {
      agentRun: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      agentWorker: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      outboxMessage: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    await expect(recoverExpiredRunAtomically({
      id: "agent_run_1",
      loopRunId: "loop_run_1",
      leaseGeneration: 3,
      workerId: "worker_1",
      now: new Date("2026-07-21T00:10:00.000Z"),
    }, db)).resolves.toBe(false);

    expect(tx.agentWorker.updateMany).not.toHaveBeenCalled();
    expect(tx.outboxMessage.upsert).not.toHaveBeenCalled();
  });
});

describe("resolveProductionOutboxTopics", () => {
  it("always claims durable Loop notification projection signals", () => {
    expect(resolveProductionOutboxTopics({ loop: false, graphV1: false }))
      .toContain("loop.notification.intent");
    expect(resolveProductionOutboxTopics({ loop: false, graphV1: false }))
      .toContain("repository.verification.requested");
  });

  it("claims platform execution only when both Loop rollout flags are enabled", () => {
    expect(resolveProductionOutboxTopics({ loop: false, graphV1: true })).not.toContain("loop.platform.execute");
    expect(resolveProductionOutboxTopics({ loop: true, graphV1: false })).not.toContain("loop.platform.execute");
    expect(resolveProductionOutboxTopics({ loop: true, graphV1: true })).toContain("loop.platform.execute");
  });
});

describe("loadWaitingLoopCandidates", () => {
  it("filters callbacks and future timers before taking a bounded due slice", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "attempt_1",
      attempt: 2,
      version: 4,
      checkpoint: { waitingReason: "timer", wakeAt: "2026-07-30T07:00:00.000Z" },
      loopNodeRun: {
        id: "node_run_1",
        loopRunId: "loop_run_1",
        version: 6,
        inputSnapshot: { objective: "Ship" },
      },
    }]);

    const now = new Date("2026-07-30T07:00:00.000Z");
    await expect(loadWaitingLoopCandidates(100, now, {
      loopNodeAttempt: { findMany },
    } as never)).resolves.toEqual([{
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 6,
      attemptId: "attempt_1",
      attemptNo: 2,
      attemptVersion: 4,
      inputSnapshot: { objective: "Ship" },
      checkpoint: { waitingReason: "timer", wakeAt: "2026-07-30T07:00:00.000Z" },
    }]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        executorType: "platform",
        status: "waiting",
        AND: [
          { checkpoint: { path: "$.waitingReason", equals: "timer" } },
          { checkpoint: { path: "$.wakeAt", lte: now.toISOString() } },
        ],
        loopNodeRun: expect.objectContaining({
          status: "waiting_input",
          loopRun: expect.objectContaining({
            engineKind: "graph_v1",
            status: "waiting",
          }),
        }),
      }),
      take: 100,
    }));
  });
});
