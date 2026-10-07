import {
  assertCanReadProject,
  listLoopRunInteractions,
  prisma,
} from "@humanthread/db";
import type { WorkflowInteractionView } from "@humanthread/shared";
import type { LoopRouteAudit } from "./loop-read-model";

import { redactWorkflowInteractionText } from "./workflow-interaction-notifications";

export interface WorkflowTimelineItem {
  id: string;
  kind: "loop_event" | "requirement_message" | "interaction_decision";
  occurredAt: string;
  interactionId: string | null;
  loopNodeRunId: string | null;
  actorType: string;
  actorId: string;
  nodeKey: string | null;
  status: string | null;
  eventType: string | null;
  summary: string;
  body?: string;
  answers?: Record<string, string[]>;
  attachmentIds?: string[];
  mentionedUserIds?: string[];
  routeDecision?: LoopRouteAudit;
}

export interface WorkflowTimelineResult {
  items: WorkflowTimelineItem[];
  nextCursor: string | null;
  filters: Record<string, unknown>;
  capabilities: {
    canReply: boolean;
    canConfirm: boolean;
    canDecideApproval: boolean;
    canExport: boolean;
    supportsInteractions: boolean;
  };
}

interface TimelineRun {
  id: string;
  projectId: string | null;
  definitionVersion: number | null;
  status: string;
}

interface TimelineEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  sequence: number;
  occurredAt: Date;
  payload: unknown;
  actorType: string;
  actorId: string;
}

interface TimelineDependencies {
  loadRun(input: { loopRunId: string }): Promise<TimelineRun | null>;
  assertCanReadProject(input: { userId: string; projectId: string }): Promise<{ role?: string } | unknown>;
  loadEvents(input: { loopRunId: string }): Promise<TimelineEvent[]>;
  loadInteractions(input: { loopRunId: string }): Promise<WorkflowInteractionView[]>;
}

const DEFAULTS: TimelineDependencies = {
  loadRun: async ({ loopRunId }) => {
    const run = await prisma.loopRun.findFirst({
      where: { id: loopRunId, engineKind: "graph_v1" },
      select: { id: true, projectId: true, status: true, loopVersion: { select: { versionNumber: true } } },
    });
    return run ? { ...run, definitionVersion: run.loopVersion?.versionNumber ?? null } : null;
  },
  assertCanReadProject: ({ userId, projectId }) => assertCanReadProject({ userId, projectId }),
  loadEvents: ({ loopRunId }) => prisma.orchestrationEvent.findMany({
    where: { aggregateType: "run", aggregateId: loopRunId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      eventType: true,
      aggregateType: true,
      aggregateId: true,
      sequence: true,
      occurredAt: true,
      payload: true,
      actorType: true,
      actorId: true,
    },
  }),
  loadInteractions: ({ loopRunId }) => listLoopRunInteractions({ loopRunId }),
};

export async function readWorkflowTimeline(
  input: {
    userId: string;
    loopRunId: string;
    query?: string;
    kinds?: string[];
    nodeKeys?: string[];
    actorIds?: string[];
    statuses?: string[];
    from?: string | Date;
    to?: string | Date;
    cursor?: string;
    limit?: number;
  },
  overrides: Partial<TimelineDependencies> = {},
): Promise<WorkflowTimelineResult> {
  const dependencies = { ...DEFAULTS, ...overrides };
  const loopRunId = requiredId(input.loopRunId, "LoopRun id");
  const query = input.query?.trim() ?? "";
  if (query.length > 200) throw timelineError("validation_failed", "Timeline query is too long");
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw timelineError("validation_failed", "Timeline limit is invalid");
  const run = await dependencies.loadRun({ loopRunId });
  if (!run?.projectId) throw timelineError("not_found", "Graph LoopRun not found");
  const access = await dependencies.assertCanReadProject({ userId: input.userId, projectId: run.projectId });
  const [events, interactions] = await Promise.all([
    dependencies.loadEvents({ loopRunId }),
    dependencies.loadInteractions({ loopRunId }),
  ]);
  const allItems = [
    ...events.map(projectEvent),
    ...interactions.flatMap(projectInteraction),
  ].sort(compareTimelineItems);
  const filtered = allItems.filter((item) => matchesFilters(item, input, query));
  const startIndex = decodeCursor(input.cursor, loopRunId);
  const items = filtered.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < filtered.length ? `${loopRunId}:${startIndex + limit}` : null;
  const role = access && typeof access === "object" && "role" in access ? String(access.role) : "viewer";
  const canWrite = ["owner", "maintainer", "contributor"].includes(role);
  const canGovern = ["owner", "maintainer"].includes(role);
  return {
    items,
    nextCursor,
    filters: {
      ...(query ? { query } : {}),
      ...(input.kinds ? { kinds: input.kinds } : {}),
      ...(input.nodeKeys ? { nodeKeys: input.nodeKeys } : {}),
      ...(input.actorIds ? { actorIds: input.actorIds } : {}),
      ...(input.statuses ? { statuses: input.statuses } : {}),
      ...(input.from ? { from: toDate(input.from, "from").toISOString() } : {}),
      ...(input.to ? { to: toDate(input.to, "to").toISOString() } : {}),
    },
    capabilities: {
      canReply: canWrite,
      canConfirm: canGovern,
      canDecideApproval: canGovern,
      canExport: true,
      supportsInteractions: true,
    },
  };
}

function projectEvent(event: TimelineEvent): WorkflowTimelineItem {
  const payload = asRecord(event.payload);
  const body = typeof payload.summary === "string" ? payload.summary : event.eventType;
  return {
    id: event.id,
    kind: "loop_event",
    occurredAt: event.occurredAt.toISOString(),
    interactionId: typeof payload.interactionId === "string" ? payload.interactionId : null,
    loopNodeRunId: event.aggregateType === "loop_node" ? event.aggregateId : null,
    actorType: event.actorType,
    actorId: event.actorId,
    nodeKey: typeof payload.nodeKey === "string" ? payload.nodeKey : null,
    status: typeof payload.status === "string" ? payload.status : null,
    eventType: event.eventType,
    summary: redactWorkflowInteractionText(body),
  };
}

function projectInteraction(interaction: WorkflowInteractionView): WorkflowTimelineItem[] {
  const items: WorkflowTimelineItem[] = interaction.messages.map((message) => ({
    id: message.id,
    kind: "requirement_message",
    occurredAt: message.createdAt,
    interactionId: interaction.id,
    loopNodeRunId: interaction.loopNodeRunId,
    actorType: message.actorType,
    actorId: message.actorId,
    nodeKey: null,
    status: interaction.status,
    eventType: "workflow.interaction.message_appended",
    summary: redactWorkflowInteractionText(message.body) || "工作流交互消息",
    body: redactWorkflowInteractionText(message.body),
    answers: message.answers,
    ...(message.attachmentIds ? { attachmentIds: message.attachmentIds } : {}),
    ...(message.mentionedUserIds ? { mentionedUserIds: message.mentionedUserIds } : {}),
  }));
  if (interaction.decision) {
    items.push({
      id: interaction.decision.id,
      kind: "interaction_decision",
      occurredAt: interaction.decision.createdAt,
      interactionId: interaction.id,
      loopNodeRunId: interaction.loopNodeRunId,
      actorType: interaction.decision.actorType,
      actorId: interaction.decision.actorId,
      nodeKey: null,
      status: interaction.decision.decision,
      eventType: "workflow.interaction.decided",
      summary: `交互已${interaction.decision.decision === "approved" ? "批准" : interaction.decision.decision === "rejected" ? "拒绝" : "确认"}`,
    });
  }
  return items;
}

function matchesFilters(item: WorkflowTimelineItem, input: {
  kinds?: string[]; nodeKeys?: string[]; actorIds?: string[]; statuses?: string[]; from?: string | Date; to?: string | Date;
}, query: string) {
  if (input.kinds && !input.kinds.includes(item.kind)) return false;
  if (input.nodeKeys && !input.nodeKeys.includes(item.nodeKey ?? "")) return false;
  if (input.actorIds && !input.actorIds.includes(item.actorId)) return false;
  if (input.statuses && !input.statuses.includes(item.status ?? "")) return false;
  const occurredAt = new Date(item.occurredAt).getTime();
  if (input.from && occurredAt < toDate(input.from, "from").getTime()) return false;
  if (input.to && occurredAt > toDate(input.to, "to").getTime()) return false;
  if (query && !`${item.summary} ${item.body ?? ""} ${item.eventType ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return false;
  return true;
}

function compareTimelineItems(left: WorkflowTimelineItem, right: WorkflowTimelineItem) {
  const time = left.occurredAt.localeCompare(right.occurredAt);
  if (time !== 0) return time;
  const rank = itemRank(left) - itemRank(right);
  return rank !== 0 ? rank : left.id.localeCompare(right.id);
}

function itemRank(item: WorkflowTimelineItem) {
  return item.kind === "loop_event" ? 0 : item.kind === "requirement_message" ? 1 : 2;
}

function decodeCursor(cursor: string | undefined, loopRunId: string) {
  if (!cursor) return 0;
  const [cursorRunId, rawIndex] = cursor.split(":");
  const index = Number(rawIndex);
  if (cursorRunId !== loopRunId || !Number.isInteger(index) || index < 0) {
    throw timelineError("validation_failed", "Timeline cursor is invalid");
  }
  return index;
}

function toDate(value: string | Date, name: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw timelineError("validation_failed", `Timeline ${name} is invalid`);
  return date;
}

function requiredId(value: string, name: string) {
  if (!value.trim()) throw timelineError("validation_failed", `${name} is required`);
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function timelineError(code: "validation_failed" | "not_found", message: string) {
  return Object.assign(new Error(message), { code });
}
