export interface ProjectScheduledTaskReportNode {
  nodeKey: string;
  label: string;
  status: string;
  result: unknown;
  error: unknown;
  artifactRefs: string[];
}

export interface ProjectScheduledTaskReport {
  status: string;
  durationMs: number | null;
  completedNodes: number;
  totalNodes: number;
  failures: Array<{ nodeKey: string; label: string; code: string; message: string }>;
  artifactRefs: string[];
  primaryArtifactRef: string | null;
}

const COMPLETED_NODE_STATUSES = new Set(["succeeded", "completed"]);
const FAILED_NODE_STATUSES = new Set(["failed", "blocked", "exhausted"]);
const REPORT_ARTIFACT_PATTERN = /\.(?:md|json|html|pdf|txt)$/iu;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function duration(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  return finished - started;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildProjectScheduledTaskReport(input: {
  runStatus: string;
  startedAt: string | null;
  finishedAt: string | null;
  nodes: ProjectScheduledTaskReportNode[];
}): ProjectScheduledTaskReport {
  const failures = input.nodes.flatMap((node) => {
    if (!FAILED_NODE_STATUSES.has(node.status)) return [];
    const error = recordValue(node.error);
    return [{
      nodeKey: node.nodeKey,
      label: node.label,
      code: stringValue(error?.code) ?? "loop_node_failed",
      message: stringValue(error?.message) ?? "节点执行失败",
    }];
  });
  const artifactRefs = uniqueStrings(input.nodes.flatMap((node) => node.artifactRefs));
  const primaryArtifactRef = artifactRefs.find((artifactRef) => REPORT_ARTIFACT_PATTERN.test(artifactRef))
    ?? artifactRefs[0]
    ?? null;

  return {
    status: input.runStatus,
    durationMs: duration(input.startedAt, input.finishedAt),
    completedNodes: input.nodes.filter((node) => COMPLETED_NODE_STATUSES.has(node.status)).length,
    totalNodes: input.nodes.length,
    failures,
    artifactRefs,
    primaryArtifactRef,
  };
}
