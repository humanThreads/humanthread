import { OrchestrationValidationError } from "./project";

export type WorkflowEdge = {
  from: string;
  to: string;
  kind: "normal" | "conditional" | "parallel" | "approval" | "compensation";
  when?: "completed" | "failed" | "approved";
};

export function evaluateWorkflowEdges(input: {
  definition: { version: number; edges: WorkflowEdge[] };
  completed: string[];
  failed: string[];
  approvals: string[];
}): { ready: string[]; compensation: string[] } {
  if (input.definition.version < 1) throw new OrchestrationValidationError("workflow version must be positive", "definition", "evaluate");
  const completed = new Set(input.completed);
  const failed = new Set(input.failed);
  const approvals = new Set(input.approvals);
  const compensation = input.definition.edges
    .filter((edge) => edge.kind === "compensation" && failed.has(edge.from))
    .map((edge) => edge.to);
  const executable = input.definition.edges.filter((edge) => edge.kind !== "compensation");
  const ready = new Set<string>();

  for (const edge of executable) {
    const incomingParallel = executable.filter((candidate) => candidate.to === edge.to && candidate.kind === "parallel");
    if (incomingParallel.length > 0) {
      if (incomingParallel.every((candidate) => completed.has(candidate.from))) ready.add(edge.to);
      continue;
    }
    const sourceReady = completed.has(edge.from) || ready.has(edge.from);
    if (!sourceReady) continue;
    if (edge.kind === "approval" && !approvals.has(edge.from)) continue;
    if (edge.kind === "conditional" && edge.when === "failed" && !failed.has(edge.from)) continue;
    ready.add(edge.to);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of executable.filter((candidate) => candidate.kind === "normal")) {
      if (ready.has(edge.from) && !ready.has(edge.to)) {
        ready.add(edge.to);
        changed = true;
      }
    }
  }

  return { ready: [...ready], compensation };
}
