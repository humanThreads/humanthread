import type {
  DesktopNotificationItem,
  DesktopNotificationsResponse,
} from "@humanthread/workbench-client";
import {
  ArrowLeft,
  ArrowUpRight,
  BellRing,
  Bot,
  Check,
  FileText,
  Inbox,
  ListTodo,
  RefreshCw,
} from "lucide-react";

import {
  filterNotifications,
  type NotificationKindFilter,
  type NotificationQuery,
} from "./notification-queries";
import { Pagination, usePaginatedItems } from "../../ui/pagination";

/*
 * THESIS: A quiet operational inbox, never a dashboard of decorative cards.
 * OWN-WORLD: Existing HumanThread surfaces, hairline divisions, teal focus, compact controls.
 * STORY: Scan signals, inspect context, then mark and open the authoritative resource.
 * FIRST VIEWPORT: Summary and filters above a stable list-detail split.
 * FORM: Dense desktop master-detail workbench with a narrow-window list/detail handoff.
 */

export interface NotificationWorkspaceProps {
  data: DesktopNotificationsResponse["data"];
  query: NotificationQuery;
  selected: DesktopNotificationItem | null;
  syncState: "syncing" | "cached" | null;
  writeEnabled: boolean;
  busyId: string | null;
  actionError: string | null;
  onQueryChange(query: NotificationQuery): void;
  onMarkRead(notificationId: string, openAfter: boolean): void;
  onOpen(route: string): void;
}

const READ_FILTERS = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
] as const;

const KIND_FILTERS = [
  { key: "all", label: "全部类型" },
  { key: "task", label: "任务" },
  { key: "agent", label: "Agent" },
  { key: "document", label: "文档" },
  { key: "system", label: "系统" },
] as const;

const KIND_LABELS: Record<DesktopNotificationItem["kind"], string> = {
  task: "任务",
  agent: "Agent",
  document: "文档",
  system: "系统",
};

function NotificationKindIcon(props: { kind: DesktopNotificationItem["kind"] }) {
  if (props.kind === "agent") return <Bot aria-hidden="true" size={16} />;
  if (props.kind === "document") return <FileText aria-hidden="true" size={16} />;
  if (props.kind === "task") return <ListTodo aria-hidden="true" size={16} />;
  return <BellRing aria-hidden="true" size={16} />;
}

export function NotificationWorkspace(props: NotificationWorkspaceProps) {
  const visibleItems = filterNotifications(props.data.items, props.query);
  const pagination = usePaginatedItems(visibleItems, {
    initialPageSize: 20,
    resetKey: `${props.query.read}:${props.query.kind}`,
  });
  const selected = props.selected;
  const busy = Boolean(selected && props.busyId === selected.id);
  const primaryDisabled = Boolean(
    selected && (busy || (selected.isUnread && !props.writeEnabled)),
  );
  const primaryLabel = selected?.isUnread && props.actionError
    ? "重试标记"
    : selected?.target.label;

  return (
    <div className="notification-workspace">
      <header className="notification-toolbar">
        <dl aria-label="通知摘要">
          <div><dt>未读</dt><dd>{props.data.summary.unreadCount}</dd></div>
          <div><dt>今日</dt><dd>{props.data.summary.todayCount}</dd></div>
        </dl>
        <div aria-label="读取状态" className="notification-read-tabs">
          {READ_FILTERS.map((filter) => (
            <button
              aria-pressed={props.query.read === filter.key}
              key={filter.key}
              onClick={() => props.onQueryChange({ ...props.query, read: filter.key })}
              type="button"
            >
              {filter.label} {filter.key === "all"
                ? props.data.items.length
                : props.data.summary.unreadCount}
            </button>
          ))}
        </div>
        <label className="notification-kind-filter">
          <span className="sr-only">通知类型</span>
          <select
            aria-label="通知类型"
            onChange={(event) => props.onQueryChange({
              ...props.query,
              kind: event.target.value as NotificationKindFilter,
            })}
            value={props.query.kind}
          >
            {KIND_FILTERS.map((filter) => (
              <option key={filter.key} value={filter.key}>{filter.label}</option>
            ))}
          </select>
        </label>
        {props.syncState ? (
          <span
            aria-live="polite"
            className="notification-sync-state"
            data-state={props.syncState}
            role="status"
          >
            <RefreshCw aria-hidden="true" size={13} />
            {props.syncState === "cached" ? "显示缓存通知" : "正在同步最新通知"}
          </span>
        ) : null}
      </header>

      <div
        className="notification-inbox"
        data-detail-open={Boolean(props.query.itemId && selected)}
      >
        <section className="notification-list" aria-label="通知列表">
          {pagination.items.map((item) => (
            <button
              aria-pressed={selected?.id === item.id}
              className="notification-row"
              data-tone={item.tone}
              key={item.id}
              onClick={() => props.onQueryChange({ ...props.query, itemId: item.id })}
              type="button"
            >
              <span className="notification-row-icon">
                <NotificationKindIcon kind={item.kind} />
                <span aria-hidden="true" className="notification-unread-dot" data-unread={item.isUnread} />
              </span>
              <span className="notification-row-copy">
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              <time dateTime={item.occurredAt ?? undefined}>{item.timeLabel}</time>
            </button>
          ))}
          {visibleItems.length === 0 ? (
            <div className="notification-empty-state">
              <Inbox aria-hidden="true" size={22} />
              <strong>当前筛选下没有通知</strong>
              <span>调整读取状态或通知类型后再查看。</span>
            </div>
          ) : null}
          <Pagination label="通知列表分页" pagination={pagination} />
        </section>

        <section className="notification-detail" aria-label="通知详情">
          {selected ? (
            <div className="notification-detail-content">
              <button
                aria-label="返回通知列表"
                className="notification-detail-back"
                onClick={() => props.onQueryChange({
                  read: props.query.read,
                  kind: props.query.kind,
                })}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={16} />
                返回通知列表
              </button>
              <header>
                <span className="notification-detail-kind">
                  <NotificationKindIcon kind={selected.kind} />
                  {KIND_LABELS[selected.kind]}
                </span>
                <span className="notification-detail-state" data-unread={selected.isUnread}>
                  {selected.isUnread ? "未读" : <><Check aria-hidden="true" size={13} />已读</>}
                </span>
              </header>
              <div className="notification-detail-copy">
                <h2>{selected.title}</h2>
                <p>{selected.description}</p>
                <time dateTime={selected.occurredAt ?? undefined}>{selected.timeLabel}</time>
              </div>
              {props.actionError ? (
                <p className="notification-action-error" role="alert">{props.actionError}</p>
              ) : null}
              <footer>
                <button
                  className="notification-primary-action"
                  disabled={primaryDisabled}
                  onClick={() => selected.isUnread
                    ? props.onMarkRead(selected.id, true)
                    : props.onOpen(selected.target.route)}
                  type="button"
                >
                  {props.actionError && selected.isUnread
                    ? <RefreshCw aria-hidden="true" size={15} />
                    : <ArrowUpRight aria-hidden="true" size={15} />}
                  {primaryLabel}
                </button>
                {selected.isUnread ? (
                  <button
                    className="notification-secondary-action"
                    disabled={!props.writeEnabled || busy}
                    onClick={() => props.onMarkRead(selected.id, false)}
                    type="button"
                  >
                    <Check aria-hidden="true" size={15} />
                    标记已读
                  </button>
                ) : null}
                {selected.isUnread && (!props.writeEnabled || props.actionError) ? (
                  <button
                    className="notification-direct-action"
                    onClick={() => props.onOpen(selected.target.route)}
                    type="button"
                  >
                    不标记，直接打开
                  </button>
                ) : null}
              </footer>
            </div>
          ) : (
            <div className="notification-detail-placeholder">
              <BellRing aria-hidden="true" size={24} />
              <strong>选择一条通知查看详情</strong>
              <span>通知会回到对应的任务、文档或项目。</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
