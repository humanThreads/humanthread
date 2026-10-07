import {
  deriveHumanGateRoutes,
  loopAuthoringGraphSchema,
  type HumanGateRoutes,
} from "@humanthread/orchestration-core";

type ApprovalTask = { id: string; shortId: string | null; title: string };
type ApprovalLoopVersion = {
  graph: unknown;
  loopDefinition: { name: string } | null;
};

export type ApprovalDecisionRecord = {
  id: string;
  type: string;
  status: string;
  projectId: string | null;
  createdAt: Date;
  project: { name: string } | null;
  taskId: string | null;
  task: ApprovalTask | null;
  loopRunId: string | null;
  loopRun: {
    id: string;
    taskId: string | null;
    task: ApprovalTask | null;
    loopVersion: ApprovalLoopVersion | null;
  } | null;
  loopNodeRunId: string | null;
  loopNodeRun: {
    id: string;
    nodeKey: string;
    inputSnapshot?: unknown;
    artifacts?: Array<{
      id: string;
      type: string;
      mimeType: string;
      byteSize: bigint | number;
      metadata: unknown;
    }>;
  } | null;
  requestPayload: unknown;
  policySnapshot: unknown;
  expiresAt?: Date | null;
};

export interface ApprovalReviewArtifact {
  artifactId: string;
  fileName: string;
  mimeType: "text/html";
  byteSize: number;
  checksum?: string;
  href: string;
}

export interface ApprovalDecisionItem {
  id: string;
  type: string;
  status: string;
  createdAt: Date;
  taskId?: string | null;
  taskShortId?: string | null;
  taskTitle: string | null;
  projectId?: string | null;
  projectName?: string | null;
  loopRunId?: string | null;
  loopLabel?: string | null;
  loopNodeRunId?: string | null;
  nodeKey?: string | null;
  nodeLabel?: string | null;
  prompt?: string | null;
  routes?: HumanGateRoutes | null;
  action: string;
  scope: string;
  policyReason: string;
  /**
   * Text the upstream node produced. Without it the approver sees an action
   * fingerprint and has no way to tell what the previous node actually did.
   */
  upstreamOutput?: string | null;
  reviewArtifacts?: ApprovalReviewArtifact[];
}

export function projectApprovalDecisionItem(record: ApprovalDecisionRecord): ApprovalDecisionItem {
  const request = asRecord(record.requestPayload);
  const policy = asRecord(record.policySnapshot);
  const task = record.task ?? record.loopRun?.task ?? null;
  const nodeKey = record.loopNodeRun?.nodeKey ?? null;
  const graph = record.loopRun?.loopVersion?.graph;

  return {
    id: record.id,
    type: record.type,
    status: record.status,
    createdAt: record.createdAt,
    taskId: task?.id ?? record.taskId ?? record.loopRun?.taskId ?? null,
    taskShortId: task?.shortId ?? null,
    taskTitle: task?.title ?? null,
    projectId: record.projectId,
    projectName: record.project?.name ?? null,
    loopRunId: record.loopRunId ?? record.loopRun?.id ?? null,
    loopLabel: record.loopRun?.loopVersion?.loopDefinition?.name ?? null,
    loopNodeRunId: record.loopNodeRunId ?? record.loopNodeRun?.id ?? null,
    nodeKey,
    nodeLabel: nodeLabel(graph, nodeKey),
    prompt: readText(request?.prompt),
    routes: projectRoutes({
      type: record.type,
      value: request?.routes,
      graph,
      nodeKey,
    }),
    action: String(request?.action ?? record.type),
    scope: String(request?.scope ?? request?.actionFingerprint ?? "当前任务范围"),
    policyReason: String(policy?.reason ?? request?.policyReason ?? "该操作需要人工审批"),
    upstreamOutput: projectUpstreamOutput(record.loopNodeRun?.inputSnapshot),
    reviewArtifacts: projectReviewArtifacts(record, request),
  };
}

const UPSTREAM_OUTPUT_MAX_LENGTH = 4_000;

function projectUpstreamOutput(value: unknown): string | null {
  const snapshot = asRecord(value);
  const candidates = snapshot
    ? [snapshot.appServer, snapshot.summary, snapshot.message, snapshot.rationale, snapshot.report]
    : [value];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const sanitized = candidate.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "").trim();
    if (sanitized) return sanitized.slice(0, UPSTREAM_OUTPUT_MAX_LENGTH);
  }
  return null;
}

function projectReviewArtifacts(
  record: ApprovalDecisionRecord,
  request: Record<string, unknown> | null,
): ApprovalReviewArtifact[] {
  const candidates = [
    ...reviewArtifactReferences(record.loopNodeRun?.inputSnapshot),
    ...reviewArtifactReferences(request?.reviewArtifacts),
    ...(record.loopNodeRun?.artifacts ?? []).map((artifact) => ({
      artifactId: artifact.id,
      mimeType: artifact.mimeType,
      byteSize: artifact.byteSize,
      metadata: artifact.metadata,
      type: artifact.type,
    })),
  ];
  const projected: ApprovalReviewArtifact[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const artifact = projectReviewArtifact(candidate);
    if (!artifact || seen.has(artifact.artifactId)) continue;
    seen.add(artifact.artifactId);
    projected.push(artifact);
  }
  return projected.slice(0, 20);
}

function reviewArtifactReferences(value: unknown): unknown[] {
  const record = asRecord(value);
  return Array.isArray(record?.reviewArtifacts) ? record.reviewArtifacts : [];
}

function projectReviewArtifact(value: unknown): ApprovalReviewArtifact | null {
  const artifact = asRecord(value);
  if (!artifact) return null;
  const source = asRecord(artifact.metadata) ?? artifact;
  const artifactId = readText(artifact.artifactId ?? artifact.id);
  const mimeType = readText(artifact.mimeType);
  const rawByteSize = source.byteSize ?? artifact.byteSize;
  const byteSize = typeof rawByteSize === "bigint"
    ? Number(rawByteSize)
    : typeof rawByteSize === "number" ? rawByteSize : Number.NaN;
  const rawFileName = readText(source.fileName)
    ?? readText(source.relativePath)?.split(/[\\/]/u).at(-1)
    ?? null;
  if (
    !artifactId
    || !/^[a-f0-9]{32}$/u.test(artifactId)
    || mimeType !== "text/html"
    || !Number.isSafeInteger(byteSize)
    || byteSize < 0
    || !rawFileName
  ) return null;
  const fileName = rawFileName.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 191);
  if (!fileName || fileName === "." || fileName === "..") return null;
  const checksum = readText(artifact.checksum ?? source.checksum);
  return {
    artifactId,
    fileName,
    mimeType: "text/html",
    byteSize,
    ...(checksum && /^[a-f0-9]{64}$/u.test(checksum) ? { checksum } : {}),
    href: `/api/loop-artifacts/${artifactId}`,
  };
}

function nodeLabel(graph: unknown, nodeKey: string | null): string | null {
  const graphRecord = asRecord(graph);
  if (!nodeKey || !graphRecord || !Array.isArray(graphRecord.nodes)) return null;
  const node = graphRecord.nodes.find((candidate) => asRecord(candidate)?.key === nodeKey);
  return readText(asRecord(node)?.label);
}

function readRoutes(value: unknown): HumanGateRoutes | null {
  const routes = asRecord(value);
  if (!routes) return null;
  const pass = routeIds(routes.pass);
  const rework = routeIds(routes.rework);
  const reject = routeIds(routes.reject);
  return pass && rework && reject ? { pass, rework, reject } : null;
}

function projectRoutes(input: {
  type: string;
  value: unknown;
  graph: unknown;
  nodeKey: string | null;
}): HumanGateRoutes | null {
  const stored = readRoutes(input.value);
  if (!stored || input.type !== "loop_human_gate" || !input.nodeKey) return stored;
  if (stored.pass.length || stored.rework.length || stored.reject.length) return stored;
  const graph = loopAuthoringGraphSchema.safeParse(input.graph);
  if (!graph.success) return stored;
  try {
    return deriveHumanGateRoutes(graph.data, input.nodeKey);
  } catch {
    return stored;
  }
}

function routeIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((edgeId) => typeof edgeId === "string")
    ? value
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
