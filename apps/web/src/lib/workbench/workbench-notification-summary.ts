import { listAccessibleProjectDocuments } from "./workbench-documents";
import { getWorkbenchOverview } from "./workbench-overview";
import {
  buildWorkbenchNotificationFeed,
  collectWorkbenchNotificationIds,
  listAccessibleLoopNotificationIntents,
} from "./workbench-notifications";
import { getReadWorkbenchNotificationIds } from "./workbench-notification-state";

export interface WorkbenchNotificationSummaryInput {
  teamId: string;
  userId: string;
  companyId?: string;
  ownerType?: "company" | "personal";
  now?: Date;
  dependencies?: {
    getWorkbenchOverview: typeof getWorkbenchOverview;
    listAccessibleProjectDocuments: typeof listAccessibleProjectDocuments;
    listAccessibleLoopNotificationIntents: typeof listAccessibleLoopNotificationIntents;
    getReadNotificationIds: typeof getReadWorkbenchNotificationIds;
  };
}

export interface WorkbenchNotificationSummaryResult {
  unreadCount: number;
  todayCount: number;
}

export function summarizeWorkbenchNotifications(input: {
  currentTask: Parameters<typeof buildWorkbenchNotificationFeed>[0]["currentTask"];
  timelineEvents: Parameters<typeof buildWorkbenchNotificationFeed>[0]["timelineEvents"];
  documents: Parameters<typeof buildWorkbenchNotificationFeed>[0]["documents"];
  loopNotifications?: Parameters<typeof buildWorkbenchNotificationFeed>[0]["loopNotifications"];
  readNotificationIds?: Set<string>;
  now?: Date;
}): WorkbenchNotificationSummaryResult {
  return buildWorkbenchNotificationFeed({
    currentTask: input.currentTask,
    timelineEvents: input.timelineEvents,
    documents: input.documents,
    ...(input.loopNotifications ? { loopNotifications: input.loopNotifications } : {}),
    ...(input.readNotificationIds ? { readNotificationIds: input.readNotificationIds } : {}),
    ...(input.now ? { now: input.now } : {}),
  }).summary;
}

export async function getWorkbenchNotificationSummary(
  input: WorkbenchNotificationSummaryInput,
): Promise<WorkbenchNotificationSummaryResult> {
  const dependencies = input.dependencies ?? {
    getWorkbenchOverview,
    listAccessibleProjectDocuments,
    listAccessibleLoopNotificationIntents,
    getReadNotificationIds: getReadWorkbenchNotificationIds,
  };

  const [overview, documents, loopNotifications] = await Promise.all([
    dependencies.getWorkbenchOverview({
      teamId: input.teamId,
      userId: input.userId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.ownerType ? { ownerType: input.ownerType } : {}),
    }),
    dependencies.listAccessibleProjectDocuments({
      userId: input.userId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.ownerType ? { ownerType: input.ownerType } : {}),
    }),
    dependencies.listAccessibleLoopNotificationIntents({
      userId: input.userId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.ownerType ? { ownerType: input.ownerType } : {}),
    }),
  ]);
  const readNotificationIds = await dependencies.getReadNotificationIds({
    userId: input.userId,
    notificationIds: collectWorkbenchNotificationIds({
      currentTask: overview.currentTask,
      timelineEvents: overview.timeline.events,
      documents,
    }),
  });

  return summarizeWorkbenchNotifications({
    currentTask: overview.currentTask,
    timelineEvents: overview.timeline.events,
    documents,
    loopNotifications,
    readNotificationIds,
    ...(input.now ? { now: input.now } : {}),
  });
}
