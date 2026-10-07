import {
  workbenchQueryKey,
  type DesktopNotificationItem,
  type WorkbenchContextIdentity,
} from "@humanthread/workbench-client";

export type NotificationReadFilter = "all" | "unread";
export type NotificationKindFilter =
  | "all"
  | "task"
  | "agent"
  | "document"
  | "system";

export interface NotificationQuery {
  itemId?: string;
  read: NotificationReadFilter;
  kind: NotificationKindFilter;
}

const READ_FILTERS = new Set<NotificationReadFilter>(["all", "unread"]);
const KIND_FILTERS = new Set<NotificationKindFilter>([
  "all",
  "task",
  "agent",
  "document",
  "system",
]);

export function parseNotificationQuery(search: URLSearchParams): NotificationQuery {
  const itemId = search.get("item")?.trim();
  const requestedRead = search.get("read")?.trim() as NotificationReadFilter | undefined;
  const requestedKind = search.get("kind")?.trim() as NotificationKindFilter | undefined;

  return {
    ...(itemId ? { itemId } : {}),
    read: requestedRead && READ_FILTERS.has(requestedRead) ? requestedRead : "all",
    kind: requestedKind && KIND_FILTERS.has(requestedKind) ? requestedKind : "all",
  };
}

export function buildNotificationSearch(query: NotificationQuery): URLSearchParams {
  const search = new URLSearchParams();
  if (query.itemId) search.set("item", query.itemId);
  search.set("read", query.read);
  search.set("kind", query.kind);
  return search;
}

export function filterNotifications(
  items: DesktopNotificationItem[],
  query: Pick<NotificationQuery, "read" | "kind">,
): DesktopNotificationItem[] {
  return items.filter((item) => (
    (query.read === "all" || item.isUnread)
    && (query.kind === "all" || item.kind === query.kind)
  ));
}

export function notificationQueryKey(context: WorkbenchContextIdentity) {
  return workbenchQueryKey(context, "notifications");
}

export function createNotificationCommandMetadata() {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { commandId: `desktop:notification:read:${id}` };
}
