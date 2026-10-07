import type { LoopAuthoringGraph, LoopEdgeDefinition } from "@humanthread/shared";

export type HumanGateRoutes = {
  pass: string[];
  rework: string[];
  reject: string[];
};

export function deriveHumanGateRoutes(graph: LoopAuthoringGraph, nodeKey: string): HumanGateRoutes {
  const outgoing = graph.edges.filter((edge) => edge.source === nodeKey);
  const routes: HumanGateRoutes = {
    pass: routeIds(outgoing, "pass"),
    rework: routeIds(outgoing, "rework"),
    reject: routeIds(outgoing, "reject"),
  };
  if (routes.pass.length > 0) return routes;

  const legacy = outgoing.filter((edge) => edge.outcome === "success");
  if (legacy.length > 1) {
    throw validationError("Human Gate requires one unique success edge for legacy pass routing");
  }
  return { ...routes, pass: legacy.map((edge) => edge.id) };
}

export function selectHumanGateDecisionEdge(
  graph: LoopAuthoringGraph,
  nodeKey: string,
  outcome: keyof HumanGateRoutes,
  selectedEdgeId: string,
): LoopEdgeDefinition {
  const routes = deriveHumanGateRoutes(graph, nodeKey);
  if (!routes[outcome].includes(selectedEdgeId)) {
    throw validationError("Human Gate selectedEdgeId is not valid for the requested outcome");
  }
  const edge = graph.edges.find((candidate) => candidate.source === nodeKey && candidate.id === selectedEdgeId);
  if (!edge) throw validationError("Human Gate selectedEdgeId does not belong to the node");
  return edge;
}

function routeIds(edges: LoopEdgeDefinition[], outcome: keyof HumanGateRoutes): string[] {
  return edges.filter((edge) => edge.outcome === outcome).map((edge) => edge.id);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
