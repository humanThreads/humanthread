import {
  loopAuthoringGraphSchema,
  stableNodeId,
  type LoopAuthoringGraph,
  type LoopEdgeDefinition,
} from "@humanthread/shared";
import Ajv, { type AnySchema } from "ajv";
import * as jsonLogic from "json-logic-js";
import { isPlatformActionKey } from "./platform-actions";

export const LOOP_PLATFORM_CAPS = {
  maxStages: 64,
  maxRepeatCount: 20,
  maxTransitions: 1_024,
} as const;

export type LoopGraphValidation =
  | { ok: true; maxTransitions: number }
  | { ok: false; errors: string[] };

export type JsonSchemaValueValidation =
  | { ok: true }
  | { ok: false; errors: string[]; issues: Array<{ code: string; path: Array<string | number>; message: string }> };

export function calculateMaxTransitions(graph: LoopAuthoringGraph): number {
  return Math.min(
    LOOP_PLATFORM_CAPS.maxTransitions,
    graph.nodes.length * (graph.limits.maxRepeatCount + 1),
  );
}

export function validateLoopGraph(graph: LoopAuthoringGraph): LoopGraphValidation {
  const parsed = loopAuthoringGraphSchema.safeParse(graph);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "graph"}: ${issue.message}`),
    };
  }

  const validGraph = parsed.data;
  const errors: string[] = [];
  const nodesByKey = new Map(validGraph.nodes.map((node) => [node.key, node]));
  const nodeKeys = validGraph.nodes.map((node) => node.key);
  const edgeIds = validGraph.edges.map((edge) => edge.id);
  const startNodes = validGraph.nodes.filter((node) => node.type === "start");
  const endNodes = validGraph.nodes.filter((node) => node.type === "end");

  if (new Set(nodeKeys).size !== nodeKeys.length) errors.push("Node keys must be unique");
  if (new Set(edgeIds).size !== edgeIds.length) errors.push("Edge ids must be unique");
  if (validGraph.nodes.length > validGraph.limits.maxStages) errors.push("Graph exceeds its maxStages limit");
  if (startNodes.length !== 1) errors.push("Loop graph must contain exactly one start node");
  if (endNodes.length === 0) errors.push("Loop graph must contain at least one end node");
  if (validGraph.schemaVersion === 2) validateV2RoutingMetadata(validGraph, errors);

  validateJsonSchema(validGraph.inputSchema, "inputSchema", errors);
  validateJsonSchema(validGraph.outputSchema, "outputSchema", errors);
  for (const [index, node] of validGraph.nodes.entries()) {
    validateJsonSchema(node.inputSchema, `nodes.${index}.inputSchema`, errors);
    validateJsonSchema(node.outputSchema, `nodes.${index}.outputSchema`, errors);
  }

  // A platform action without an action key has no executor to run it, so the
  // runtime can only fail after the node has already been dispatched. Reject it
  // while the author can still choose a platform action or a human gate.
  for (const node of validGraph.nodes) {
    if (node.type !== "platform_action") continue;
    const action = "action" in node ? node.action : undefined;
    if (typeof action !== "string" || !action.trim()) {
      errors.push(`Node ${node.key} of type platform_action must declare an action; use a human_gate node for author confirmation`);
    } else if (!isPlatformActionKey(action)) {
      errors.push(`Node ${node.key} references unknown platform action ${action}`);
    }
  }

  for (const edge of validGraph.edges) {
    if (!nodesByKey.has(edge.source) || !nodesByKey.has(edge.target)) {
      errors.push(`Edge ${edge.id} references an unknown node`);
    }
    if (edge.maxTraversals !== undefined && edge.maxTraversals > validGraph.limits.maxRepeatCount) {
      errors.push(`Edge ${edge.id} maxTraversals cannot exceed the graph maxRepeatCount`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const startNode = startNodes[0];
  if (!startNode) return { ok: false, errors: ["Loop graph must contain exactly one start node"] };

  const nonFeedbackEdges = validGraph.edges.filter((edge) => edge.kind !== "feedback");
  const nonFeedbackAdjacency = buildAdjacency(nonFeedbackEdges);
  const reachable = traverse(startNode.key, nonFeedbackAdjacency);
  for (const node of validGraph.nodes) {
    if (!reachable.has(node.key)) errors.push(`Node ${node.key} is unreachable from the start node`);
  }

  const endKeys = new Set(endNodes.map((node) => node.key));
  for (const endNode of endNodes) {
    if (validGraph.edges.some((edge) => edge.source === endNode.key)) errors.push(`End node ${endNode.key} must not have outgoing edges`);
  }

  if (hasCycle(validGraph.nodes.map((node) => node.key), nonFeedbackAdjacency)) {
    errors.push("Graph must be acyclic after feedback edges are removed");
  }

  for (const edge of validGraph.edges.filter((candidate) => candidate.kind === "feedback")) {
    if (!reachable.has(edge.target) || !traverse(edge.target, nonFeedbackAdjacency).has(edge.source)) {
      errors.push(`Feedback edge ${edge.id} must target an ancestor of its source`);
    }
  }

  const reverseAdjacency = buildReverseAdjacency(nonFeedbackEdges);
  const canReachEnd = new Set<string>();
  for (const endKey of endKeys) {
    for (const nodeKey of traverse(endKey, reverseAdjacency)) canReachEnd.add(nodeKey);
  }
  for (const node of validGraph.nodes) {
    if (!canReachEnd.has(node.key)) errors.push(`Node ${node.key} has no terminal path to an end node`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, maxTransitions: calculateMaxTransitions(validGraph) };
}

function validateJsonSchema(schema: unknown, path: string, errors: string[]): void {
  if (schema === undefined) return;
  try {
    new Ajv({ allErrors: true, strict: true }).compile(schema as AnySchema);
  } catch (error) {
    errors.push(`${path}: ${error instanceof Error ? error.message : "Invalid JSON Schema"}`);
  }
}

export function validateJsonSchemaValue(
  schema: unknown,
  value: unknown,
): JsonSchemaValueValidation {
  if (schema === undefined) return { ok: true };
  try {
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema as AnySchema);
    if (validate(value)) return { ok: true };
    return {
      ok: false,
      errors: (validate.errors ?? []).map((error) => (
        `${error.instancePath || "/"}: ${error.message ?? "JSON Schema validation failed"} (${error.keyword})`
      )),
      issues: (validate.errors ?? []).map((error) => ({
        code: error.keyword,
        path: jsonSchemaErrorPath(error),
        message: error.message ?? "JSON Schema validation failed",
      })),
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "Invalid JSON Schema"],
      issues: [{ code: "schema", path: [], message: error instanceof Error ? error.message : "Invalid JSON Schema" }],
    };
  }
}

function jsonSchemaErrorPath(error: { instancePath?: string; keyword: string; params: Record<string, unknown> }): Array<string | number> {
  const path = (error.instancePath ?? "").split("/").filter(Boolean).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") return [...path, error.params.missingProperty];
  if (error.keyword === "additionalProperties" && typeof error.params.additionalProperty === "string") return [...path, error.params.additionalProperty];
  if (typeof error.params.missingProperty === "string") return [...path, error.params.missingProperty];
  return path;
}

export function selectNextEdge(input: {
  graph: LoopAuthoringGraph;
  nodeKey: string;
  outcome: LoopEdgeDefinition["outcome"];
  data: unknown;
}): LoopEdgeDefinition {
  const candidates = input.graph.edges.filter((edge) => edge.source === input.nodeKey && edge.outcome === input.outcome);
  const matches = candidates.filter((edge) => edge.condition === undefined || Boolean(jsonLogic.apply(edge.condition as jsonLogic.RulesLogic, input.data)));
  if (matches.length !== 1) {
    throw Object.assign(new Error("Loop route must resolve exactly one edge"), { code: "validation_failed" });
  }
  return matches[0] as LoopEdgeDefinition;
}

function validateV2RoutingMetadata(
  graph: Extract<LoopAuthoringGraph, { schemaVersion: 2 }>,
  errors: string[],
): void {
  const stableIds = graph.nodes.map(stableNodeId);
  if (new Set(stableIds).size !== stableIds.length) {
    errors.push("Loop graph stable node IDs must be unique");
    return;
  }
  const nodesByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const routableIds = new Set(
    graph.nodes
      .filter((node) => node.type !== "start" && node.type !== "end")
      .map(stableNodeId),
  );
  for (const node of graph.nodes) {
    if (node.type === "start" || node.type === "end") continue;
    const nodeId = stableNodeId(node);
    const responsibility = graph.routingMetadata[nodeId]?.responsibility.trim() ?? "";
    if (!responsibility) errors.push(`Node ${node.key} responsibility is required for v2 publication`);
    const routeTargets = graph.edges
      .filter((edge) => edge.source === node.key)
      .map((edge) => nodesByKey.get(edge.target))
      .filter((target): target is NonNullable<typeof target> => target !== undefined)
      .map(stableNodeId);
    if (routeTargets.length === 0) errors.push(`Node ${node.key} requires at least one route target`);
    if (new Set(routeTargets).size !== routeTargets.length) {
      errors.push(`Node ${node.key} has duplicate route targets`);
    }
  }
  for (const nodeId of Object.keys(graph.routingMetadata)) {
    if (!routableIds.has(nodeId)) errors.push(`Routing metadata references unknown routable node ${nodeId}`);
  }
}

function buildAdjacency(edges: LoopEdgeDefinition[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  return adjacency;
}

function buildReverseAdjacency(edges: LoopEdgeDefinition[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  return adjacency;
}

function traverse(source: string, adjacency: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const pending = [source];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    pending.push(...(adjacency.get(node) ?? []));
  }
  return seen;
}

function hasCycle(nodes: string[], adjacency: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) if (visit(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return nodes.some(visit);
}
