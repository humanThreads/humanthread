import {
  localRouteDecisionSchema,
  validateLocalRouteDecision,
  type LocalRouteDecision,
  type LoopAssignmentV2,
} from "@humanthread/shared";
import type { StageGateResult } from "./quality-gate";
import type { AgentProviderAdapter, NormalizedRunEvent } from "./providers/provider-adapter";
import type { LocalModelExecutionOptions } from "./local-model-routing-runtime";
import type { CodexExecutionPolicy } from "./workspace-policy";
import {
  DECISION_ROUTER_CONTRACT_DIGEST,
  DECISION_ROUTER_CONTRACT_VERSION,
  DECISION_ROUTER_OUTPUT_SCHEMA,
  DECISION_ROUTER_SYSTEM_PROMPT,
} from "./decision-router-contract";

export type RouteHistoryEntry = { fromNodeId: string; nextNodeId: string };

export type RouteCandidate = {
  nodeId: string;
  label: string;
  responsibility: string;
  type: string;
};

export type DecisionRouterInput = {
  assignment: LoopAssignmentV2;
  provider: AgentProviderAdapter;
  stageResult: unknown;
  gateResult: StageGateResult;
  workspaceRealpath: string;
  resultSchemaPath: string;
  executionPolicy: CodexExecutionPolicy;
  routeHistory?: RouteHistoryEntry[];
  now?: Date;
  signal?: AbortSignal;
  providerModelOptions?: LocalModelExecutionOptions | undefined;
};

function routeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function stableNodeId(node: unknown): string {
  if (!node || typeof node !== "object" || Array.isArray(node)) return "";
  const nodeId = Reflect.get(node, "nodeId");
  const key = Reflect.get(node, "key");
  return typeof nodeId === "string" && nodeId ? nodeId : typeof key === "string" ? key : "";
}

function currentNode(input: DecisionRouterInput) {
  const expectedVersionId = input.assignment.stageRef?.loopVersionId;
  const versions = expectedVersionId
    ? input.assignment.runGraphSnapshot.loopVersions.filter((version) => version.loopVersionId === expectedVersionId)
    : input.assignment.runGraphSnapshot.loopVersions;
  if (expectedVersionId && versions.length !== 1) {
    throw routeError("route_unavailable", "Assignment Loop version is not present in the immutable run snapshot");
  }
  for (const version of versions) {
    const found = version.graph.nodes.find((node) => stableNodeId(node) === (input.assignment.node.nodeId ?? input.assignment.node.key));
    if (found) return { node: found, graph: version.graph };
  }
  throw routeError("route_unavailable", "Current node is not present in the immutable run snapshot");
}

function candidatesFor(input: DecisionRouterInput): RouteCandidate[] {
  const { graph } = currentNode(input);
  const candidates: RouteCandidate[] = [];
  for (const candidate of graph.nodes) {
    const nodeId = stableNodeId(candidate);
    const type = String(Reflect.get(candidate, "type") ?? "agent_action");
    if (nodeId && type !== "start") {
      candidates.push({
        nodeId,
        label: String(Reflect.get(candidate, "label") ?? nodeId),
        responsibility: String(Reflect.get(candidate, "responsibility") ?? ""),
        type,
      });
    }
  }
  return candidates;
}

function isHumanReview(candidate: RouteCandidate): boolean {
  return /human[_-]?review|manual|人工/iu.test(`${candidate.nodeId} ${candidate.label} ${candidate.responsibility}`);
}

function compactResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const compact: Record<string, unknown> = {};
  for (const key of ["status", "issueType", "errorCode", "summary", "message", "suggestedRoute", "confidence"] as const) {
    const candidate = Reflect.get(value, key);
    if (typeof candidate === "string") compact[key] = candidate.slice(0, 2_000);
    else if (key === "confidence" && typeof candidate === "number" && Number.isFinite(candidate)) compact[key] = candidate;
  }
  const executions = Reflect.get(value, "executions");
  if (Array.isArray(executions)) {
    const last = executions.at(-1);
    if (last && typeof last === "object" && !Array.isArray(last)) {
      const nested = compactResult(Reflect.get(last, "result"));
      if (Object.keys(nested).length > 0) compact.lastExecution = nested;
    }
  }
  return compact;
}

function readOnlyPolicy(policy: CodexExecutionPolicy): CodexExecutionPolicy {
  return { mode: "read_only", workspaceRealpath: policy.workspaceRealpath };
}

function routerPrompt(input: DecisionRouterInput, candidates: RouteCandidate[]): string {
  const history = (input.routeHistory ?? []).slice(-16);
  return `${DECISION_ROUTER_SYSTEM_PROMPT}\n\n${JSON.stringify({
    fromNodeId: input.assignment.node.nodeId ?? input.assignment.node.key,
    result: {
      ...compactResult(input.stageResult),
      gate: {
        passed: input.gateResult.passed,
        issueType: input.gateResult.issueType.slice(0, 96),
        summary: input.gateResult.summary.slice(0, 2_000),
        evidence: input.gateResult.evidence.slice(0, 20),
      },
    },
    candidates,
    normalFlow: currentNode(input).graph.edges.map(({ source, target, outcome }) => ({ source, target, outcome })),
    routeHistory: history,
    snapshotDigest: input.assignment.runGraphSnapshot.graphDigest,
    routerContractVersion: DECISION_ROUTER_CONTRACT_VERSION,
    routerContractDigest: input.assignment.routerContract.digest,
  })}`;
}

function fallbackDecision(input: DecisionRouterInput, candidate: RouteCandidate, reasonCode: string): LocalRouteDecision {
  return {
    decisionId: `decision:fallback:${input.assignment.loopNodeAttemptId}`,
    fromNodeId: input.assignment.node.nodeId ?? input.assignment.node.key,
    nextNodeId: candidate.nodeId,
    reasonCode,
    summary: "Router 未能安全推导下一节点，转交人工审核",
    evidence: input.gateResult.evidence,
    confidence: 1,
    snapshotDigest: input.assignment.runGraphSnapshot.graphDigest,
    routerContractVersion: DECISION_ROUTER_CONTRACT_VERSION,
    routerContractDigest: input.assignment.routerContract.digest,
  };
}

function uniqueNormalSuccessCandidate(
  input: DecisionRouterInput,
  candidates: RouteCandidate[],
): RouteCandidate | null {
  if (!input.gateResult.passed) return null;
  const fromNodeId = input.assignment.node.nodeId ?? input.assignment.node.key;
  const { node, graph } = currentNode(input);
  const sourceKey = String(Reflect.get(node, "key") ?? fromNodeId);
  const targetIds = [...new Set(graph.edges
    .filter((edge) => (edge.source === sourceKey || edge.source === fromNodeId) && edge.outcome === "success")
    .map((edge) => edge.target))];
  if (targetIds.length !== 1) return null;
  const target = graph.nodes.find((candidate) => (
    Reflect.get(candidate, "key") === targetIds[0] || stableNodeId(candidate) === targetIds[0]
  ));
  if (!target) return null;
  return candidates.find((candidate) => candidate.nodeId === stableNodeId(target)) ?? null;
}

function parseProviderDecision(value: unknown, candidates: RouteCandidate[]): LocalRouteDecision {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nextNodeId = Reflect.get(value, "nextNodeId");
    if (typeof nextNodeId === "string" && !candidates.some((candidate) => candidate.nodeId === nextNodeId)) {
      throw routeError("route_target_not_allowed", "Router target is outside the immutable candidate list");
    }
  }
  return localRouteDecisionSchema.parse(value);
}

async function readDecision(events: AsyncIterable<NormalizedRunEvent>): Promise<unknown> {
  let result: unknown;
  for await (const event of events) {
    if (event.type === "run.completed") result = event.result;
    if (event.type === "run.failed") throw routeError("route_unavailable", event.message);
    if (event.type === "run.cancelled") throw routeError("route_unavailable", "Router execution was cancelled");
  }
  if (result === undefined) throw routeError("route_unavailable", "Router stream ended without a decision");
  return result;
}

export async function decideNextStage(input: DecisionRouterInput): Promise<LocalRouteDecision> {
  if (
    input.assignment.routerContract.version !== DECISION_ROUTER_CONTRACT_VERSION
    || input.assignment.routerContract.digest !== DECISION_ROUTER_CONTRACT_DIGEST
  ) {
    throw routeError("router_contract_mismatch", "Assignment Router contract does not match the built-in DecisionRouter");
  }
  const candidates = candidatesFor(input);
  if (candidates.length === 0) throw routeError("route_unavailable", "Current node has no allowed route candidate");
  const humanReview = candidates.find(isHumanReview);
  try {
    const result = await readDecision(input.provider.executeStructured({
      cwd: input.workspaceRealpath,
      prompt: routerPrompt(input, candidates),
      resultSchemaPath: input.resultSchemaPath,
      executionPolicy: readOnlyPolicy(input.executionPolicy),
      mode: "router",
      ...(input.providerModelOptions ?? {}),
      ...(input.signal ? { signal: input.signal } : {}),
    }));
    const decision = parseProviderDecision(result, candidates);
    const validated = validateLocalRouteDecision({
      decision,
      fromNodeId: input.assignment.node.nodeId ?? input.assignment.node.key,
      allowedRouteTargets: candidates.map(({ nodeId }) => nodeId),
      snapshotDigest: input.assignment.runGraphSnapshot.graphDigest,
      routerContractVersion: input.assignment.routerContract.version,
      routerContractDigest: input.assignment.routerContract.digest,
    });
    return validated;
  } catch (error) {
    if (error && typeof error === "object" && String(Reflect.get(error, "code")) === "route_target_not_allowed") throw error;
    const normalSuccess = input.signal?.aborted ? null : uniqueNormalSuccessCandidate(input, candidates);
    if (normalSuccess) {
      return {
        ...fallbackDecision(input, normalSuccess, "ROUTER_FALLBACK_NORMAL_SUCCESS"),
        summary: "Router 暂时不可用，按当前 Loop 的唯一成功边继续",
      };
    }
    if (!humanReview) throw routeError("route_unavailable", error instanceof Error ? error.message : "Router output was invalid");
    return fallbackDecision(input, humanReview, "ROUTER_FALLBACK_HUMAN_REVIEW");
  }
}

export { DECISION_ROUTER_CONTRACT_DIGEST, DECISION_ROUTER_OUTPUT_SCHEMA };
