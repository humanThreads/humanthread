export type LoopLayoutEdge = {
  source: string;
  target: string;
  kind?: string;
};

export type LoopNodePosition = { x: number; y: number };

const DESKTOP_X = 64;
const DESKTOP_Y = 96;
const DESKTOP_LAYER_GAP = 232;
const DESKTOP_ROW_GAP = 116;
const COMPACT_X = 72;
const COMPACT_Y = 48;
const COMPACT_ROW_GAP = 150;

/**
 * Derives a stable presentation layout from executable (non-feedback) edges.
 * Stored node-array order is intentionally ignored because authoring payloads
 * and historical run projections may arrive in different orders.
 */
export function layoutLoopNodes(input: {
  nodes: string[];
  edges: LoopLayoutEdge[];
  compact: boolean;
}): Record<string, LoopNodePosition> {
  const nodeSet = new Set(input.nodes);
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const key of input.nodes) {
    outgoing.set(key, []);
    incoming.set(key, []);
  }
  for (const edge of input.edges) {
    if (edge.kind === "feedback" || !nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  const rank = new Map<string, number>();
  const queue = input.nodes.filter((key) => (incoming.get(key)?.length ?? 0) === 0).sort();
  for (const key of queue) rank.set(key, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]!;
    for (const target of outgoing.get(source) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(source) ?? 0) + 1));
      const remaining = (incoming.get(target) ?? []).filter((candidate) => !rank.has(candidate)).length;
      if (remaining === 0 && !queue.includes(target)) queue.push(target);
    }
  }
  // Malformed/cyclic graphs still get a deterministic layout instead of falling
  // back to the arbitrary payload order.
  const unranked = input.nodes.filter((key) => !rank.has(key)).sort();
  for (const key of unranked) rank.set(key, Math.max(0, ...[...rank.values()]) + 1);

  if (input.compact) {
    const ordered = [...input.nodes].sort((left, right) => (rank.get(left)! - rank.get(right)!) || left.localeCompare(right));
    return Object.fromEntries(ordered.map((key, index) => [key, { x: COMPACT_X, y: COMPACT_Y + index * COMPACT_ROW_GAP }]));
  }

  const layers = new Map<number, string[]>();
  for (const key of input.nodes) {
    const layer = rank.get(key) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), key]);
  }
  const positions: Record<string, LoopNodePosition> = {};
  for (const [layer, keys] of [...layers.entries()].sort(([left], [right]) => left - right)) {
    for (const [row, key] of keys.sort().entries()) {
      positions[key] = { x: DESKTOP_X + layer * DESKTOP_LAYER_GAP, y: DESKTOP_Y + row * DESKTOP_ROW_GAP };
    }
  }
  return positions;
}
