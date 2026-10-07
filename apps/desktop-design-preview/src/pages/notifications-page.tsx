import { desktopNotificationsResponseSchema } from "@humanthread/workbench-client";
import { Bell, CheckCircle2, Clock3 } from "lucide-react";
import { useMemo, useState } from "react";

import { usePreviewReadModel } from "../session/preview-session";
import { Pagination, usePaginatedItems } from "../ui/pagination";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader } from "../ui/primitives";

type NotificationFilter = "all" | "unread" | "task" | "agent" | "document";

export function NotificationsPage() {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = usePreviewReadModel({
    domain: "notifications",
    endpoint: "/api/desktop/notifications",
    schema: desktopNotificationsResponseSchema,
  });
  const items = query.data?.data.items ?? [];
  const filtered = useMemo(() => items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "unread") return item.isUnread;
    return item.kind === filter;
  }), [filter, items]);
  const pagination = usePaginatedItems(filtered, { initialPageSize: 20, resetKey: filter });
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="page-stack">
      <PageHeader
        actions={<StatusPill tone="warning">{query.data?.data.summary.unreadCount ?? 0} 条未读</StatusPill>}
        description="按未读、任务、Agent 和文档分组处理通知。"
        title="通知"
      />
      <AsyncState
        empty={query.isSuccess && items.length === 0}
        error={query.error instanceof Error ? query.error.message : null}
        label="正在加载通知"
        onRetry={() => void query.refetch()}
        status={query.isPending ? "pending" : query.isError ? "error" : "success"}
      >
        <section className="notification-workspace">
          <aside className="notification-list-panel">
            <SurfaceHeader title="通知列表" description={`${filtered.length} 条`} />
            <nav aria-label="通知筛选" className="notification-filters">
              {(["all", "unread", "task", "agent", "document"] as NotificationFilter[]).map((item) => (
                <button aria-current={filter === item ? "page" : undefined} key={item} onClick={() => setFilter(item)} type="button">{item === "all" ? "全部" : item === "unread" ? "未读" : item}</button>
              ))}
            </nav>
            <div className="notification-list">
              {pagination.items.map((item) => (
                <button aria-current={selected?.id === item.id ? "true" : undefined} key={item.id} onClick={() => setSelectedId(item.id)} type="button">
                  <span className="notification-icon">{item.kind === "agent" ? <Clock3 aria-hidden="true" size={15} /> : item.kind === "system" ? <Bell aria-hidden="true" size={15} /> : <CheckCircle2 aria-hidden="true" size={15} />}</span>
                  <span><strong>{item.title}</strong><small>{item.description}</small></span>
                  <time>{item.timeLabel}</time>
                </button>
              ))}
            </div>
            <Pagination label="通知列表分页" pagination={pagination} />
          </aside>
          <main className="notification-detail-panel">
            {selected ? (
              <>
                <SurfaceHeader title={selected.title} description={selected.description} actions={<StatusPill tone={selected.isUnread ? "warning" : "neutral"}>{selected.isUnread ? "未读" : "已读"}</StatusPill>} />
                <div className="notification-detail-content">
                  <dl className="definition-list">
                    <div><dt>类型</dt><dd>{selected.kind}</dd></div>
                    <div><dt>资源</dt><dd>{selected.target.label}</dd></div>
                    <div><dt>发生时间</dt><dd>{selected.timeLabel}</dd></div>
                  </dl>
                  <div className="read-only-note">设计预览不发送已读回执，也不会触发原生桌面通知。</div>
                </div>
              </>
            ) : <div className="empty-state"><strong>暂无通知</strong><p>当前筛选条件下没有通知。</p></div>}
          </main>
        </section>
      </AsyncState>
    </div>
  );
}
