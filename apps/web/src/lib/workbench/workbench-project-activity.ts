import type { Prisma } from "@prisma/client";
import { assertCanWriteProject, buildAccessibleProjectWhere, prisma } from "../../../../../packages/db/src/index";

export interface ProjectDecisionEntry {
  id: string;
  type: string;
  status: string;
  taskTitle: string | null;
  action: string;
  scope: string;
  policyReason: string;
  requestedByActor: string;
  decisionReason: string | null;
  decidedByUserId: string | null;
  occurredAt: Date;
}

export interface ProjectTimelineEntry {
  id: string;
  kind: "decision" | "project_event" | "task_activity";
  title: string;
  description: string;
  actorLabel: string;
  taskId: string | null;
  taskTitle: string | null;
  occurredAt: Date;
}

export interface ProjectActivityView {
  project: { id: string; name: string };
  canDecide: boolean;
  decisions: ProjectDecisionEntry[];
  timeline: ProjectTimelineEntry[];
}

interface ActivityDb {
  project: { findFirst: typeof prisma.project.findFirst };
  approvalRequest: { findMany: typeof prisma.approvalRequest.findMany };
  orchestrationEvent: { findMany: typeof prisma.orchestrationEvent.findMany };
  taskActivity: { findMany: typeof prisma.taskActivity.findMany };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function defaultCanWrite(input: { userId: string; projectId: string }): Promise<boolean> {
  try {
    await assertCanWriteProject(input);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("access denied")) return false;
    throw error;
  }
}

export async function getProjectActivityView(input: {
  projectId: string;
  userId: string;
  db?: ActivityDb;
  canWriteProject?: (input: { userId: string; projectId: string }) => Promise<boolean>;
}): Promise<ProjectActivityView | null> {
  const db = input.db ?? prisma;
  const project = await db.project.findFirst({
    where: { id: input.projectId, AND: [buildAccessibleProjectWhere({ userId: input.userId }) as Prisma.ProjectWhereInput] },
    select: { id: true, name: true },
  });
  if (!project) return null;

  const [canDecide, approvals, events, activities] = await Promise.all([
    (input.canWriteProject ?? defaultCanWrite)({ userId: input.userId, projectId: input.projectId }),
    db.approvalRequest.findMany({ where: { projectId: input.projectId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, type: true, status: true, requestedByActor: true, requestPayload: true, policySnapshot: true, decisionReason: true, decidedByUserId: true, createdAt: true, decidedAt: true, task: { select: { id: true, title: true } } } }),
    db.orchestrationEvent.findMany({ where: { aggregateType: "project", aggregateId: input.projectId }, orderBy: { occurredAt: "desc" }, take: 100, select: { id: true, eventType: true, actorType: true, actorId: true, payload: true, occurredAt: true } }),
    db.taskActivity.findMany({ where: { task: { projectId: input.projectId } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, type: true, actorType: true, message: true, createdAt: true, task: { select: { id: true, title: true } }, actor: { select: { id: true, name: true } } } }),
  ]);

  const decisions: ProjectDecisionEntry[] = approvals.map((approval) => {
    const request = record(approval.requestPayload);
    const policy = record(approval.policySnapshot);
    return {
      id: approval.id,
      type: approval.type,
      status: approval.status,
      taskTitle: approval.task?.title ?? null,
      action: text(request.action, approval.type),
      scope: text(request.scope ?? request.actionFingerprint, "当前项目范围"),
      policyReason: text(policy.reason ?? request.policyReason, "该操作需要人工审批"),
      requestedByActor: approval.requestedByActor,
      decisionReason: approval.decisionReason,
      decidedByUserId: approval.decidedByUserId,
      occurredAt: approval.decidedAt ?? approval.createdAt,
    };
  });
  const timeline: ProjectTimelineEntry[] = [
    ...decisions.map((decision): ProjectTimelineEntry => ({ id: decision.id, kind: "decision", title: decision.status === "pending" ? "等待项目决策" : "项目决策已记录", description: `${decision.action} · ${decision.status}`, actorLabel: decision.decidedByUserId ?? decision.requestedByActor, taskId: null, taskTitle: decision.taskTitle, occurredAt: decision.occurredAt })),
    ...events.map((event): ProjectTimelineEntry => ({ id: event.id, kind: "project_event", title: "项目状态事件", description: event.eventType, actorLabel: `${event.actorType}:${event.actorId}`, taskId: null, taskTitle: null, occurredAt: event.occurredAt })),
    ...activities.map((activity): ProjectTimelineEntry => ({ id: activity.id, kind: "task_activity", title: "任务动态", description: activity.message?.trim() || activity.type, actorLabel: activity.actor?.name ?? activity.actorType, taskId: activity.task.id, taskTitle: activity.task.title, occurredAt: activity.createdAt })),
  ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || left.id.localeCompare(right.id));

  return { project, canDecide, decisions, timeline };
}

export async function countProjectActivityFacts(projectId: string): Promise<number> {
  const [decisions, events, activities] = await Promise.all([
    prisma.approvalRequest.count({ where: { projectId } }),
    prisma.orchestrationEvent.count({ where: { aggregateType: "project", aggregateId: projectId } }),
    prisma.taskActivity.count({ where: { task: { projectId } } }),
  ]);
  return decisions + events + activities;
}
