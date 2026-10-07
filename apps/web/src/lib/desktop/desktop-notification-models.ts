import {
  desktopNotificationsResponseSchema,
  type DesktopNotificationItem,
  type DesktopNotificationReadRequest,
  type DesktopNotificationReadResponse,
  type DesktopNotificationsResponse,
} from "@humanthread/workbench-client";
import {
  markLoopNotificationIntentRead,
  type LoopNotificationIntentProjection,
} from "@humanthread/db";

import { listAccessibleProjectDocuments } from "../workbench/workbench-documents";
import {
  buildWorkbenchDocumentNotificationId,
  buildWorkbenchEventNotificationId,
  buildWorkbenchNotificationFeed,
  buildWorkbenchTaskNotificationId,
  collectWorkbenchNotificationIds,
  listAccessibleLoopNotificationIntents,
  projectLoopNotification as projectLoopWorkbenchNotification,
  type WorkbenchNotificationCurrentTask,
  type WorkbenchNotificationDocument,
  type WorkbenchNotificationFeedItem,
  type WorkbenchNotificationTimelineEvent,
} from "../workbench/workbench-notifications";
import {
  getReadWorkbenchNotificationIds,
  markWorkbenchNotificationRead,
} from "../workbench/workbench-notification-state";
import { getWorkbenchOverview } from "../workbench/workbench-overview";
import { resolveDesktopReadContext } from "./desktop-read-models";

export interface DesktopNotificationDependencies {
  resolveDesktopReadContext: typeof resolveDesktopReadContext;
  getWorkbenchOverview: typeof getWorkbenchOverview;
  listAccessibleProjectDocuments: typeof listAccessibleProjectDocuments;
  listAccessibleLoopNotificationIntents: typeof listAccessibleLoopNotificationIntents;
  getReadNotificationIds: typeof getReadWorkbenchNotificationIds;
  markNotificationRead: typeof markWorkbenchNotificationRead;
  markLoopNotificationRead: typeof markLoopNotificationIntentRead;
}

const DEFAULT_DEPENDENCIES: DesktopNotificationDependencies = {
  resolveDesktopReadContext,
  getWorkbenchOverview,
  listAccessibleProjectDocuments,
  listAccessibleLoopNotificationIntents,
  getReadNotificationIds: getReadWorkbenchNotificationIds,
  markNotificationRead: markWorkbenchNotificationRead,
  markLoopNotificationRead: markLoopNotificationIntentRead,
};

function dependenciesWith(
  overrides: Partial<DesktopNotificationDependencies>,
): DesktopNotificationDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function eventKind(type: string): DesktopNotificationItem["kind"] {
  return /agent|approval|run|loop/iu.test(type) ? "agent" : "task";
}

function desktopTone(value: WorkbenchNotificationFeedItem["tone"]): DesktopNotificationItem["tone"] {
  if (value === "blue") return "info";
  if (value === "default") return "neutral";
  return value;
}

export function projectLoopNotification(
  intent: LoopNotificationIntentProjection,
): DesktopNotificationItem {
  const projected = projectLoopWorkbenchNotification(intent);
  const target: DesktopNotificationItem["target"] = intent.approvalId
    ? {
        resourceType: "approval",
        resourceId: intent.approvalId,
        route: `/agents?approvalId=${encodeURIComponent(intent.approvalId)}`,
        label: "处理审批",
      }
    : {
        resourceType: "loop_run",
        resourceId: intent.loopRunId,
        route: `/loop-runs/${encodeURIComponent(intent.loopRunId)}`,
        label: "打开运行图",
      };
  return {
    id: projected.id,
    kind: "agent",
    title: projected.title,
    description: projected.description,
    occurredAt: intent.createdAt.toISOString(),
    timeLabel: projected.timeLabel,
    tone: intent.level === "critical"
      ? "danger"
      : intent.level === "action_required"
        ? "warning"
        : desktopTone(projected.tone),
    isUnread: projected.isUnread,
    target,
  };
}

const DESKTOP_NOTIFICATION_DESCRIPTION_MAX_LENGTH = 240;

function boundedDesktopNotificationDescription(parts: string[]): string {
  const value = parts
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join(" · ");
  if (value.length <= DESKTOP_NOTIFICATION_DESCRIPTION_MAX_LENGTH) return value;
  return `${value.slice(0, DESKTOP_NOTIFICATION_DESCRIPTION_MAX_LENGTH - 3)}...`;
}

function describeDesktopTimelineEvent(event: WorkbenchNotificationTimelineEvent): string {
  const parts = [event.task.title];
  if (!event.payload || typeof event.payload !== "object") {
    return boundedDesktopNotificationDescription(parts);
  }

  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.status === "string" && /^[a-z0-9][a-z0-9._:-]{0,31}$/iu.test(payload.status)) {
    parts.push(`状态：${payload.status}`);
  }
  if (typeof payload.exitCode === "number" && Number.isSafeInteger(payload.exitCode)) {
    parts.push(`退出码：${payload.exitCode}`);
  }
  if (
    typeof payload.durationSeconds === "number"
    && Number.isFinite(payload.durationSeconds)
    && payload.durationSeconds >= 0
  ) {
    parts.push(`耗时：${payload.durationSeconds}s`);
  }

  return boundedDesktopNotificationDescription(parts);
}

function projectDesktopNotificationFeed(input: {
  feed: ReturnType<typeof buildWorkbenchNotificationFeed>;
  currentTask: WorkbenchNotificationCurrentTask | null;
  timelineEvents: WorkbenchNotificationTimelineEvent[];
  documents: WorkbenchNotificationDocument[];
  loopNotifications: LoopNotificationIntentProjection[];
}): DesktopNotificationsResponse["data"] {
  const currentTaskByNotificationId = new Map(
    input.currentTask
      ? [[buildWorkbenchTaskNotificationId(input.currentTask.task.id), input.currentTask]]
      : [],
  );
  const eventByNotificationId = new Map(input.timelineEvents.map((event) => [
    buildWorkbenchEventNotificationId(event.id),
    event,
  ]));
  const documentByNotificationId = new Map(input.documents.map((document) => [
    buildWorkbenchDocumentNotificationId(document.id),
    document,
  ]));
  const loopNotificationById = new Map(input.loopNotifications.map((notification) => [
    notification.id,
    notification,
  ]));

  const items = input.feed.items.map((item): DesktopNotificationItem => {
    const loopNotification = loopNotificationById.get(item.id);
    if (loopNotification) return projectLoopNotification(loopNotification);

    const currentTask = currentTaskByNotificationId.get(item.id);
    if (currentTask) {
      const taskId = currentTask.task.id;
      return {
        id: item.id,
        kind: "task",
        title: item.title,
        description: boundedDesktopNotificationDescription([
          currentTask.project.name,
          currentTask.workflow.title,
          currentTask.task.status,
        ]),
        occurredAt: null,
        timeLabel: item.timeLabel,
        tone: desktopTone(item.tone),
        isUnread: item.isUnread,
        target: {
          resourceType: "task",
          resourceId: taskId,
          route: `/tasks/${encodeURIComponent(taskId)}`,
          label: "打开任务",
        },
      };
    }

    const event = eventByNotificationId.get(item.id);
    if (event) {
      const taskId = event.task.id;
      return {
        id: item.id,
        kind: eventKind(event.type),
        title: item.title,
        description: describeDesktopTimelineEvent(event),
        occurredAt: event.createdAt.toISOString(),
        timeLabel: item.timeLabel,
        tone: desktopTone(item.tone),
        isUnread: item.isUnread,
        target: {
          resourceType: "task",
          resourceId: taskId,
          route: `/tasks/${encodeURIComponent(taskId)}`,
          label: "打开任务",
        },
      };
    }

    const document = documentByNotificationId.get(item.id);
    if (document) {
      return {
        id: item.id,
        kind: "document",
        title: item.title,
        description: boundedDesktopNotificationDescription([
          document.projectName,
          document.title,
          document.path,
        ]),
        occurredAt: document.updatedAt.toISOString(),
        timeLabel: item.timeLabel,
        tone: desktopTone(item.tone),
        isUnread: item.isUnread,
        target: {
          resourceType: "document",
          resourceId: document.id,
          route: `/documents/${encodeURIComponent(document.id)}`,
          label: "打开文档",
        },
      };
    }

    throw new Error("Notification target unavailable");
  });

  return { summary: input.feed.summary, items };
}

export async function readDesktopNotifications(
  request: Request,
  dependencyOverrides: Partial<DesktopNotificationDependencies> = {},
): Promise<DesktopNotificationsResponse["data"]> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const context = await dependencies.resolveDesktopReadContext(request);
  const selectedSpaceScope = {
    userId: context.actor.userId,
    ownerType: context.space.kind,
    ...(context.space.companyId ? { companyId: context.space.companyId } : {}),
  } as const;
  const [overview, documents, loopNotifications] = await Promise.all([
    dependencies.getWorkbenchOverview({
      teamId: context.workbench.teamId,
      ...selectedSpaceScope,
    }),
    dependencies.listAccessibleProjectDocuments(selectedSpaceScope),
    dependencies.listAccessibleLoopNotificationIntents(selectedSpaceScope),
  ]);
  const notificationIds = collectWorkbenchNotificationIds({
    currentTask: overview.currentTask,
    timelineEvents: overview.timeline.events,
    documents,
  });
  const readNotificationIds = await dependencies.getReadNotificationIds({
    userId: context.actor.userId,
    notificationIds,
  });
  const feed = buildWorkbenchNotificationFeed({
    currentTask: overview.currentTask,
    timelineEvents: overview.timeline.events,
    documents,
    loopNotifications,
    loopChannel: "desktop",
    readNotificationIds,
  });
  const data = projectDesktopNotificationFeed({
    feed,
    currentTask: overview.currentTask,
    timelineEvents: overview.timeline.events,
    documents,
    loopNotifications,
  });

  return desktopNotificationsResponseSchema.parse({ ok: true, data }).data;
}

interface DesktopNotificationWriteDependencies {
  resolveDesktopReadContext: typeof resolveDesktopReadContext;
  readDesktopNotifications: typeof readDesktopNotifications;
  markNotificationRead: typeof markWorkbenchNotificationRead;
  markLoopNotificationRead: typeof markLoopNotificationIntentRead;
}

const DEFAULT_WRITE_DEPENDENCIES: DesktopNotificationWriteDependencies = {
  resolveDesktopReadContext,
  readDesktopNotifications,
  markNotificationRead: markWorkbenchNotificationRead,
  markLoopNotificationRead: markLoopNotificationIntentRead,
};

function writeDependenciesWith(
  overrides: Partial<DesktopNotificationWriteDependencies>,
): DesktopNotificationWriteDependencies {
  return { ...DEFAULT_WRITE_DEPENDENCIES, ...overrides };
}

export async function markDesktopNotificationRead(
  request: Request,
  notificationId: string,
  input: DesktopNotificationReadRequest,
  dependencyOverrides: Partial<DesktopNotificationWriteDependencies> = {},
): Promise<DesktopNotificationReadResponse["result"]> {
  const id = notificationId.trim();
  const dependencies = writeDependenciesWith(dependencyOverrides);
  const context = await dependencies.resolveDesktopReadContext(request);
  const data = await dependencies.readDesktopNotifications(request, {
    resolveDesktopReadContext: async () => context,
  });

  if (!id || !data.items.some((item) => item.id === id)) {
    throw new Error("Notification not found");
  }

  void input.commandId;
  if (id.startsWith("loop-notification:")) {
    await dependencies.markLoopNotificationRead({
      recipientUserId: context.actor.userId,
      notificationId: id,
    });
  } else {
    await dependencies.markNotificationRead({
      userId: context.actor.userId,
      notificationId: id,
    });
  }

  return { notificationId: id, isUnread: false };
}
