import { createHash } from "node:crypto";
import {
  platformLoopGraphSchema,
  platformLoopGraphV2Schema,
  runGraphSnapshotSchema,
  runGraphSnapshotV2Schema,
  loopGraphV2Schema,
  stableNodeId,
  type LoopGraph,
  type LoopGraphV2,
  type LoopNodeDefinition,
  type PlatformLoopGraph,
  type PlatformLoopGraphV2,
  type RunGraphSnapshot,
  type RunGraphSnapshotV2,
} from "@humanthread/shared";
import { validateLoopGraph } from "./loop-graph";

export type SnapshotLoopVersionInput = {
  loopDefinitionId: string;
  loopVersionId: string;
  scope: "project" | "task";
  graph: LoopGraph;
};

export type SnapshotLoopVersionInputV2 = Omit<SnapshotLoopVersionInput, "graph"> & {
  graph: LoopGraphV2;
};

export type PublishedSnapshotLoopVersionInput = SnapshotLoopVersionInput | SnapshotLoopVersionInputV2;

export function resolvePublishedRunGraphSnapshot(input: {
  rootLoopVersionId: string;
  versions: PublishedSnapshotLoopVersionInput[];
}): RunGraphSnapshot | RunGraphSnapshotV2 {
  const root = input.versions.find((version) => version.loopVersionId === input.rootLoopVersionId);
  if (!root) throw validationError(`Published LoopVersion ${input.rootLoopVersionId} is unavailable`);
  if (root.graph.schemaVersion === 2) {
    return resolveRunGraphSnapshotV2({
      rootLoopVersionId: input.rootLoopVersionId,
      versions: input.versions.filter((version): version is SnapshotLoopVersionInputV2 => version.graph.schemaVersion === 2),
    });
  }
  return resolveRunGraphSnapshot({
    rootLoopVersionId: input.rootLoopVersionId,
    versions: input.versions.filter((version): version is SnapshotLoopVersionInput => version.graph.schemaVersion === 1),
  });
}

/**
 * Scheduled tasks may bind a task-scoped Loop and execute it directly as the
 * graph root. General project-root callers must continue to require a project
 * root, so the public `resolveRunGraphSnapshot` helpers keep that default.
 */
export function resolveScheduledPublishedRunGraphSnapshot(input: {
  rootLoopVersionId: string;
  versions: PublishedSnapshotLoopVersionInput[];
}): RunGraphSnapshot | RunGraphSnapshotV2 {
  const root = input.versions.find((version) => version.loopVersionId === input.rootLoopVersionId);
  if (!root) throw validationError(`Published LoopVersion ${input.rootLoopVersionId} is unavailable`);
  if (root.graph.schemaVersion === 2) {
    return resolveRunGraphSnapshotV2({
      rootLoopVersionId: input.rootLoopVersionId,
      versions: input.versions.filter((version): version is SnapshotLoopVersionInputV2 => version.graph.schemaVersion === 2),
      allowTaskRoot: true,
    });
  }
  return resolveRunGraphSnapshot({
    rootLoopVersionId: input.rootLoopVersionId,
    versions: input.versions.filter((version): version is SnapshotLoopVersionInput => version.graph.schemaVersion === 1),
    allowTaskRoot: true,
  });
}

export function resolveRunGraphSnapshot(input: {
  rootLoopVersionId: string;
  versions: SnapshotLoopVersionInput[];
  allowTaskRoot?: boolean;
}): RunGraphSnapshot {
  const byVersion = new Map<string, SnapshotLoopVersionInput>();
  for (const version of input.versions) {
    if (byVersion.has(version.loopVersionId)) {
      throw validationError(`Duplicate LoopVersion ${version.loopVersionId}`);
    }
    byVersion.set(version.loopVersionId, version);
  }

  const root = byVersion.get(input.rootLoopVersionId);
  if (!root || (root.scope !== "project" && !(input.allowTaskRoot === true && root.scope === "task"))) {
    throw validationError("Run root must be a published project Loop");
  }

  const selected: SnapshotLoopVersionInput[] = [];
  const selectedIds = new Set<string>();
  const visiting = new Set<string>();

  const visit = (version: SnapshotLoopVersionInput): void => {
    if (visiting.has(version.loopVersionId)) {
      throw validationError(`SubLoop reference is recursive at ${version.loopVersionId}`);
    }
    if (selectedIds.has(version.loopVersionId)) return;

    visiting.add(version.loopVersionId);
    selectedIds.add(version.loopVersionId);
    selected.push(version);
    for (const node of version.graph.nodes) {
      if (node.type !== "subloop_call") continue;
      const target = byVersion.get(node.targetLoopVersionId);
      if (!target || target.loopDefinitionId !== node.targetLoopDefinitionId) {
        throw validationError(`SubLoop references a missing published target ${node.targetLoopVersionId}`);
      }
      if (target.scope !== "task") {
        throw validationError(`SubLoop target ${target.loopVersionId} must be task-scoped`);
      }
      visit(target);
    }
    visiting.delete(version.loopVersionId);
  };

  visit(root);

  const normalized = selected.map((version) => ({
    loopDefinitionId: version.loopDefinitionId,
    loopVersionId: version.loopVersionId,
    scope: version.scope,
    graph: projectPlatformLoopGraph(version.graph),
  }));
  const rootNormalized = normalized.find((version) => version.loopVersionId === root.loopVersionId);
  const remaining = normalized
    .filter((version) => version.loopVersionId !== root.loopVersionId)
    .sort(byLoopVersionId);
  const ordered = rootNormalized ? [rootNormalized, ...remaining] : remaining;
  const digest = snapshotDigest({ rootLoopVersionId: root.loopVersionId, loopVersions: ordered });

  return runGraphSnapshotSchema.parse({
    snapshotId: `snapshot_${digest.slice("sha256:".length)}`,
    graphDigest: digest,
    rootLoopVersionId: root.loopVersionId,
    loopVersions: ordered,
    reachableNodeIds: [...new Set(ordered.flatMap(({ graph }) => graph.nodes.map(stableNodeId)))].sort(),
  });
}

export function resolveRunGraphSnapshotV2(input: {
  rootLoopVersionId: string;
  versions: SnapshotLoopVersionInputV2[];
  allowTaskRoot?: boolean;
}): RunGraphSnapshotV2 {
  const selected = selectReachableV2Versions({
    rootLoopVersionId: input.rootLoopVersionId,
    versions: input.versions,
    ...(input.allowTaskRoot === undefined ? {} : { allowTaskRoot: input.allowTaskRoot }),
  });
  const root = selected[0]!;
  const normalized = selected.map((version) => ({
    loopDefinitionId: version.loopDefinitionId,
    loopVersionId: version.loopVersionId,
    scope: version.scope,
    graph: projectPlatformLoopGraphV2(version.graph),
  }));
  const rootNormalized = normalized.find((version) => version.loopVersionId === root.loopVersionId);
  const remaining = normalized
    .filter((version) => version.loopVersionId !== root.loopVersionId)
    .sort(byLoopVersionId);
  const ordered = rootNormalized ? [rootNormalized, ...remaining] : remaining;
  const digest = snapshotDigest({ schemaVersion: 2, rootLoopVersionId: root.loopVersionId, loopVersions: ordered });

  return runGraphSnapshotV2Schema.parse({
    schemaVersion: 2,
    snapshotId: `snapshot_${digest.slice("sha256:".length)}`,
    graphDigest: digest,
    rootLoopVersionId: root.loopVersionId,
    loopVersions: ordered,
    reachableNodeIds: [...new Set(ordered.flatMap(({ graph }) => graph.nodes.map(stableNodeId)))].sort(),
  });
}

export function parseRunGraphSnapshot(value: unknown): RunGraphSnapshot {
  const parsed = runGraphSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw validationError(`Run graph snapshot is invalid: ${parsed.error.message}`);
  }
  const expectedDigest = snapshotDigest({
    rootLoopVersionId: parsed.data.rootLoopVersionId,
    loopVersions: parsed.data.loopVersions,
  });
  if (expectedDigest !== parsed.data.graphDigest) {
    throw validationError("Run graph snapshot digest does not match its graph");
  }
  return parsed.data;
}

export function parseRunGraphSnapshotV2(value: unknown): RunGraphSnapshotV2 {
  const parsed = runGraphSnapshotV2Schema.safeParse(value);
  if (!parsed.success) {
    throw validationError(`Run graph snapshot v2 is invalid: ${parsed.error.message}`);
  }
  const expectedDigest = snapshotDigest({
    schemaVersion: 2,
    rootLoopVersionId: parsed.data.rootLoopVersionId,
    loopVersions: parsed.data.loopVersions,
  });
  if (expectedDigest !== parsed.data.graphDigest) {
    throw validationError("Run graph snapshot v2 digest does not match its graph");
  }
  return parsed.data;
}

export function canonicalJson(value: unknown): string {
  return canonicalizeJsonValue(value, new WeakSet<object>(), 0);
}

export function snapshotDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function projectPlatformLoopGraph(graph: LoopGraph): PlatformLoopGraph {
  const stableIds = graph.nodes.map(stableNodeId);
  if (new Set(stableIds).size !== stableIds.length) {
    throw validationError("LoopVersion contains duplicate stable node IDs");
  }
  const projected = {
    schemaVersion: graph.schemaVersion,
    limits: graph.limits,
    nodes: graph.nodes.map(projectLegacyNode),
    edges: graph.edges.map(({ id, source, target, kind, outcome, maxTraversals }) => ({
      id,
      source,
      target,
      kind,
      outcome,
      ...(maxTraversals === undefined ? {} : { maxTraversals }),
    })),
  };
  return platformLoopGraphSchema.parse(projected);
}

export function projectPlatformLoopGraphV2(graph: LoopGraphV2): PlatformLoopGraphV2 {
  const parsed = loopGraphV2Schema.parse(graph);
  const validation = validateLoopGraph(parsed);
  if (!validation.ok) throw validationError(validation.errors.join("; "));
  const stableIds = parsed.nodes.map(stableNodeId);
  if (new Set(stableIds).size !== stableIds.length) {
    throw validationError("LoopVersion contains duplicate stable node IDs");
  }
  const nodesByKey = new Map(parsed.nodes.map((node) => [node.key, node]));
  const projected = {
    schemaVersion: 2 as const,
    limits: parsed.limits,
    nodes: parsed.nodes.map((node) => {
      const legacy = projectLegacyNode(node);
      if (node.type === "start" || node.type === "end") return legacy;
      const nodeId = stableNodeId(node);
      const responsibility = parsed.routingMetadata[nodeId]?.responsibility.trim() ?? "";
      if (!responsibility) {
        throw validationError(`Loop node ${node.key} responsibility is required`);
      }
      const allowedRouteTargets = parsed.edges
        .filter((edge) => edge.source === node.key)
        .map((edge) => {
          const target = nodesByKey.get(edge.target);
          if (!target) throw validationError(`Loop edge ${edge.id} references a missing target`);
          return stableNodeId(target);
        });
      if (allowedRouteTargets.length === 0) {
        throw validationError(`Loop node ${node.key} requires an allowed route target`);
      }
      if (new Set(allowedRouteTargets).size !== allowedRouteTargets.length) {
        throw validationError(`Loop node ${node.key} contains duplicate route targets`);
      }
      return { ...legacy, responsibility, allowedRouteTargets };
    }),
    edges: parsed.edges.map(({ id, source, target, kind, outcome, maxTraversals }) => ({
      id,
      source,
      target,
      kind,
      outcome,
      ...(maxTraversals === undefined ? {} : { maxTraversals }),
    })),
  };
  return platformLoopGraphV2Schema.parse(projected);
}

function selectReachableV2Versions(input: {
  rootLoopVersionId: string;
  versions: SnapshotLoopVersionInputV2[];
  allowTaskRoot?: boolean;
}): SnapshotLoopVersionInputV2[] {
  const byVersion = new Map<string, SnapshotLoopVersionInputV2>();
  for (const version of input.versions) {
    if (byVersion.has(version.loopVersionId)) {
      throw validationError(`Duplicate LoopVersion ${version.loopVersionId}`);
    }
    byVersion.set(version.loopVersionId, version);
  }
  const root = byVersion.get(input.rootLoopVersionId);
  if (!root || (root.scope !== "project" && !(input.allowTaskRoot === true && root.scope === "task"))) {
    throw validationError("Run root must be a published project Loop");
  }
  const selected: SnapshotLoopVersionInputV2[] = [];
  const selectedIds = new Set<string>();
  const visiting = new Set<string>();
  const visit = (version: SnapshotLoopVersionInputV2): void => {
    if (visiting.has(version.loopVersionId)) {
      throw validationError(`SubLoop reference is recursive at ${version.loopVersionId}`);
    }
    if (selectedIds.has(version.loopVersionId)) return;
    visiting.add(version.loopVersionId);
    selectedIds.add(version.loopVersionId);
    selected.push(version);
    for (const node of version.graph.nodes) {
      if (node.type !== "subloop_call") continue;
      const target = byVersion.get(node.targetLoopVersionId);
      if (!target || target.loopDefinitionId !== node.targetLoopDefinitionId) {
        throw validationError(`SubLoop references a missing published target ${node.targetLoopVersionId}`);
      }
      if (target.scope !== "task") {
        throw validationError(`SubLoop target ${target.loopVersionId} must be task-scoped`);
      }
      visit(target);
    }
    visiting.delete(version.loopVersionId);
  };
  visit(root);
  return selected;
}

function projectLegacyNode(node: LoopNodeDefinition): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    key: node.key,
    nodeId: stableNodeId(node),
    label: node.label,
    type: node.type,
    offlinePolicy: node.offlinePolicy,
  };
  if (node.requiredCapabilities !== undefined) projected.requiredCapabilities = [...node.requiredCapabilities];

  switch (node.type) {
    case "agent_action":
      projected.executionTarget = node.executionTarget;
      if (node.reasoningEffort !== undefined) projected.reasoningEffort = node.reasoningEffort;
      break;
    case "platform_action":
      projected.executionTarget = node.executionTarget;
      break;
    case "condition":
    case "policy_gate":
    case "human_gate":
    case "wait_callback":
      projected.executionTarget = node.executionTarget;
      break;
    case "subloop_call":
      projected.executionTarget = node.executionTarget;
      projected.targetLoopDefinitionId = node.targetLoopDefinitionId;
      projected.targetLoopVersionId = node.targetLoopVersionId;
      projected.inputMapping = cloneInputMapping(node.inputMapping);
      projected.terminalOutcomeMapping = node.terminalOutcomeMapping;
      break;
    case "start":
    case "end":
      break;
  }
  return projected;
}

const MAX_JSON_DEPTH = 64;
const MAX_JSON_ARRAY_LENGTH = 4_096;
const MAX_JSON_OBJECT_KEYS = 4_096;
const FORBIDDEN_MAPPING_KEY = /prompt|schema|skill|command|rule|policy|config|callback|condition|expression|template|instruction|hook/iu;

function cloneInputMapping(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw validationError("inputMapping must be a plain object");
  }
  return cloneJsonValue(value, new WeakSet<object>(), 0, true) as Record<string, unknown>;
}

function cloneJsonValue(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
  enforceMappingKeys = false,
): unknown {
  if (depth > MAX_JSON_DEPTH) {
    throw validationError("Snapshot JSON exceeds maximum nesting depth");
  }
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw validationError("Snapshot must contain only JSON values");
    return value;
  }
  if (typeof value !== "object") throw validationError("Snapshot must contain only JSON values");
  if (active.has(value)) throw validationError("Snapshot JSON contains a cycle");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const array = value as unknown[];
      if (array.length > MAX_JSON_ARRAY_LENGTH) {
        throw validationError("Snapshot JSON array exceeds maximum length");
      }
      for (const key of Object.keys(array)) {
        if (!/^\d+$/u.test(key) || Number(key) >= array.length) {
          throw validationError("Snapshot arrays may only contain indexed JSON values");
        }
      }
      return Array.from({ length: array.length }, (_, index) =>
        cloneJsonValue(array[index], active, depth + 1, enforceMappingKeys) ?? null,
      );
    }
    if (!isPlainObject(value)) throw validationError("Snapshot JSON requires plain objects");
    const result: Record<string, unknown> = {};
    const keys = Object.keys(value);
    if (keys.length > MAX_JSON_OBJECT_KEYS) {
      throw validationError("Snapshot JSON object exceeds maximum property count");
    }
    for (const key of keys) {
      if (enforceMappingKeys && FORBIDDEN_MAPPING_KEY.test(key)) {
        throw validationError(`inputMapping contains forbidden key ${key}`);
      }
      const nested = cloneJsonValue((value as Record<string, unknown>)[key], active, depth + 1, enforceMappingKeys);
      if (nested !== undefined) result[key] = nested;
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function canonicalizeJsonValue(value: unknown, active: WeakSet<object>, depth: number): string {
  if (depth > MAX_JSON_DEPTH) {
    throw validationError("Snapshot JSON exceeds maximum nesting depth");
  }
  if (value === undefined) return "null";
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw validationError("Snapshot must contain only JSON values");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw validationError("Snapshot must contain only JSON values");
  if (active.has(value)) throw validationError("Snapshot JSON contains a cycle");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const array = value as unknown[];
      if (array.length > MAX_JSON_ARRAY_LENGTH) {
        throw validationError("Snapshot JSON array exceeds maximum length");
      }
      for (const key of Object.keys(array)) {
        if (!/^\d+$/u.test(key) || Number(key) >= array.length) {
          throw validationError("Snapshot arrays may only contain indexed JSON values");
        }
      }
      const entries = Array.from({ length: array.length }, (_, index) =>
        canonicalizeJsonValue(array[index], active, depth + 1),
      );
      return `[${entries.join(",")}]`;
    }
    if (!isPlainObject(value)) throw validationError("Snapshot JSON requires plain objects");
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > MAX_JSON_OBJECT_KEYS) {
      throw validationError("Snapshot JSON object exceeds maximum property count");
    }
    const entries: string[] = [];
    for (const key of keys.sort()) {
      if (record[key] === undefined) continue;
      entries.push(`${JSON.stringify(key)}:${canonicalizeJsonValue(record[key], active, depth + 1)}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    active.delete(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function byLoopVersionId(
  left: { loopVersionId: string },
  right: { loopVersionId: string },
): number {
  return left.loopVersionId.localeCompare(right.loopVersionId);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
