import { describe, expect, it } from "vitest";
import {
  automationActionSchema,
  builtInDecisionRouterContract,
  automationGrantSchema,
  loopAgentEventBatchSchema,
  loopAgentEventSchema,
  loopChecklistCreatedPayloadSchema,
  loopChecklistUpdatedPayloadSchema,
  evaluateLoopChecklistClosure,
  isValidLoopChecklistTransition,
  validateLoopChecklistTransition,
  loopAssignmentSchema,
  loopAssignmentV2Schema,
  loopDefinitionOriginSchema,
  loopDefinitionScopeSchema,
  loopEdgeDefinitionSchema,
  loopExecutionPhaseSchema,
  loopGraphSchema,
  loopGraphV2Schema,
  parsePublishedLoopGraph,
  loopNodeDefinitionSchema,
  loopPlatformWaitSchema,
  loopConfigurationWaitingReasonSchema,
  loopNodeResultSchema,
  loopRetryPolicySchema,
  loopFailureEnvelopeSchema,
  failureCategorySchema,
  loopRuntimeBudgetSchema,
  loopNodeRunStatusSchema,
  loopTransitionCountersSchema,
  routeDecisionSchema,
  localRouteDecisionSchema,
  platformLoopGraphV2Schema,
  runGraphSnapshotSchema,
  runGraphSnapshotV2Schema,
  stableNodeId,
  validateLocalRouteDecision,
} from "./loop-engine";

const automationGrant = {
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
  workspaceBindingIds: ["workspace_binding_1"],
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
} as const;

describe("loop graph contracts", () => {
  it("publishes the built-in Decision Router contract for cross-process assignments", () => {
    expect(builtInDecisionRouterContract).toEqual({
      version: 1,
      digest: "sha256:42fdeee7caf3884e105a193f2356af051cddde8992c8640e7af6912ed5a2e241",
    });
  });

  it("accepts only the supported catalog scope and origin values", () => {
    expect(loopDefinitionScopeSchema.parse("task")).toBe("task");
    expect(loopDefinitionScopeSchema.parse("project")).toBe("project");
    expect(loopDefinitionOriginSchema.safeParse("unknown").success).toBe(false);
  });

  it("describes a bounded execution phase snapshot", () => {
    expect(loopExecutionPhaseSchema.parse({
      phase: "git.fetch",
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: "正在同步远端引用",
    })).toMatchObject({ phase: "git.fetch", status: "running" });
    expect(loopExecutionPhaseSchema.safeParse({
      phase: "x".repeat(65),
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: null,
    }).success).toBe(false);
    expect(loopExecutionPhaseSchema.safeParse({
      phase: "git.fetch",
      status: "unknown",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: null,
    }).success).toBe(false);
    expect(loopExecutionPhaseSchema.safeParse({
      phase: "git.fetch",
      status: "running",
      startedAt: "2026-09-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      summary: "x".repeat(513),
    }).success).toBe(false);
  });

  it.each(["low", "medium", "high", "xhigh", "max", "ultra"])(
    "accepts agent reasoning effort %s",
    (reasoningEffort) => {
      expect(loopNodeDefinitionSchema.parse({
        key: "work",
        label: "Work",
        type: "agent_action",
        executionTarget: "local",
        promptTemplate: "Work",
        reasoningEffort,
      })).toMatchObject({ reasoningEffort });
    },
  );

  it.each(["", "HIGH", "minimal", "unknown"])("rejects effort %s", (reasoningEffort) => {
    expect(loopNodeDefinitionSchema.safeParse({
      key: "work",
      label: "Work",
      type: "agent_action",
      executionTarget: "local",
      promptTemplate: "Work",
      reasoningEffort,
    }).success).toBe(false);
  });

  it("rejects reasoning effort on non-Agent nodes", () => {
    expect(loopNodeDefinitionSchema.safeParse({
      key: "gate",
      label: "Gate",
      type: "human_gate",
      executionTarget: "platform",
      reasoningEffort: "high",
    }).success).toBe(false);
  });

  it("accepts explicit SubLoop structure without local rule content", () => {
    const node = loopNodeDefinitionSchema.parse({
      key: "develop",
      nodeId: "node_develop",
      label: "Develop",
      type: "subloop_call",
      executionTarget: "platform",
      offlinePolicy: "local_capable",
      targetLoopDefinitionId: "loop_task_dev",
      targetLoopVersionId: "loop_version_task_dev_3",
      inputMapping: {},
      terminalOutcomeMapping: { success: "success", failure: "failure" },
    });

    expect(stableNodeId(node)).toBe("node_develop");
    expect(JSON.stringify(node)).not.toMatch(/prompt|skill|command|schemaPath/iu);
    expect(loopNodeDefinitionSchema.safeParse({
      ...node,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    }).success).toBe(false);
  });

  it("defaults legacy nodes to online-required execution and uses their key as stable identity", () => {
    const node = loopNodeDefinitionSchema.parse({
      key: "legacy_start",
      label: "Legacy start",
      type: "start",
    });

    expect(node.offlinePolicy).toBe("online_required");
    expect(stableNodeId(node)).toBe("legacy_start");
  });

  it("parses a frozen snapshot and route decision", () => {
    const snapshot = runGraphSnapshotSchema.parse({
      snapshotId: "snapshot_1",
      graphDigest: `sha256:${"a".repeat(64)}`,
      rootLoopVersionId: "loop_version_project_1",
      loopVersions: [{
        loopDefinitionId: "loop_project",
        loopVersionId: "loop_version_project_1",
        scope: "project",
        graph: {
          schemaVersion: 1,
          limits: { maxStages: 2, maxRepeatCount: 1 },
          nodes: [
            { key: "start", nodeId: "node_start", type: "start", label: "Start" },
            { key: "end", nodeId: "node_end", type: "end", label: "End" },
          ],
          edges: [{
            id: "edge_start_end",
            source: "start",
            target: "end",
            kind: "normal",
            outcome: "success",
          }],
        },
      }],
      reachableNodeIds: ["node_start", "node_end"],
    });
    const route = routeDecisionSchema.parse({
      runId: "run_1",
      nodeRunId: "node_run_test",
      attemptId: "attempt_1",
      assignmentEpoch: 1,
      graphDigest: snapshot.graphDigest,
      outcome: "failure",
      edgeId: "edge_test_dev",
      targetNodeId: "node_code_dev_a",
    });

    expect(snapshot.graphDigest).toMatch(/^sha256:/u);
    expect(route.targetNodeId).toBe("node_code_dev_a");
  });

  it("accepts v2 node responsibilities only when every route target is in the graph", () => {
    const graph = {
      schemaVersion: 2 as const,
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [
        {
          key: "develop",
          nodeId: "develop",
          label: "Develop",
          type: "agent_action" as const,
          executionTarget: "local" as const,
          offlinePolicy: "local_capable" as const,
          responsibility: "Implement the approved requirement and produce code evidence.",
          allowedRouteTargets: ["test"],
        },
        {
          key: "test",
          nodeId: "test",
          label: "Test",
          type: "agent_action" as const,
          executionTarget: "local" as const,
          offlinePolicy: "local_capable" as const,
          responsibility: "Run the required tests and classify failures.",
          allowedRouteTargets: ["develop"],
        },
      ],
      edges: [
        { id: "develop-test", source: "develop", target: "test", kind: "normal" as const, outcome: "success" as const },
        { id: "test-develop", source: "test", target: "develop", kind: "feedback" as const, outcome: "rework" as const, maxTraversals: 2 },
      ],
    };

    expect(platformLoopGraphV2Schema.parse(graph).nodes[0]).toMatchObject({
      responsibility: "Implement the approved requirement and produce code evidence.",
      allowedRouteTargets: ["test"],
    });
    expect(platformLoopGraphV2Schema.safeParse({
      ...graph,
      nodes: graph.nodes.map((node) => node.key === "test"
        ? { ...node, allowedRouteTargets: ["code_dev_b"] }
        : node),
    }).success).toBe(false);
  });

  it("keeps repository content in a separate v2 authoring graph contract", () => {
    const graph = {
      schemaVersion: 2 as const,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 3, maxRepeatCount: 2 },
      nodes: [
        { key: "start", nodeId: "node_start", type: "start" as const, label: "Start" },
        {
          key: "develop",
          nodeId: "node_develop",
          type: "agent_action" as const,
          label: "Develop",
          executionTarget: "local" as const,
          promptTemplate: "Repository-owned execution prompt",
        },
        { key: "end", nodeId: "node_end", type: "end" as const, label: "End" },
      ],
      edges: [
        { id: "start-develop", source: "start", target: "develop", kind: "normal" as const, outcome: "success" as const },
        { id: "develop-end", source: "develop", target: "end", kind: "normal" as const, outcome: "success" as const },
      ],
      routingMetadata: {
        node_develop: { responsibility: "Implement the approved requirement and produce test evidence." },
      },
    };

    expect(loopGraphSchema.safeParse(graph).success).toBe(false);
    expect(loopGraphV2Schema.parse(graph).routingMetadata.node_develop).toEqual({
      responsibility: "Implement the approved requirement and produce test evidence.",
    });
    expect(loopGraphV2Schema.safeParse({ ...graph, routingMetadata: {} }).success).toBe(true);
  });

  it("normalizes published V2 authoring graphs for execution without a version gate", () => {
    const graph = {
      schemaVersion: 2 as const,
      inputSchema: {},
      outputSchema: {},
      limits: { maxStages: 1, maxRepeatCount: 1 },
      nodes: [{
        key: "work",
        label: "Work",
        type: "agent_action" as const,
        executionTarget: "local" as const,
        promptTemplate: "Work",
      }],
      edges: [],
      routingMetadata: {
        work: { responsibility: "Implement the approved requirement." },
      },
    };

    const { routingMetadata: _routingMetadata, ...executionGraph } = graph;
    expect(parsePublishedLoopGraph(graph)).toEqual(loopGraphSchema.parse({
      ...executionGraph,
      schemaVersion: 1,
    }));
    const legacyGraph = loopGraphSchema.parse({
      ...executionGraph,
      schemaVersion: 1,
    });
    expect(parsePublishedLoopGraph(legacyGraph)).toEqual(legacyGraph);
  });

  it("validates a local route decision against immutable candidates and contract digests", () => {
    const snapshotDigest = `sha256:${"a".repeat(64)}` as const;
    const routerContractDigest = `sha256:${"b".repeat(64)}` as const;
    const decision = localRouteDecisionSchema.parse({
      decisionId: "route_decision_1",
      fromNodeId: "test",
      nextNodeId: "develop",
      reasonCode: "TEST_FAILED_REQUIRES_CODE_FIX",
      summary: "The failure requires a code change.",
      evidence: ["artifacts/test/report.json"],
      confidence: 0.91,
      snapshotDigest,
      routerContractVersion: 1,
      routerContractDigest,
    });

    expect(validateLocalRouteDecision({
      decision,
      fromNodeId: "test",
      allowedRouteTargets: ["develop", "human_review"],
      snapshotDigest,
      routerContractVersion: 1,
      routerContractDigest,
    }).nextNodeId).toBe("develop");
    expect(() => validateLocalRouteDecision({
      decision: { ...decision, nextNodeId: "code_dev_b" },
      fromNodeId: "test",
      allowedRouteTargets: ["develop", "human_review"],
      snapshotDigest,
      routerContractVersion: 1,
      routerContractDigest,
    })).toThrowError(/allowed route targets/iu);
  });

  it("rejects project-owned prompts and schemas from frozen snapshots", () => {
    const platformGraph = {
      schemaVersion: 1,
      limits: { maxStages: 3, maxRepeatCount: 1 },
      nodes: [
        { key: "start", nodeId: "node_start", type: "start", label: "Start" },
        {
          key: "work",
          nodeId: "node_work",
          type: "agent_action",
          label: "Work",
          executionTarget: "local",
        },
        { key: "end", nodeId: "node_end", type: "end", label: "End" },
      ],
      edges: [
        { id: "edge_start_work", source: "start", target: "work", kind: "normal", outcome: "success" },
        { id: "edge_work_end", source: "work", target: "end", kind: "normal", outcome: "success" },
      ],
    };
    const snapshotWithGraph = (graph: unknown) => ({
      snapshotId: "snapshot_unsafe",
      graphDigest: `sha256:${"b".repeat(64)}`,
      rootLoopVersionId: "loop_version_project_1",
      loopVersions: [{
        loopDefinitionId: "loop_project",
        loopVersionId: "loop_version_project_1",
        scope: "project",
        graph,
      }],
      reachableNodeIds: ["node_start", "node_work", "node_end"],
    });
    const withWorkNodeContent = (content: Record<string, unknown>) => ({
      ...platformGraph,
      nodes: platformGraph.nodes.map((node) => node.key === "work" ? { ...node, ...content } : node),
    });
    const prohibitedGraphs = [
      ["graph schemas", {
        ...platformGraph,
        inputSchema: { type: "object", properties: { secret: { type: "string" } } },
        outputSchema: { type: "object" },
      }],
      ["prompt", withWorkNodeContent({ promptTemplate: "Read project-owned instructions" })],
      ["skills", withWorkNodeContent({ skills: ["project-review"] })],
      ["command", withWorkNodeContent({ command: "pnpm test" })],
      ["rules", withWorkNodeContent({ rules: "Follow project-only rules" })],
    ] as const;

    for (const [label, graph] of prohibitedGraphs) {
      expect(runGraphSnapshotSchema.safeParse(snapshotWithGraph(graph)).success, label).toBe(false);
    }
  });

  it("parses a no-human sequential graph", () => {
    const graph = loopGraphSchema.parse({
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 8, maxRepeatCount: 2 },
      nodes: [
        { key: "start", type: "start", label: "Start" },
        {
          key: "work",
          type: "agent_action",
          label: "Work",
          executionTarget: "local",
          promptTemplate: "Do work",
          requiredCapabilities: ["codex"],
        },
        { key: "end", type: "end", label: "End" },
      ],
      edges: [
        { id: "e1", source: "start", target: "work", kind: "normal", outcome: "success" },
        { id: "e2", source: "work", target: "end", kind: "normal", outcome: "success" },
      ],
    });

    expect(graph.nodes.some((node) => node.type === "human_gate")).toBe(false);
  });

  it("allows requirement interactions on Agent actions", () => {
    const result = loopNodeDefinitionSchema.parse({
      key: "clarify",
      type: "agent_action",
      label: "Clarify requirements",
      executionTarget: "local",
      promptTemplate: "Clarify uncertainty through HumanThread MCP.",
      interactionPolicy: {
        kind: "requirement_conversation",
        replyRoles: ["task_collaborator", "task_assignee"],
        confirmRoles: ["task_assignee", "task_creator", "project_admin"],
        structuredFields: [],
      },
    });

    expect(result).toMatchObject({ interactionPolicy: { kind: "requirement_conversation" } });
  });

  it("rejects interaction policy on control nodes", () => {
    expect(loopNodeDefinitionSchema.safeParse({
      key: "start",
      type: "start",
      label: "Start",
      interactionPolicy: {
        kind: "requirement_conversation",
        replyRoles: ["task_collaborator"],
        confirmRoles: ["task_assignee"],
        structuredFields: [],
      },
    }).success).toBe(false);
  });

  it("rejects a feedback edge without maxTraversals", () => {
    const result = loopEdgeDefinitionSchema.safeParse({
      id: "feedback_review_to_work",
      source: "review",
      target: "work",
      kind: "feedback",
      outcome: "rework",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["maxTraversals"], message: "Feedback edge requires maxTraversals" }),
    ]));
  });

  it.each([
    ["agent_action", "platform", { promptTemplate: "Do work" }],
    ["platform_action", "local", {}],
    ["condition", "local", {}],
    ["policy_gate", "local", {}],
    ["human_gate", "local", {}],
    ["wait_callback", "local", {}],
  ])("rejects %s with forbidden execution target %s", (type, executionTarget, details) => {
    const result = loopNodeDefinitionSchema.safeParse({
      key: "node",
      type,
      label: "Node",
      executionTarget,
      ...details,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a graph with zero maxRepeatCount", () => {
    const result = loopGraphSchema.safeParse({
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 1, maxRepeatCount: 0 },
      nodes: [{ key: "start", type: "start", label: "Start" }],
      edges: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts bounded retry policies on graph and node contracts", () => {
    expect(loopRetryPolicySchema.parse({ maxRetries: 0 })).toEqual({ maxRetries: 0 });
    expect(loopRetryPolicySchema.parse({ maxRetries: 2 })).toEqual({ maxRetries: 2 });
    expect(loopRetryPolicySchema.safeParse({ maxRetries: 21 }).success).toBe(false);
    expect(loopRetryPolicySchema.safeParse({
      maxRetries: 2,
      initialDelayMs: 10_000,
      maxDelayMs: 1_000,
    }).success).toBe(false);
    expect(failureCategorySchema.parse("dependency_unavailable")).toBe("dependency_unavailable");

    const graph = loopGraphSchema.parse({
      schemaVersion: 1,
      inputSchema: {},
      outputSchema: {},
      retryPolicy: { maxRetries: 2 },
      limits: { maxStages: 1, maxRepeatCount: 1 },
      nodes: [{ key: "start", type: "start", label: "Start", retryPolicy: { maxRetries: 0 } }],
      edges: [],
    });

    expect(graph.retryPolicy).toEqual({ maxRetries: 2 });
    expect(graph.nodes[0]).toMatchObject({ retryPolicy: { maxRetries: 0 } });

    expect(loopGraphV2Schema.parse({
      ...graph,
      schemaVersion: 2,
      routingMetadata: {},
    }).retryPolicy).toEqual({ maxRetries: 2 });
  });
});

describe("automation grant contracts", () => {
  it("parses a normalized workspace grant and action with every scope dimension explicit", () => {
    expect(automationGrantSchema.parse(automationGrant)).toEqual(automationGrant);
    expect(automationActionSchema.parse({
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
      workspaceBindingId: "workspace_binding_1",
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
    })).toMatchObject({ workspaceAccess: "write", workspaceContained: true });
  });

  it("canonicalizes grant allowlists for stable confirmation fingerprints", () => {
    expect(automationGrantSchema.parse({
      ...automationGrant,
      tools: ["shell", "filesystem", "shell"],
      commandCategories: ["test", "build", "test"],
    })).toMatchObject({
      tools: ["filesystem", "shell"],
      commandCategories: ["build", "test"],
    });
  });

  it.each([
    ["missing network allowlist", (({ networkTargets: _omitted, ...grant }) => grant)(automationGrant)],
    ["unknown grant field", { ...automationGrant, unrestricted: true }],
    ["workspace permission without a binding", { ...automationGrant, workspaceBindingIds: [] }],
    ["absolute workspace prefix", { ...automationGrant, allowedRelativePathPrefixes: ["/work/project"] }],
    ["workspace-free permission with a binding", {
      ...automationGrant,
      permission: "none",
      workspaceBindingIds: ["workspace_binding_1"],
      allowedRelativePathPrefixes: [],
    }],
    ["expiry before confirmation", { ...automationGrant, expiresAt: "2026-07-30T11:59:59.000Z" }],
  ])("rejects a non-normalized grant with %s", (_label, value) => {
    expect(automationGrantSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a claimed relative path that still contains traversal segments", () => {
    expect(automationActionSchema.safeParse({
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
      workspaceBindingId: "workspace_binding_1",
      relativePath: "../other/secrets.txt",
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
    }).success).toBe(false);
  });
});

describe("loop runtime contracts", () => {
  const graph = {
    schemaVersion: 1 as const,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    limits: { maxStages: 3, maxRepeatCount: 2 },
    nodes: [
      { key: "start", type: "start" as const, label: "Start" },
      {
        key: "work",
        type: "agent_action" as const,
        label: "Work",
        executionTarget: "local" as const,
        promptTemplate: "Do work",
      },
      { key: "end", type: "end" as const, label: "End" },
    ],
    edges: [
      { id: "start-work", source: "start", target: "work", kind: "normal" as const, outcome: "success" as const },
      { id: "work-end", source: "work", target: "end", kind: "normal" as const, outcome: "success" as const },
    ],
  };
  const event = {
    eventId: "event_1",
    loopRunId: "loop_run_1",
    loopNodeRunId: "node_run_1",
    loopNodeAttemptId: "attempt_1",
    attemptNo: 1,
    leaseGeneration: 2,
    sequence: 1,
    eventType: "loop.node.progressed",
    occurredAt: "2026-07-29T08:00:00.000Z",
    payloadSummary: { phase: "working" },
    artifactRefs: ["artifacts/report.md"],
  };
  const assignment = (resultSchemaPath = "results/output.json") => ({
    id: "assignment_1",
    agentRunId: "agent_run_1",
    loopRunId: "loop_run_1",
    loopNodeRunId: "node_run_1",
    loopNodeAttemptId: "attempt_1",
    attemptNo: 1,
    leaseGeneration: 2,
    leaseExpiresAt: "2026-07-29T08:10:00.000Z",
    acceptedThroughSequence: 0,
    node: graph.nodes[1],
    graph,
    inputSnapshot: { task: "implement" },
    policySnapshot: {},
    grantSnapshot: {},
    runtime: {
      agentProfileId: "profile_codex",
      provider: "codex",
      runtimeProfileId: "runtime_codex_device_1",
      configurationVersion: 2,
    },
    workspace: {
      bindingId: "workspace_binding_1",
      configurationVersion: 2,
      pathFingerprint: "hmac-sha256:abc123",
    },
    prompt: "Do work",
    resultSchemaPath,
    checkpointSnapshot: { phase: "working" },
  });

  it("parses strict assignment, event batch, and result envelopes", () => {
    expect(loopAssignmentSchema.parse(assignment())).toMatchObject({
      attemptNo: 1,
      acceptedThroughSequence: 0,
      checkpointSnapshot: { phase: "working" },
    });
    expect(loopAgentEventBatchSchema.parse({
      agentRunId: "agent_run_1",
      workerId: "worker_1",
      leaseGeneration: 2,
      events: [event],
    }).events).toHaveLength(1);
    expect(loopNodeResultSchema.parse({
      outcome: "success",
      output: { done: true },
      artifactRefs: [],
      effectReceipts: [],
    })).toEqual(expect.objectContaining({ outcome: "success" }));
  });

  it("parses a structured failure envelope and rejects empty evidence references", () => {
    const failure = {
      status: "FAILED" as const,
      code: "MOBILE_SOURCE_UNAVAILABLE",
      categoryHint: "dependency_unavailable" as const,
      summary: "No mobile checkout is configured",
      evidence: [{ kind: "environment" as const, reference: `environment/${"b".repeat(32)}`, digest: "a".repeat(64) }],
      retryHint: { recommended: false, reason: "Source does not exist" },
      occurredAt: "2026-08-15T08:00:00.000Z",
    };

    expect(loopFailureEnvelopeSchema.parse(failure)).toEqual(failure);
    expect(loopNodeResultSchema.parse({
      outcome: "failure",
      output: { status: "FAILED" },
      artifactRefs: [],
      effectReceipts: [],
      failure,
    })).toMatchObject({ failure: { code: "MOBILE_SOURCE_UNAVAILABLE" } });
    expect(loopNodeResultSchema.parse({
      outcome: "failure",
      output: { status: "FAILED" },
      artifactRefs: [],
      effectReceipts: [],
    })).not.toHaveProperty("failure");
    expect(loopFailureEnvelopeSchema.safeParse({ ...failure, evidence: [{ kind: "environment", reference: "" }] }).success).toBe(false);
    expect(loopFailureEnvelopeSchema.safeParse({
      ...failure,
      evidence: [{ kind: "log", reference: "password=supersecret" }],
    }).success).toBe(false);
    expect(loopFailureEnvelopeSchema.safeParse({
      ...failure,
      evidence: [{ kind: "log", reference: "ERROR: token abc123" }],
    }).success).toBe(false);
    for (const reference of [
      "logs/AKIAIOSFODNN7EXAMPLE",
      "logs/ghp_abcdefghijklmnopqrstuvwxyz123456",
      "logs/eyJhbGciOiJIUzI1NiJ9.payload.signature",
    ]) {
      expect(loopFailureEnvelopeSchema.safeParse({
        ...failure,
        evidence: [{ kind: "log", reference }],
      }).success).toBe(false);
    }
    expect(loopFailureEnvelopeSchema.safeParse({
      ...failure,
      evidence: [{ kind: "environment", reference: `logs/${"b".repeat(32)}` }],
    }).success).toBe(false);
    expect(loopNodeResultSchema.safeParse({
      outcome: "success",
      output: { done: true },
      artifactRefs: [],
      effectReceipts: [],
      failure,
    }).success).toBe(false);
  });

  it("accepts an optional bounded Stage reference while preserving legacy assignments", () => {
    expect(loopAssignmentSchema.parse(assignment())).not.toHaveProperty("stageRef");

    expect(loopAssignmentSchema.parse({
      ...assignment(),
      stageRef: {
        loopDefinitionId: "l".repeat(96),
        loopVersionId: "v".repeat(96),
        nodeId: "n".repeat(96),
        subloopId: "s".repeat(96),
      },
    })).toMatchObject({
      stageRef: {
        loopDefinitionId: "l".repeat(96),
        loopVersionId: "v".repeat(96),
        nodeId: "n".repeat(96),
        subloopId: "s".repeat(96),
      },
    });
  });

  it("carries an execution ticket only when a Loop attempt has a LiveSession", () => {
    expect(loopAssignmentSchema.parse({
      ...assignment(),
      liveSession: {
        sessionId: "f".repeat(32),
        relayUrl: "ws://localhost:3000/live-session/execution",
        authorization: "lst1.payload.signature",
        initialCols: 120,
        initialRows: 36,
      },
    })).toMatchObject({ liveSession: { sessionId: "f".repeat(32) } });
    expect(loopAssignmentSchema.safeParse({
      ...assignment(),
      liveSession: { sessionId: "tui:run_1" },
    }).success).toBe(false);
  });

  it.each(["loopDefinitionId", "loopVersionId", "nodeId", "subloopId"] as const)(
    "rejects an overlong Stage reference %s",
    (field) => {
      expect(loopAssignmentSchema.safeParse({
        ...assignment(),
        stageRef: {
          loopDefinitionId: "loop_definition_1",
          loopVersionId: "loop_version_1",
          nodeId: "develop",
          subloopId: "develop",
          [field]: "x".repeat(97),
        },
      }).success).toBe(false);
    },
  );

  it("parses a v2 assignment with an immutable routing snapshot", () => {
    const platformGraph = platformLoopGraphV2Schema.parse({
      schemaVersion: 2,
      limits: { maxStages: 2, maxRepeatCount: 1 },
      nodes: [
        { key: "start", nodeId: "start", label: "Start", type: "start" },
        {
          key: "work",
          nodeId: "work",
          label: "Work",
          type: "agent_action",
          executionTarget: "local",
          responsibility: "Complete the repository-owned stage contract.",
          allowedRouteTargets: ["end"],
        },
        { key: "end", nodeId: "end", label: "End", type: "end" },
      ],
      edges: [{ id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" }],
    });
    const snapshot = runGraphSnapshotV2Schema.parse({
      schemaVersion: 2,
      snapshotId: "snapshot_v2",
      graphDigest: `sha256:${"c".repeat(64)}`,
      rootLoopVersionId: "loop_version_project_2",
      loopVersions: [{
        loopDefinitionId: "loop_project",
        loopVersionId: "loop_version_project_2",
        scope: "project",
        graph: platformGraph,
      }],
      reachableNodeIds: ["start", "work", "end"],
    });
    const parsed = loopAssignmentV2Schema.parse({
      ...assignment(),
      contractVersion: 2,
      runGraphSnapshot: snapshot,
      routerContract: { version: 1, digest: `sha256:${"d".repeat(64)}` },
      offlineContinuation: null,
    });

    expect(parsed.contractVersion).toBe(2);
    expect(parsed.runGraphSnapshot.graphDigest).toBe(snapshot.graphDigest);
    expect(loopAssignmentSchema.safeParse(parsed).success).toBe(false);
  });

  it("parses a decision-capable assignment backed by an immutable v1 snapshot", () => {
    const snapshot = runGraphSnapshotSchema.parse({
      snapshotId: "snapshot_v1",
      graphDigest: `sha256:${"c".repeat(64)}`,
      rootLoopVersionId: "loop_version_project_1",
      loopVersions: [{
        loopDefinitionId: "loop_project",
        loopVersionId: "loop_version_project_1",
        scope: "project",
        graph: {
          schemaVersion: 1,
          limits: { maxStages: 3, maxRepeatCount: 2 },
          nodes: [
            { key: "business_test", nodeId: "business_test", label: "Business test", type: "agent_action", executionTarget: "local" },
            { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local" },
            { key: "end", nodeId: "end", label: "End", type: "end" },
          ],
          edges: [
            { id: "business-test-end", source: "business_test", target: "end", kind: "normal", outcome: "success" },
            { id: "develop-business-test", source: "develop", target: "business_test", kind: "normal", outcome: "success" },
          ],
        },
      }],
      reachableNodeIds: ["business_test", "develop", "end"],
    });

    const parsed = loopAssignmentV2Schema.parse({
      ...assignment(),
      stageRef: {
        loopDefinitionId: "loop_project",
        loopVersionId: "loop_version_project_1",
        nodeId: "work",
        subloopId: "work",
      },
      contractVersion: 2,
      runGraphSnapshot: snapshot,
      routerContract: { version: 1, digest: `sha256:${"d".repeat(64)}` },
      offlineContinuation: null,
    });

    expect(parsed.contractVersion).toBe(2);
    expect(parsed.runGraphSnapshot).not.toHaveProperty("schemaVersion");
    expect(parsed.runGraphSnapshot.graphDigest).toBe(snapshot.graphDigest);
  });

  it("keeps absolute paths out of assignments and exposes configuration waiting", () => {
    const parsed = loopAssignmentSchema.parse(assignment());
    expect(parsed.workspace).toEqual({
      bindingId: "workspace_binding_1",
      configurationVersion: 2,
      pathFingerprint: "hmac-sha256:abc123",
    });
    expect(parsed.runtime).toEqual({
      agentProfileId: "profile_codex",
      provider: "codex",
      runtimeProfileId: "runtime_codex_device_1",
      configurationVersion: 2,
    });
    expect(loopAssignmentSchema.safeParse({
      ...assignment(),
      workspace: { rootPath: "/Users/alice/Atlas" },
    }).success).toBe(false);
    expect(loopNodeRunStatusSchema.parse("waiting_configuration")).toBe("waiting_configuration");
    expect(loopConfigurationWaitingReasonSchema.parse("repository_credential_unverified"))
      .toBe("repository_credential_unverified");
  });

  it("accepts child-loop waiting without requiring it from legacy payloads", () => {
    expect(loopPlatformWaitSchema.parse({})).toEqual({});
    expect(loopPlatformWaitSchema.parse({ waitingReason: "child_loop" })).toEqual({
      waitingReason: "child_loop",
    });
  });

  it.each(["../secrets.json", "results//output.json", "C:/temp/output.json"])(
    "rejects unsafe relative result schema path %s",
    (resultSchemaPath) => {
      expect(loopAssignmentSchema.safeParse(assignment(resultSchemaPath)).success).toBe(false);
    },
  );

  it.each([
    ["non-positive attempt", { ...event, attemptNo: 0 }],
    ["non-positive lease", { ...event, leaseGeneration: 0 }],
    ["non-positive sequence", { ...event, sequence: 0 }],
    ["invalid timestamp", { ...event, occurredAt: "29 July 2026" }],
    ["unbounded event id", { ...event, eventId: "e".repeat(129) }],
    ["unknown field", { ...event, callerTransition: "edge_forged" }],
  ])("rejects a malformed event envelope with %s", (_name, value) => {
    expect(loopAgentEventSchema.safeParse(value).success).toBe(false);
  });

  it("rejects malformed or extended batch and result envelopes", () => {
    expect(loopAgentEventBatchSchema.safeParse({
      agentRunId: "agent_run_1",
      workerId: "worker_1",
      leaseGeneration: 0,
      events: [event],
      transition: { selectedEdgeId: "edge_forged" },
    }).success).toBe(false);
    expect(loopAgentEventBatchSchema.safeParse({
      agentRunId: "agent_run_1",
      workerId: "worker_1",
      leaseGeneration: 3,
      events: [event],
    }).success).toBe(false);
    expect(loopNodeResultSchema.safeParse({
      outcome: "success",
      output: { done: true },
      artifactRefs: [],
      effectReceipts: [],
      transitionCount: -1,
    }).success).toBe(false);
  });

  it("validates runtime-generated checklist payloads and lease identity", () => {
    const binding = {
      loopRunId: "run_1",
      loopNodeRunId: "node_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      leaseGeneration: 2,
    };
    expect(loopChecklistCreatedPayloadSchema.safeParse({
      ...binding,
      checklist: [{ id: "inspect", title: "Inspect the repository", status: "not_started", evidenceRefs: [] }],
    }).success).toBe(true);
    expect(loopChecklistCreatedPayloadSchema.safeParse({
      ...binding,
      checklist: [
        { id: "inspect", title: "Inspect", status: "not_started", evidenceRefs: [] },
        { id: "inspect", title: "Duplicate", status: "not_started", evidenceRefs: [] },
      ],
    }).success).toBe(false);
    expect(loopChecklistUpdatedPayloadSchema.safeParse({
      ...binding,
      itemId: "inspect",
      status: "failed",
      evidenceRefs: [],
    }).success).toBe(false);
    expect(loopAgentEventSchema.safeParse({
      ...event,
      eventType: "loop.checklist.updated",
      payloadSummary: { ...binding, itemId: "inspect", status: "succeeded", evidenceRefs: [] },
    }).success).toBe(true);
  });

  it("enforces checklist state transitions and node closure", () => {
    expect(isValidLoopChecklistTransition("not_started", "in_progress")).toBe(true);
    expect(isValidLoopChecklistTransition("not_started", "failed")).toBe(true);
    expect(isValidLoopChecklistTransition("succeeded", "in_progress")).toBe(false);
    expect(() => validateLoopChecklistTransition("succeeded", "failed")).toThrow(/Invalid checklist status transition/);
    expect(evaluateLoopChecklistClosure([])).toMatchObject({ closed: false, reason: "missing_checklist" });
    expect(evaluateLoopChecklistClosure([
      { id: "a", title: "A", status: "in_progress", evidenceRefs: [] },
    ])).toMatchObject({ closed: false, reason: "items_incomplete", incompleteItemIds: ["a"] });
    expect(evaluateLoopChecklistClosure([
      { id: "a", title: "A", status: "succeeded", evidenceRefs: [] },
      { id: "b", title: "B", status: "skipped", reason: "Not applicable", evidenceRefs: [] },
    ])).toEqual({ closed: true, incompleteItemIds: [] });
  });

  it("strictly parses persisted transition counters and effective budgets", () => {
    expect(loopTransitionCountersSchema.parse({
      transitions: 2,
      repeats: 1,
      edgeTraversals: { feedback: 1, next: 1 },
    })).toEqual({ transitions: 2, repeats: 1, edgeTraversals: { feedback: 1, next: 1 } });
    expect(loopRuntimeBudgetSchema.parse({
      maxStages: 4,
      maxRepeatCount: 2,
      maxTransitions: 8,
    })).toEqual({ maxStages: 4, maxRepeatCount: 2, maxTransitions: 8 });

    expect(loopTransitionCountersSchema.safeParse({
      transitions: -1,
      repeats: 0,
      edgeTraversals: {},
    }).success).toBe(false);
    expect(loopRuntimeBudgetSchema.safeParse({
      maxRepeatCount: 2,
      maxTransitions: 8,
      callerCeiling: 10_000,
    }).success).toBe(false);
  });
});
