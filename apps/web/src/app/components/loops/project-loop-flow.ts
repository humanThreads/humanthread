import type { LoopAuthoringGraph } from "@humanthread/orchestration-core";

export type ProjectLoopFlowStep = {
  key: string;
  label: string;
  type: string;
  detail: string | null;
  outcomes: string[];
};

export type ProjectLoopGrantScope = {
  nodeKeys: string[];
  executionPlanes: Array<"local" | "platform">;
  providers: string[];
  tools: string[];
  commandCategories: string[];
  operationTypes: string[];
  networkTargets: string[];
  recipients: string[];
  credentialRefs: string[];
};

// Shared projection for every read-only rendering of a published Loop graph.
export function projectLoopGraphToFlow(graph: LoopAuthoringGraph): ProjectLoopFlowStep[] {
  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const outgoing = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const ordered: typeof graph.nodes = [];
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    const node = nodeByKey.get(key);
    if (!node) return;
    visited.add(key);
    ordered.push(node);
    const edges = [...(outgoing.get(key) ?? [])].sort((left, right) => {
      const order = (outcome: string) => outcome === "success" ? 0 : outcome === "pass" ? 1 : outcome === "reject" ? 2 : 3;
      return order(left.outcome) - order(right.outcome);
    });
    for (const edge of edges) visit(edge.target);
  };
  const start = graph.nodes.find((node) => node.type === "start");
  if (start) visit(start.key);
  for (const node of graph.nodes) visit(node.key);
  return ordered.map((node) => {
    const edges = outgoing.get(node.key) ?? [];
    const detail = "promptTemplate" in node && typeof node.promptTemplate === "string"
      ? node.promptTemplate
      : "prompt" in node && typeof node.prompt === "string"
        ? node.prompt
        : "action" in node && typeof node.action === "string" ? node.action : null;
    return { key: node.key, label: node.label, type: node.type, detail, outcomes: edges.map((edge) => edge.outcome).filter((outcome) => outcome !== "success") };
  });
}

export function projectLoopGraphToGrantScope(graph: LoopAuthoringGraph): ProjectLoopGrantScope {
  const executableNodes = graph.nodes.filter((node) => (
    node.type === "agent_action" || node.type === "platform_action"
  ));
  const riskValues = (key: string) => executableNodes.flatMap((node) => {
    const risk = node.riskRequirements;
    if (!risk || typeof risk !== "object" || Array.isArray(risk)) return [];
    const value = Reflect.get(risk, key);
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  });
  const sorted = (values: string[]) => [...new Set(values)].sort();
  return {
    nodeKeys: sorted(executableNodes.map(({ key }) => key)),
    executionPlanes: sorted(executableNodes.map((node) => (
      node.type === "agent_action" ? "local" : "platform"
    ))) as Array<"local" | "platform">,
    providers: sorted(riskValues("provider")),
    tools: sorted(riskValues("tool")),
    commandCategories: sorted(riskValues("commandCategory")),
    operationTypes: sorted([
      ...executableNodes.flatMap((node) => (
        node.type === "platform_action" && node.action ? [node.action] : []
      )),
      ...riskValues("operationType"),
    ]),
    networkTargets: sorted(riskValues("networkTarget")),
    recipients: sorted(riskValues("recipient")),
    credentialRefs: sorted(riskValues("credentialRef")),
  };
}
