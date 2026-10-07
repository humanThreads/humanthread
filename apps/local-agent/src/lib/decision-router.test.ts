import { loopAssignmentV2Schema, type LoopAssignmentV2 } from "@humanthread/shared";
import { describe, expect, it, vi } from "vitest";

import type { AgentProviderAdapter, NormalizedRunEvent } from "./providers/provider-adapter";
import { decideNextStage } from "./decision-router";
import {
  DECISION_ROUTER_CONTRACT_DIGEST,
  calculateDecisionRouterContractDigest,
} from "./decision-router-contract";

const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;

function events(result: unknown): AsyncIterable<NormalizedRunEvent> {
  return (async function* () {
    yield { type: "run.started", providerSessionId: "router-session" };
    yield { type: "run.completed", result };
  })();
}

function provider(result: unknown): AgentProviderAdapter {
  return {
    capabilities: () => ({ sessionResume: false, structuredResult: true, approvals: false }),
    executeStructured: vi.fn(() => events(result)),
    start: vi.fn(() => events(result)),
    resume: vi.fn(() => events(result)),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

function assignmentFixture(overrides: Record<string, unknown> = {}): LoopAssignmentV2 {
  const nodes = [
    {
      key: "code_dev_a",
      nodeId: "code_dev_a",
      label: "开发 A",
      type: "agent_action" as const,
      executionTarget: "local" as const,
      offlinePolicy: "local_capable" as const,
      responsibility: "修复代码并补充测试证据",
      allowedRouteTargets: ["test"],
    },
    {
      key: "test",
      nodeId: "test",
      label: "测试",
      type: "agent_action" as const,
      executionTarget: "local" as const,
      offlinePolicy: "local_capable" as const,
      responsibility: "执行测试并分类失败",
      allowedRouteTargets: ["code_dev_a", "human_review"],
    },
    {
      key: "human_review",
      nodeId: "human_review",
      label: "人工审核",
      type: "gate" as const,
      executionTarget: "platform" as const,
      offlinePolicy: "online_required" as const,
      responsibility: "处理无法自动推导的路由",
      allowedRouteTargets: [],
    },
    {
      key: "write_plan",
      nodeId: "write_plan",
      label: "生成开发计划",
      type: "agent_action" as const,
      executionTarget: "local" as const,
      offlinePolicy: "local_capable" as const,
      responsibility: "根据当前需求和仓库事实重新生成可执行开发计划",
      allowedRouteTargets: ["code_dev_a"],
    },
  ];
  return {
    id: "assignment_router",
    agentRunId: "agent_run_router",
    loopRunId: "loop_run_router",
    loopNodeRunId: "node_run_router",
    loopNodeAttemptId: "attempt_router",
    attemptNo: 1,
    leaseGeneration: 1,
    leaseExpiresAt: "2026-08-08T12:30:00.000Z",
    acceptedThroughSequence: 0,
    node: {
      key: "test",
      nodeId: "test",
      label: "测试",
      type: "agent_action",
      executionTarget: "local",
      offlinePolicy: "local_capable",
      responsibility: "执行测试并分类失败",
      allowedRouteTargets: ["code_dev_a", "human_review"],
      promptTemplate: "test",
    },
    graph: {
      schemaVersion: 1,
      inputSchema: {},
      outputSchema: {},
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [],
      edges: [],
    },
    inputSnapshot: {},
    policySnapshot: {},
    grantSnapshot: {},
    runtime: { agentProfileId: "profile_codex", provider: "codex", runtimeProfileId: "runtime_1", configurationVersion: 1 },
    workspace: { bindingId: "workspace_1", configurationVersion: 1, pathFingerprint: "hmac-sha256:router" },
    prompt: "test",
    resultSchemaPath: ".humanthread/results/router.json",
    contractVersion: 2,
    runGraphSnapshot: {
      schemaVersion: 2,
      snapshotId: "snapshot_router",
      graphDigest: digest("a"),
      rootLoopVersionId: "version_router",
      loopVersions: [{
        loopDefinitionId: "loop_router",
        loopVersionId: "version_router",
        scope: "task",
        graph: {
          schemaVersion: 2,
          limits: { maxStages: 4, maxRepeatCount: 2 },
          nodes,
          edges: [
            { id: "test-dev", source: "test", target: "code_dev_a", kind: "feedback", outcome: "rework", maxTraversals: 2 },
            { id: "test-human", source: "test", target: "human_review", kind: "normal", outcome: "blocked" },
            { id: "dev-test", source: "code_dev_a", target: "test", kind: "normal", outcome: "success" },
          ],
        },
      }],
      reachableNodeIds: ["code_dev_a", "test", "human_review", "write_plan"],
    },
    routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
    offlineContinuation: null,
    ...overrides,
  } as unknown as LoopAssignmentV2;
}

const gate = { passed: false, issueType: "TEST_FAILED", summary: "测试失败", evidence: ["artifacts/test.json"], checks: [] };

describe("built-in DecisionRouter", () => {
  it("binds the contract digest to the built-in Prompt and output Schema", async () => {
    await expect(calculateDecisionRouterContractDigest()).resolves.toBe(DECISION_ROUTER_CONTRACT_DIGEST);
  });

  it("routes a failed test back only to the snapshotted development node", async () => {
    const result = await decideNextStage({
      assignment: assignmentFixture(),
      provider: provider({
        decisionId: "decision_1", fromNodeId: "test", nextNodeId: "code_dev_a",
        reasonCode: "TEST_FAILED_REQUIRES_CODE_FIX", summary: "代码需要修复",
        evidence: ["artifacts/test.json"], confidence: 0.94,
        snapshotDigest: digest("a"), routerContractVersion: 1, routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
      }),
      stageResult: { status: "FAILED" },
      gateResult: gate,
      workspaceRealpath: "/workspace/project",
      resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "workspace_full", workspaceRealpath: "/workspace/project" },
    });
    expect(result.nextNodeId).toBe("code_dev_a");
  });

  it("routes a failed business test from an immutable v1 snapshot", async () => {
    const legacyGraph = {
      schemaVersion: 1 as const,
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [
        { key: "business_test", nodeId: "business_test", label: "Business test", type: "agent_action" as const, executionTarget: "local" as const },
        { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action" as const, executionTarget: "local" as const },
        { key: "end", nodeId: "end", label: "End", type: "end" as const },
      ],
      edges: [
        { id: "business-test-end", source: "business_test", target: "end", kind: "normal" as const, outcome: "success" as const },
        { id: "develop-business-test", source: "develop", target: "business_test", kind: "normal" as const, outcome: "success" as const },
      ],
    };
    const assignment = loopAssignmentV2Schema.parse({
      id: "assignment_legacy_router",
      agentRunId: "agent_run_legacy_router",
      loopRunId: "loop_run_legacy_router",
      loopNodeRunId: "node_run_legacy_router",
      loopNodeAttemptId: "attempt_legacy_router",
      attemptNo: 2,
      leaseGeneration: 1,
      leaseExpiresAt: "2026-08-14T13:00:00.000Z",
      acceptedThroughSequence: 0,
      stageRef: {
        loopDefinitionId: "loop_project",
        loopVersionId: "version_legacy",
        nodeId: "business_test",
        subloopId: "business_test",
      },
      node: {
        key: "business_test",
        nodeId: "business_test",
        label: "Business test",
        type: "agent_action",
        executionTarget: "local",
        promptTemplate: "Run business tests",
      },
      graph: {
        schemaVersion: 1,
        inputSchema: {},
        outputSchema: {},
        limits: legacyGraph.limits,
        nodes: [
          { key: "business_test", nodeId: "business_test", label: "Business test", type: "agent_action", executionTarget: "local", promptTemplate: "Run business tests" },
          { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", promptTemplate: "Fix regressions" },
          { key: "end", nodeId: "end", label: "End", type: "end" },
        ],
        edges: legacyGraph.edges,
      },
      inputSnapshot: {},
      policySnapshot: {},
      grantSnapshot: {},
      runtime: { agentProfileId: "profile_codex", provider: "codex", runtimeProfileId: "runtime_1", configurationVersion: 1 },
      workspace: { bindingId: "workspace_1", configurationVersion: 1, pathFingerprint: "hmac-sha256:router" },
      prompt: "Run business tests",
      resultSchemaPath: ".humanthread/results/router.json",
      contractVersion: 2,
      runGraphSnapshot: {
        snapshotId: "snapshot_legacy_router",
        graphDigest: digest("a"),
        rootLoopVersionId: "version_legacy",
        loopVersions: [{
          loopDefinitionId: "loop_project",
          loopVersionId: "version_legacy",
          scope: "project",
          graph: legacyGraph,
        }],
        reachableNodeIds: ["business_test", "develop", "end"],
      },
      routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
      offlineContinuation: null,
    });

    const result = await decideNextStage({
      assignment,
      provider: provider({
        decisionId: "decision_legacy_business_test_develop",
        fromNodeId: "business_test",
        nextNodeId: "develop",
        reasonCode: "PRODUCT_BEHAVIOR_REGRESSION",
        summary: "Return to development using the business-test evidence.",
        evidence: ["artifacts/business-test/business-test-report.json"],
        confidence: 0.99,
        snapshotDigest: digest("a"),
        routerContractVersion: 1,
        routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
      }),
      stageResult: { status: "FAILED", issueType: "PRODUCT_BEHAVIOR_REGRESSION" },
      gateResult: gate,
      workspaceRealpath: "/workspace/project",
      resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/workspace/project" },
    });

    expect(result.nextNodeId).toBe("develop");
  });

  it("can route to any executable node in the current Loop snapshot without a direct edge", async () => {
    const adapter = provider({
      decisionId: "decision_replan", fromNodeId: "test", nextNodeId: "write_plan",
      reasonCode: "PLAN_ENVIRONMENT_MISMATCH", summary: "当前计划与仓库事实不一致",
      evidence: ["artifacts/develop/implementation-summary.md"], confidence: 0.97,
      snapshotDigest: digest("a"), routerContractVersion: 1, routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
    });

    const result = await decideNextStage({
      assignment: assignmentFixture(),
      provider: adapter,
      stageResult: {
        status: "NEEDS_CLARIFICATION",
        issueType: "PLAN_ENVIRONMENT_MISMATCH",
        summary: "计划要求不存在的 Web E2E runner",
        checklist: [{ id: "should-not-be-forwarded", title: "private checklist detail" }],
        privateWorkspaceContext: "PRD and source code must not be forwarded to Decision",
      },
      gateResult: gate,
      workspaceRealpath: "/workspace/project",
      resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "workspace_full", workspaceRealpath: "/workspace/project" },
    });

    expect(result.nextNodeId).toBe("write_plan");
    expect(adapter.executeStructured).toHaveBeenCalledOnce();
    const call = vi.mocked(adapter.executeStructured).mock.calls[0]![0];
    expect(call.mode).toBe("router");
    expect(call.executionPolicy).toEqual({ mode: "read_only", workspaceRealpath: "/workspace/project" });
    expect(call.prompt).toContain("PLAN_ENVIRONMENT_MISMATCH");
    expect(call.prompt).not.toContain("should-not-be-forwarded");
    expect(call.prompt).not.toContain("private checklist detail");
    expect(call.prompt).not.toContain("PRD and source code");
  });

  it("passes the resolved local model and reasoning effort to the router Provider", async () => {
    const adapter = provider({
      decisionId: "decision_local_model", fromNodeId: "test", nextNodeId: "code_dev_a",
      reasonCode: "TEST_FAILED_REQUIRES_CODE_FIX", summary: "代码需要修复",
      evidence: ["artifacts/test.json"], confidence: 0.94,
      snapshotDigest: digest("a"), routerContractVersion: 1, routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
    });

    await decideNextStage({
      assignment: assignmentFixture(),
      provider: adapter,
      stageResult: { status: "FAILED" },
      gateResult: gate,
      workspaceRealpath: "/workspace/project",
      resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "workspace_full", workspaceRealpath: "/workspace/project" },
      providerModelOptions: { model: "gpt-5.6-sol", reasoningEffort: "max" },
    });

    expect(vi.mocked(adapter.executeStructured)).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-sol",
      reasoningEffort: "max",
    }));
  });

  it("uses the assignment Loop version when a parent Loop has a node with the same id", async () => {
    const assignment = assignmentFixture({
      stageRef: {
        loopDefinitionId: "loop_task",
        loopVersionId: "task_version",
        nodeId: "test",
        subloopId: "test",
      },
      runGraphSnapshot: {
        ...assignmentFixture().runGraphSnapshot,
        rootLoopVersionId: "project_version",
        loopVersions: [
          {
            loopDefinitionId: "loop_project",
            loopVersionId: "project_version",
            scope: "project",
            graph: {
              schemaVersion: 2,
              limits: { maxStages: 3, maxRepeatCount: 2 },
              nodes: [
                { key: "test", nodeId: "test", label: "项目测试", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Project-only test", allowedRouteTargets: ["project_end"] },
                { key: "project_end", nodeId: "project_end", label: "项目结束", type: "end", offlinePolicy: "online_required" },
              ],
              edges: [{ id: "project-test-end", source: "test", target: "project_end", kind: "normal", outcome: "success" }],
            },
          },
          {
            ...assignmentFixture().runGraphSnapshot.loopVersions[0]!,
            loopVersionId: "task_version",
          },
        ],
      },
    });

    const result = await decideNextStage({
      assignment,
      provider: provider({
        decisionId: "decision_task_replan", fromNodeId: "test", nextNodeId: "write_plan",
        reasonCode: "PLAN_ENVIRONMENT_MISMATCH", summary: "回到任务级计划节点",
        evidence: [], confidence: 0.95,
        snapshotDigest: digest("a"), routerContractVersion: 1, routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
      }),
      stageResult: { status: "NEEDS_CLARIFICATION" }, gateResult: gate,
      workspaceRealpath: "/workspace/project", resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/workspace/project" },
    });

    expect(result.nextNodeId).toBe("write_plan");
  });

  it("rejects a plausible node that is not in this run snapshot", async () => {
    await expect(decideNextStage({
      assignment: assignmentFixture(),
      provider: provider({
        decisionId: "decision_2", fromNodeId: "test", nextNodeId: "code_dev_b",
        reasonCode: "TEST_FAILED_REQUIRES_CODE_FIX", summary: "代码需要修复",
        evidence: ["artifacts/test.json"], confidence: 0.9,
        snapshotDigest: digest("a"), routerContractVersion: 1, routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
      }),
      stageResult: { status: "FAILED" }, gateResult: gate,
      workspaceRealpath: "/workspace/project", resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/workspace/project" },
    })).rejects.toMatchObject({ code: "route_target_not_allowed" });
  });

  it("falls back to the snapshotted human review candidate when the provider output is unusable", async () => {
    const result = await decideNextStage({
      assignment: assignmentFixture(), provider: provider({ invalid: true }),
      stageResult: { status: "FAILED" }, gateResult: gate,
      workspaceRealpath: "/workspace/project", resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/workspace/project" },
    });
    expect(result.nextNodeId).toBe("human_review");
    expect(result.reasonCode).toBe("ROUTER_FALLBACK_HUMAN_REVIEW");
  });

  it("uses the unique normal success edge when the router provider is temporarily unavailable", async () => {
    const assignment = assignmentFixture({
      node: {
        key: "code_dev_a",
        nodeId: "code_dev_a",
        label: "开发 A",
        type: "agent_action",
        executionTarget: "local",
        offlinePolicy: "local_capable",
        responsibility: "修复代码并补充测试证据",
        allowedRouteTargets: ["test"],
        promptTemplate: "develop",
      },
    });
    const adapter = provider({});
    vi.mocked(adapter.executeStructured).mockImplementation(async function* () {
      yield {
        type: "run.failed",
        errorCode: "provider_error",
        message: "unexpected status 502 Bad Gateway: Upstream request failed",
      };
    });

    const result = await decideNextStage({
      assignment,
      provider: adapter,
      stageResult: { status: "SUCCESS", issueType: "NONE" },
      gateResult: { passed: true, issueType: "NONE", summary: "开发完成", evidence: [], checks: [] },
      workspaceRealpath: "/workspace/project",
      resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/workspace/project" },
    });

    expect(result.nextNodeId).toBe("test");
    expect(result.reasonCode).toBe("ROUTER_FALLBACK_NORMAL_SUCCESS");
  });

  it("leaves automatic repeat-budget enforcement to the platform", async () => {
    const result = await decideNextStage({
      assignment: assignmentFixture(),
      provider: provider({
        decisionId: "decision_3", fromNodeId: "test", nextNodeId: "code_dev_a",
        reasonCode: "TEST_FAILED_REQUIRES_CODE_FIX", summary: "继续修复",
        evidence: [], confidence: 0.9, snapshotDigest: digest("a"), routerContractVersion: 1, routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
      }),
      stageResult: { status: "FAILED" }, gateResult: gate,
      routeHistory: [{ fromNodeId: "test", nextNodeId: "code_dev_a" }, { fromNodeId: "test", nextNodeId: "code_dev_a" }],
      workspaceRealpath: "/workspace/project", resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/workspace/project" },
    });
    expect(result.nextNodeId).toBe("code_dev_a");
  });

  it("fails closed when the snapshot has no usable route candidate", async () => {
    const assignment = assignmentFixture();
    const graph = assignment.runGraphSnapshot.loopVersions[0]!.graph;
    graph.nodes = [{
      key: "start", nodeId: "start", label: "开始", type: "start", offlinePolicy: "online_required",
    }];
    assignment.node = { ...assignment.node, key: "start", nodeId: "start", type: "start" } as typeof assignment.node;
    await expect(decideNextStage({
      assignment, provider: provider({}), stageResult: {}, gateResult: gate,
      workspaceRealpath: "/workspace/project", resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/workspace/project" },
    })).rejects.toMatchObject({ code: "route_unavailable" });
  });

  it("rejects an Assignment that declares a different built-in Router contract", async () => {
    const assignment = assignmentFixture({ routerContract: { version: 1, digest: digest("c") } });
    const adapter = provider({});
    await expect(decideNextStage({
      assignment, provider: adapter, stageResult: {}, gateResult: gate,
      workspaceRealpath: "/workspace/project", resultSchemaPath: ".humanthread/runtime/router.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/workspace/project" },
    })).rejects.toMatchObject({ code: "router_contract_mismatch" });
    expect(adapter.executeStructured).not.toHaveBeenCalled();
  });
});
