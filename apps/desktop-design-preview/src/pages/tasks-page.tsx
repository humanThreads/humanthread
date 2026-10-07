import {
  desktopTaskCollectionResponseSchema,
  desktopTaskDetailResponseSchema,
  type DesktopTask,
} from "@humanthread/workbench-client";
import { CalendarDays, Columns3, List, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { usePreviewReadModel } from "../session/preview-session";
import { MarkdownPreview } from "../ui/markdown-preview";
import { MonthCalendar } from "../ui/month-calendar";
import { Pagination, type PaginationState } from "../ui/pagination";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader, Toolbar } from "../ui/primitives";

type TaskView = "list" | "board" | "calendar";

function parseView(value: string | null): TaskView {
  return value === "board" || value === "calendar" ? value : "list";
}

function statusTone(category: string) {
  if (category === "completed") return "success" as const;
  if (category === "cancelled") return "neutral" as const;
  if (category === "in_review") return "warning" as const;
  if (category === "in_progress") return "info" as const;
  return "neutral" as const;
}

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    searchParams.get("taskId"),
  );
  const view = parseView(searchParams.get("view"));
  const relation = searchParams.get("relation") ?? "all";
  const status = searchParams.get("status") ?? "";
  const search = searchParams.get("search") ?? "";
  const page = Math.max(Number.parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const pageSize = Math.min(
    Math.max(Number.parseInt(searchParams.get("pageSize") ?? "20", 10) || 20, 1),
    100,
  );
  const parameters = useMemo(() => ({
    view,
    relation,
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
    group: "status",
    sort: "updated_desc",
    ...(view === "list" ? { page, pageSize } : { page: 1, pageSize: 100 }),
  }), [page, pageSize, relation, search, status, view]);
  const query = usePreviewReadModel({
    domain: "tasks",
    endpoint: "/api/desktop/tasks",
    parameters,
    schema: desktopTaskCollectionResponseSchema,
  });
  const detailQuery = usePreviewReadModel({
    domain: "task-detail",
    endpoint: `/api/desktop/tasks/${encodeURIComponent(selectedTaskId ?? "inactive")}`,
    parameters: selectedTaskId ? { taskId: selectedTaskId } : {},
    enabled: Boolean(selectedTaskId),
    schema: desktopTaskDetailResponseSchema,
  });
  const collection = query.data?.data.collection;
  const currentPage = collection?.page ?? page;
  const currentPageSize = collection?.pageSize ?? pageSize;
  const total = collection?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / currentPageSize));
  const taskPagination: PaginationState<DesktopTask> = {
    items: collection?.listRows ?? [],
    page: currentPage,
    pageCount,
    pageSize: currentPageSize,
    total,
    firstItem: total === 0 ? 0 : (currentPage - 1) * currentPageSize + 1,
    lastItem: Math.min(currentPage * currentPageSize, total),
    setPage: (nextPage) => updateParam("page", String(nextPage)),
    setPageSize: (nextPageSize) => {
      const next = new URLSearchParams(searchParams);
      next.set("pageSize", String(nextPageSize));
      next.delete("page");
      setSearchParams(next, { replace: true });
    },
  };

  function updateParam(key: string, value?: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="page-stack">
      <PageHeader
        actions={<StatusPill tone="warning">只读预览</StatusPill>}
        description="保持筛选条件，在列表、看板和日历之间切换。"
        title="任务"
      />
      <section className="surface-panel task-workspace">
        <Toolbar
          actions={(
            <div className="segmented-control" aria-label="任务视图">
              <button aria-pressed={view === "list"} onClick={() => updateParam("view", "list")} type="button"><List aria-hidden="true" size={14} />列表</button>
              <button aria-pressed={view === "board"} onClick={() => updateParam("view", "board")} type="button"><Columns3 aria-hidden="true" size={14} />看板</button>
              <button aria-pressed={view === "calendar"} onClick={() => updateParam("view", "calendar")} type="button"><CalendarDays aria-hidden="true" size={14} />日历</button>
            </div>
          )}
        >
          <label className="inline-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="搜索任务"
              onChange={(event) => updateParam("search", event.target.value)}
              placeholder="搜索任务"
              value={search}
            />
          </label>
          <label className="compact-control">
            <span>关系</span>
            <select aria-label="任务关系" onChange={(event) => updateParam("relation", event.target.value)} value={relation}>
              <option value="all">全部</option>
              <option value="assigned">我负责的</option>
              <option value="blocked">已阻塞</option>
              <option value="overdue">已逾期</option>
            </select>
          </label>
          <label className="compact-control">
            <span>状态</span>
            <select aria-label="任务状态" onChange={(event) => updateParam("status", event.target.value)} value={status}>
              <option value="">全部状态</option>
              <option value="todo">待开始</option>
              <option value="in_progress">进行中</option>
              <option value="in_review">待评审</option>
              <option value="completed">已完成</option>
            </select>
          </label>
        </Toolbar>
        <AsyncState
          empty={Boolean(collection && collection.listRows.length === 0)}
          emptyDescription="尝试调整关系、状态或搜索条件。"
          error={query.error instanceof Error ? query.error.message : null}
          label="正在加载任务"
          onRetry={() => void query.refetch()}
          status={query.isPending ? "pending" : query.isError ? "error" : "success"}
        >
          {collection ? (
            <div className="task-view-canvas">
              {view === "list" ? (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>标识</th><th>任务</th><th>状态</th><th>负责人</th><th>优先级</th><th>更新时间</th></tr></thead>
                    <tbody>
                      {taskPagination.items.map((task) => (
                        <tr key={task.id}>
                          <td className="mono-cell">{task.shortId ?? task.id.slice(0, 8)}</td>
                          <td>
                            <button className="table-task-link" onClick={() => setSelectedTaskId(task.id)} type="button">
                              {task.title}
                            </button>
                          </td>
                          <td><StatusPill tone={statusTone(task.statusCategory)}>{task.status.name}</StatusPill></td>
                          <td>{task.assignee?.name ?? "未分配"}</td>
                          <td>{task.priority <= 1 ? "高" : task.priority === 2 ? "中" : "低"}</td>
                          <td>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(task.updatedAt))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {view === "list" ? <Pagination label="任务列表分页" pagination={taskPagination} /> : null}
              {view === "board" ? (
                <div className="task-board">
                  {collection.boardGroups.map((group) => (
                    <section key={group.key}>
                      <header><strong>{group.key}</strong><span>{group.tasks.length}</span></header>
                      {group.tasks.map((task) => (
                        <button key={task.id} onClick={() => setSelectedTaskId(task.id)} type="button">
                          <strong>{task.title}</strong>
                          <span>{task.project?.name ?? "无项目"} · {task.assignee?.name ?? "未分配"}</span>
                        </button>
                      ))}
                    </section>
                  ))}
                </div>
              ) : null}
              {view === "calendar" ? (
                <MonthCalendar
                  entries={collection.calendar.entries.map((entry) => ({
                    id: `${entry.taskId}-${entry.kind}`,
                    dateKey: entry.dateKey,
                    title: entry.title,
                    kind: entry.kind,
                    overdue: entry.overdue,
                    taskId: entry.taskId,
                  }))}
                  {...(collection.calendar.entries[0]?.dateKey
                    ? { initialMonth: collection.calendar.entries[0].dateKey.slice(0, 7) }
                    : {})}
                  onOpenTask={setSelectedTaskId}
                />
              ) : null}
            </div>
          ) : null}
        </AsyncState>
      </section>

      {selectedTaskId ? (
        <aside aria-label="任务详情" className="detail-drawer" role="dialog">
          <SurfaceHeader
            actions={<button aria-label="关闭任务详情" className="icon-button" onClick={() => setSelectedTaskId(null)} type="button"><X aria-hidden="true" size={17} /></button>}
            title="任务详情"
          />
          <AsyncState
            error={detailQuery.error instanceof Error ? detailQuery.error.message : null}
            label="正在加载任务详情"
            onRetry={() => void detailQuery.refetch()}
            status={detailQuery.isPending ? "pending" : detailQuery.isError ? "error" : "success"}
          >
            {detailQuery.data ? (
              <div className="drawer-content">
                <h2>{detailQuery.data.data.detail.task.title}</h2>
                <div className="inline-meta">
                  <StatusPill tone={statusTone(detailQuery.data.data.detail.task.statusCategory)}>{detailQuery.data.data.detail.task.status.name}</StatusPill>
                  <span>{detailQuery.data.data.detail.task.project?.name ?? "无项目"}</span>
                </div>
                <MarkdownPreview markdown={detailQuery.data.data.detail.task.contentMarkdown} />
                <div className="read-only-note">设计预览只读，编辑、状态变更和执行命令均未启用。</div>
              </div>
            ) : null}
          </AsyncState>
        </aside>
      ) : null}
    </div>
  );
}
