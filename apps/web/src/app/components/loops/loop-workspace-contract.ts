import type { LoopRunProjection } from "@/lib/orchestration/loop-read-model";

export interface LoopWorkspaceTimelineItem {
  id: string;
  kind: "loop_event" | "requirement_message" | "interaction_decision" | "unknown";
  sourceKind?: string;
  occurredAt: string;
  summary: string;
  interactionId?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface LoopWorkspaceProjection extends LoopRunProjection {
  timeline: LoopWorkspaceTimelineItem[];
  currentInteraction: Record<string, unknown> | null;
  capabilities: {
    canReply: boolean;
    canConfirm: boolean;
    canDecideApproval: boolean;
    canExport: boolean;
    supportsInteractions: boolean;
  };
}

export function parseLoopWorkspaceProjection(input: unknown): LoopWorkspaceProjection {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("LoopRun projection is invalid");
  const record = input as Record<string, unknown>;
  if (!record.run || typeof record.run !== "object" || typeof (record.run as Record<string, unknown>).id !== "string") {
    throw new Error("LoopRun projection is invalid");
  }
  const base = record as unknown as LoopRunProjection;
  const timeline = Array.isArray(record.timeline)
    ? record.timeline.flatMap((value) => parseTimelineItem(value))
    : [];
  const rawCapabilities = record.capabilities && typeof record.capabilities === "object"
    ? record.capabilities as Record<string, unknown>
    : {};
  return {
    ...base,
    timeline,
    currentInteraction: record.currentInteraction && typeof record.currentInteraction === "object"
      ? record.currentInteraction as Record<string, unknown>
      : null,
    capabilities: {
      canReply: rawCapabilities.canReply === true,
      canConfirm: rawCapabilities.canConfirm === true,
      canDecideApproval: rawCapabilities.canDecideApproval === true,
      canExport: rawCapabilities.canExport === true,
      supportsInteractions: rawCapabilities.supportsInteractions === true,
    },
  };
}

function parseTimelineItem(value: unknown): LoopWorkspaceTimelineItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.occurredAt !== "string" || typeof record.summary !== "string") return [];
  const known = new Set(["loop_event", "requirement_message", "interaction_decision"]);
  const kind = typeof record.kind === "string" && known.has(record.kind)
    ? record.kind as LoopWorkspaceTimelineItem["kind"]
    : "unknown";
  return [{
    ...record,
    id: record.id,
    kind,
    ...(kind === "unknown" && typeof record.kind === "string" ? { sourceKind: record.kind } : {}),
    occurredAt: record.occurredAt,
    summary: record.summary,
  }];
}
