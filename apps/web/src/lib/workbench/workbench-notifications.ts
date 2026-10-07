import {
  buildAccessibleProjectWhere,
  listLoopNotificationIntents,
  prisma,
  type LoopNotificationIntentProjection,
} from "@humanthread/db";

import { describeWorkbenchTimelinePayload } from "./workbench-timeline";

export interface WorkbenchNotificationCurrentTask {
  task: {
    id: string;
    status: string;
    title: string;
  };
  workflow: {
    id: string;
    title: string;
    status: string;
    currentStepKey: string;
  };
  project: {
    id: string;
    name: string;
  };
}

export interface WorkbenchNotificationTimelineEvent {
  id: string;
  workflowInstanceId: string;
  type: string;
  message: string | null;
  payload: unknown;
  createdAt: Date;
  task: {
    id: string;
    title: string;
    status: string;
    stepTemplateId: string;
  };
}

export interface WorkbenchNotificationDocument {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  path: string;
  version: number;
  updatedAt: Date;
}

export interface WorkbenchNotificationFeedItem {
  id: string;
  title: string;
  description: string;
  href: string;
  openHref: string;
  tone: "default" | "success" | "warning" | "blue";
  timeLabel: string;
  isUnread: boolean;
}

export interface WorkbenchNotificationFeedResult {
  summary: {
    unreadCount: number;
    todayCount: number;
  };
  items: WorkbenchNotificationFeedItem[];
}

interface LoopNotificationAccessDependencies {
  db: {
    project: {
      findMany: typeof prisma.project.findMany;
    };
  };
  listLoopNotificationIntents: typeof listLoopNotificationIntents;
}

const LOOP_NOTIFICATION_ACCESS_DEPENDENCIES: LoopNotificationAccessDependencies = {
  db: prisma,
  listLoopNotificationIntents,
};

export interface TaskActivityNotificationSource {
  id: string;
  taskId: string;
  taskTitle: string;
  type: string;
  actorUserId: string | null;
  message: string | null;
  payload: unknown;
  createdAt: Date;
  recipientUserIds: string[];
  followerUserIds: string[];
}

function getNotificationTone(input: string): "default" | "success" | "warning" | "blue" {
  if (input.includes("blocked") || input.includes("interrupt")) {
    return "warning";
  }

  if (input.includes("complete") || input.includes("completed")) {
    return "success";
  }

  if (input.includes("update") || input.includes("doc")) {
    return "blue";
  }

  return "default";
}

function formatNotificationTimeLabel(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function buildWorkbenchTaskNotificationId(taskId: string): string {
  return `task:${taskId}`;
}

export function buildWorkbenchEventNotificationId(eventId: string): string {
  return `event:${eventId}`;
}

export function buildWorkbenchDocumentNotificationId(documentId: string): string {
  return `document:${documentId}`;
}

export function buildWorkbenchNotificationOpenHref(input: {
  notificationId: string;
  href: string;
}): string {
  return `/notifications/open?notificationId=${encodeURIComponent(
    input.notificationId,
  )}&redirectTo=${encodeURIComponent(input.href)}`;
}

export function collectWorkbenchNotificationIds(input: {
  currentTask: WorkbenchNotificationCurrentTask | null;
  timelineEvents: WorkbenchNotificationTimelineEvent[];
  documents: WorkbenchNotificationDocument[];
}): string[] {
  const ids: string[] = [];

  if (input.currentTask) {
    ids.push(buildWorkbenchTaskNotificationId(input.currentTask.task.id));
  }

  for (const event of input.timelineEvents) {
    ids.push(buildWorkbenchEventNotificationId(event.id));
  }

  for (const document of input.documents) {
    ids.push(buildWorkbenchDocumentNotificationId(document.id));
  }

  return ids;
}

export async function listAccessibleLoopNotificationIntents(input: {
  userId: string;
  companyId?: string;
  ownerType?: "company" | "personal";
  limit?: number;
  dependencies?: LoopNotificationAccessDependencies;
}): Promise<LoopNotificationIntentProjection[]> {
  const dependencies = input.dependencies ?? LOOP_NOTIFICATION_ACCESS_DEPENDENCIES;
  const projects = await dependencies.db.project.findMany({
    where: buildAccessibleProjectWhere({
      userId: input.userId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.ownerType ? { ownerType: input.ownerType } : {}),
    }),
    select: { id: true },
  });
  return dependencies.listLoopNotificationIntents({
    recipientUserId: input.userId,
    projectIds: projects.map((project) => project.id),
    limit: input.limit ?? 100,
  });
}

function loopNotificationTone(
  level: LoopNotificationIntentProjection["level"],
): WorkbenchNotificationFeedItem["tone"] {
  if (level === "action_required" || level === "critical") return "warning";
  if (level === "important") return "blue";
  return "default";
}

export function projectLoopNotification(
  intent: LoopNotificationIntentProjection,
): WorkbenchNotificationFeedItem {
  const href = intent.approvalId
    ? `/agents?approvalId=${encodeURIComponent(intent.approvalId)}`
    : `/loop-runs/${encodeURIComponent(intent.loopRunId)}`;
  return {
    id: intent.id,
    title: intent.title,
    description: intent.description,
    href,
    openHref: buildWorkbenchNotificationOpenHref({ notificationId: intent.id, href }),
    tone: loopNotificationTone(intent.level),
    timeLabel: formatNotificationTimeLabel(intent.createdAt),
    isUnread: intent.readAt === null,
  };
}

export function buildWorkbenchNotificationFeed(input: {
  currentTask: WorkbenchNotificationCurrentTask | null;
  timelineEvents: WorkbenchNotificationTimelineEvent[];
  documents: WorkbenchNotificationDocument[];
  loopNotifications?: LoopNotificationIntentProjection[];
  loopChannel?: "in_app" | "desktop";
  readNotificationIds?: Set<string>;
  now?: Date;
}): WorkbenchNotificationFeedResult {
  const items: WorkbenchNotificationFeedItem[] = [];
  const readNotificationIds = input.readNotificationIds ?? new Set<string>();
  const now = input.now ?? new Date();
  let todayCount = 0;

  for (const notification of [...(input.loopNotifications ?? [])]
    .filter((item) => item.channels.includes(input.loopChannel ?? "in_app"))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())) {
    items.push(projectLoopNotification(notification));
    if (isSameLocalDay(notification.createdAt, now)) todayCount += 1;
  }

  if (input.currentTask) {
    const notificationId = buildWorkbenchTaskNotificationId(input.currentTask.task.id);
    const href = `/projects/${input.currentTask.project.id}`;
    items.push({
      id: notificationId,
      title: "当前任务",
      description: `${input.currentTask.project.name} · ${input.currentTask.workflow.title} · ${input.currentTask.task.status}`,
      href,
      openHref: buildWorkbenchNotificationOpenHref({
        notificationId,
        href,
      }),
      tone: getNotificationTone(input.currentTask.task.status),
      timeLabel: "当前",
      isUnread: !readNotificationIds.has(notificationId),
    });
    todayCount += 1;
  }

  for (const event of [...input.timelineEvents].reverse().slice(0, 5)) {
    const payloadLines = describeWorkbenchTimelinePayload(event.payload);
    const notificationId = buildWorkbenchEventNotificationId(event.id);
    const href = `/workflows/${event.workflowInstanceId}`;
    items.push({
      id: notificationId,
      title: event.message ?? event.type,
      description:
        [event.task.title, ...payloadLines].filter(Boolean).join(" · ") || event.type,
      href,
      openHref: buildWorkbenchNotificationOpenHref({
        notificationId,
        href,
      }),
      tone: getNotificationTone(event.type),
      timeLabel: formatNotificationTimeLabel(event.createdAt),
      isUnread: !readNotificationIds.has(notificationId),
    });
    if (isSameLocalDay(event.createdAt, now)) {
      todayCount += 1;
    }
  }

  for (const document of [...input.documents]
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 5)) {
    const notificationId = buildWorkbenchDocumentNotificationId(document.id);
    const href = `/projects/${document.projectId}/documents/${document.id}`;
    items.push({
      id: notificationId,
      title: "项目文档已更新",
      description: `${document.projectName} · ${document.title} · ${document.path}`,
      href,
      openHref: buildWorkbenchNotificationOpenHref({
        notificationId,
        href,
      }),
      tone: "blue",
      timeLabel: formatNotificationTimeLabel(document.updatedAt),
      isUnread: !readNotificationIds.has(notificationId),
    });
    if (isSameLocalDay(document.updatedAt, now)) {
      todayCount += 1;
    }
  }

  return {
    summary: {
      unreadCount: items.filter((item) => item.isUnread).length,
      todayCount,
    },
    items,
  };
}

export async function projectTaskActivityNotifications(input: {
  recipientUserId: string;
  activities: TaskActivityNotificationSource[];
  followerUpdatesEnabled?: boolean;
  canReadTask(input: { userId: string; taskId: string }): Promise<boolean>;
}): Promise<WorkbenchNotificationFeedItem[]> {
  const items: WorkbenchNotificationFeedItem[] = [];
  for (const activity of input.activities) {
    if (activity.actorUserId === input.recipientUserId) continue;
    const explicitlyAddressed = activity.recipientUserIds.includes(input.recipientUserId);
    const following = activity.followerUserIds.includes(input.recipientUserId);
    if (!explicitlyAddressed && (!following || input.followerUpdatesEnabled === false)) continue;
    if (!await input.canReadTask({ userId: input.recipientUserId, taskId: activity.taskId })) continue;
    const notificationId = `task-activity:${activity.id}:${input.recipientUserId}`;
    const href = `/tasks/${activity.taskId}`;
    items.push({
      id: notificationId,
      title: activity.message ?? activity.type,
      description: activity.taskTitle,
      href,
      openHref: buildWorkbenchNotificationOpenHref({ notificationId, href }),
      tone: getNotificationTone(activity.type),
      timeLabel: formatNotificationTimeLabel(activity.createdAt),
      isUnread: true,
    });
  }
  return items;
}
