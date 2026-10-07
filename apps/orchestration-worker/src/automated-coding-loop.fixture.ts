import type {
  AutomationAction,
  AutomationGrantSnapshot,
  GateDecision,
  LoopGraph,
  LoopNodeDefinition,
  TransitionCounters,
} from "@humanthread/orchestration-core";
import type { ActivateLoopNodeInput } from "@humanthread/db";
import {
  applyTransitionBudget,
  evaluateAutomationGrant,
  selectNextEdge,
  transitionLoopNode,
  validateLoopGraph,
} from "@humanthread/orchestration-core";
import { dispatchReadyNode } from "./loop-dispatcher";
import { scheduleReadyLoopNodes } from "./loop-scheduler";

export interface AutomatedCodingLoopResult {
  run: {
    status: "completed" | "exhausted";
    repeatCount: number;
    stopReason: string | null;
  };
  approvals: unknown[];
  actions: Array<{
    workspaceBindingId: string;
    relativePath: string;
    workspaceContained: true;
  }>;
  nodeActivations: Array<{ nodeKey: string; activationNo: number }>;
}

const now = new Date("2026-07-31T04:00:00.000Z");
const spaceId = "space_1";
const projectId = "project_1";
const bindingId = "binding_1";
const workspaceBindingId = "workspace_1";

export const codingGraph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 5, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    {
      key: "code",
      label: "Implement change",
      type: "agent_action",
      executionTarget: "local",
      promptTemplate: "Implement the requested change inside the bound Workspace.",
    },
    {
      key: "tests",
      label: "Run tests",
      type: "agent_action",
      executionTarget: "local",
      promptTemplate: "Run the configured test suite inside the bound Workspace.",
    },
    {
      key: "policy",
      label: "Policy gate",
      type: "policy_gate",
      executionTarget: "platform",
      policy: { name: "coding-quality" },
    },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-code", source: "start", target: "code", kind: "normal", outcome: "success" },
    { id: "code-tests", source: "code", target: "tests", kind: "normal", outcome: "success" },
    { id: "tests-policy", source: "tests", target: "policy", kind: "normal", outcome: "success" },
    { id: "policy-end", source: "policy", target: "end", kind: "normal", outcome: "pass" },
    {
      id: "policy-code",
      source: "policy",
      target: "code",
      kind: "feedback",
      outcome: "rework",
      maxTraversals: 2,
    },
  ],
} satisfies LoopGraph;

export const workspaceFullGrant = {
  id: "grant_workspace_full",
  spaceId,
  projectId,
  bindingIds: [bindingId],
  nodeKeys: ["code", "tests"],
  executionPlanes: ["local"],
  deviceIds: ["device_1"],
  workerIds: ["local-worker:device_1"],
  agentProfileIds: ["profile_codex"],
  providers: ["codex"],
  permission: "workspace_full",
  workspaceBindingIds: [workspaceBindingId],
  allowedRelativePathPrefixes: ["."],
  tools: ["filesystem", "shell"],
  commandCategories: ["test"],
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
  confirmedAt: "2026-07-31T03:00:00.000Z",
  expiresAt: "2026-08-01T03:00:00.000Z",
  revokedAt: null,
} satisfies AutomationGrantSnapshot;

type NodeStatus = "ready" | "running" | "succeeded" | "waiting_approval";

interface MemoryNodeActivation {
  id: string;
  nodeKey: string;
  activationNo: number;
  status: NodeStatus;
  version: number;
  attemptCount: number;
  inputSnapshot: unknown;
}

export async function runAutomatedCodingLoop(input: {
  graph: LoopGraph;
  grants: AutomationGrantSnapshot[];
  gateOutcomes: GateDecision["outcome"][];
}): Promise<AutomatedCodingLoopResult> {
  const validation = validateLoopGraph(input.graph);
  if (!validation.ok) throw new Error(`Invalid coding graph: ${validation.errors.join("; ")}`);
  const maxTransitions = validation.maxTransitions;

  const approvals: unknown[] = [];
  const actions: AutomationAction[] = [];
  const nodeActivations: MemoryNodeActivation[] = [];
  const executionQueue: Array<{ nodeRunId: string }> = [];
  const gateOutcomes = [...input.gateOutcomes];
  const run = {
    id: "loop_run_1",
    status: "running" as "running" | "waiting" | "completed" | "exhausted",
    repeatCount: 0,
    stopReason: null as string | null,
  };
  let counters: TransitionCounters = { transitions: 0, repeats: 0, edgeTraversals: {} };

  function nodeDefinition(nodeKey: string): LoopNodeDefinition {
    const node = input.graph.nodes.find((candidate) => candidate.key === nodeKey);
    if (!node) throw new Error(`Unknown node: ${nodeKey}`);
    return node;
  }

  function activateNode(nodeKey: string, inputSnapshot: unknown): MemoryNodeActivation {
    const activationNo = nodeActivations.filter((node) => node.nodeKey === nodeKey).length + 1;
    const activation = {
      id: `node_run:${nodeKey}:${activationNo}`,
      nodeKey,
      activationNo,
      status: "ready" as const,
      version: 1,
      attemptCount: 0,
      inputSnapshot,
    };
    nodeActivations.push(activation);
    return activation;
  }

  function actionFor(nodeKey: string): AutomationAction {
    const isTest = nodeKey === "tests";
    return {
      requiresUserGrant: true,
      spaceId,
      projectId,
      bindingId,
      nodeKey,
      executionPlane: "local",
      deviceId: "device_1",
      workerId: "local-worker:device_1",
      agentProfileId: "profile_codex",
      provider: "codex",
      workspaceAccess: "write",
      workspaceBindingId,
      relativePath: isTest ? "artifacts/test-results.json" : "src/feature.ts",
      workspaceContained: true,
      tool: isTest ? "shell" : "filesystem",
      commandCategory: isTest ? "test" : null,
      operationType: "workspace.write",
      networkTarget: null,
      recipient: null,
      credentialRef: null,
      production: false,
      usage: { concurrency: 1, durationMs: 30_000, tokens: 1_000, costUsd: 0.1, toolCalls: 10 },
      policyVersion: "policy_v1",
    };
  }

  async function dispatchActivation(
    activation: MemoryNodeActivation,
    assignment: ActivateLoopNodeInput,
  ): Promise<void> {
    const node = nodeDefinition(activation.nodeKey);
    const action = node.type === "agent_action" ? actionFor(node.key) : null;
    const policyDecision = action
      ? evaluateAutomationGrant({
          action,
          grants: input.grants,
          now,
          policyDecision: { outcome: "allow", reasonCode: "platform_policy_allow" },
        })
      : { outcome: "allow" as const, reasonCode: "low_risk_platform_action", matchedGrantId: null };
    if (action) actions.push(action);

    await dispatchReadyNode({
      loopRunId: run.id,
      projectId,
      nodeRunId: activation.id,
      nodeRunVersion: activation.version,
      node,
      policyDecision,
      actionFingerprint: `sha256:${activation.id}`,
      now,
    }, {
      createAssignment: async () => {
        if (activation.status !== "ready" || activation.version !== assignment.nodeRunVersion) {
          throw Object.assign(new Error("stale activation"), { code: "stale_lease" });
        }
        activation.status = "running";
        activation.version += 1;
        activation.attemptCount += 1;
        executionQueue.push({ nodeRunId: activation.id });
      },
      createApproval: async (approval) => {
        approvals.push(approval);
      },
      updateNode: async () => {
        if (activation.status !== "ready") return { count: 0 };
        activation.status = "waiting_approval";
        activation.version += 1;
        return { count: 1 };
      },
      updateRun: async () => {
        run.status = "waiting";
        return { count: 1 };
      },
    });
  }

  function routeSuccess(activation: MemoryNodeActivation, output: unknown): void {
    const edge = selectNextEdge({
      graph: input.graph,
      nodeKey: activation.nodeKey,
      outcome: "success",
      data: output,
    });
    const budget = applyTransitionBudget({
      counters,
      edge,
      limits: {
        maxRepeatCount: input.graph.limits.maxRepeatCount,
        maxTransitions,
      },
    });
    if (!budget.ok) {
      run.status = "exhausted";
      run.stopReason = budget.reason;
      return;
    }
    counters = budget.counters;
    activateNode(edge.target, output);
  }

  activateNode("start", {});
  for (let cycle = 0; cycle < maxTransitions + input.graph.nodes.length; cycle += 1) {
    if (run.status === "completed" || run.status === "exhausted") break;
    await scheduleReadyLoopNodes({
      limit: 10,
      now,
      loadReady: async () => nodeActivations
        .filter((activation) => activation.status === "ready")
        .map((activation) => ({
          loopRunId: run.id,
          projectId,
          nodeRunId: activation.id,
          nodeRunVersion: activation.version,
          nodeKey: activation.nodeKey,
          activationNo: activation.activationNo,
          attemptCount: activation.attemptCount,
          inputSnapshot: activation.inputSnapshot,
          bindingSnapshot: { bindingId },
          agentProfileId: "profile_codex",
          node: nodeDefinition(activation.nodeKey),
        })),
      activate: async () => {
        throw new Error("The E2E fixture dispatches every ready node through policy first");
      },
      dispatch: async (candidate, assignment) => {
        const activation = nodeActivations.find((item) => item.id === candidate.nodeRunId);
        if (!activation) throw new Error(`Unknown activation: ${candidate.nodeRunId}`);
        await dispatchActivation(activation, assignment);
      },
    });

    while (executionQueue.length > 0 && run.status === "running") {
      const execution = executionQueue.shift();
      const activation = nodeActivations.find((item) => item.id === execution?.nodeRunId);
      if (!activation || activation.status !== "running") throw new Error("Invalid execution queue entry");
      activation.status = "succeeded";
      activation.version += 1;
      const node = nodeDefinition(activation.nodeKey);
      if (node.type === "end") {
        run.status = "completed";
      } else if (node.type === "policy_gate") {
        const outcome = gateOutcomes.shift();
        if (outcome !== "pass" && outcome !== "rework") {
          throw new Error("Policy gate outcome must be pass or rework");
        }
        const selectedEdgeId = outcome === "pass" ? "policy-end" : "policy-code";
        const transition = transitionLoopNode({
          graph: input.graph,
          nodeKey: node.key,
          decision: {
            outcome,
            reasonCode: outcome === "pass" ? "tests_passed" : "tests_need_rework",
            message: outcome === "pass" ? "Quality gate passed" : "Quality gate requested rework",
            evidenceRefs: ["artifact:test-results.json"],
            selectedEdgeId,
          },
          counters,
          limits: {
            maxRepeatCount: input.graph.limits.maxRepeatCount,
            maxTransitions,
          },
        });
        if (transition.status === "exhausted") {
          run.status = "exhausted";
          run.stopReason = transition.reason;
        } else {
          counters = transition.counters;
          activateNode(transition.edge.target, { gateOutcome: outcome });
        }
      } else {
        routeSuccess(activation, { completedNode: node.key });
      }
    }
  }

  if (run.status !== "completed" && run.status !== "exhausted") {
    throw new Error(`Automated coding Loop stopped in non-terminal state: ${run.status}`);
  }
  run.repeatCount = counters.repeats;
  const resolvedActions = actions.map((action) => {
    if (action.workspaceBindingId === null || action.relativePath === null || action.workspaceContained !== true) {
      throw new Error("Local coding action must attest a bound Workspace path");
    }
    return {
      workspaceBindingId: action.workspaceBindingId,
      relativePath: action.relativePath,
      workspaceContained: true as const,
    };
  });
  return {
    run: {
      status: run.status,
      repeatCount: run.repeatCount,
      stopReason: run.stopReason,
    },
    approvals,
    actions: resolvedActions,
    nodeActivations: nodeActivations.map(({ nodeKey, activationNo }) => ({ nodeKey, activationNo })),
  };
}
