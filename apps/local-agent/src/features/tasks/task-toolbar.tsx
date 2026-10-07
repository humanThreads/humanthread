import { BookmarkPlus, CalendarDays, Columns3, List, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import type { TaskCollectionQuery, TaskRelation, TaskCollectionView } from "./task-queries";

const RELATIONS: Array<[TaskRelation, string]> = [
  ["all", "全部"],
  ["assigned", "分配给我"],
  ["created", "我创建的"],
  ["participating", "我参与的"],
  ["following", "我关注的"],
  ["overdue", "已逾期"],
  ["blocked", "已阻塞"],
  ["completed", "已完成"],
];

const VIEWS: Array<[TaskCollectionView, string, typeof List]> = [
  ["list", "列表", List],
  ["board", "看板", Columns3],
  ["calendar", "日历", CalendarDays],
];

export interface TaskSavedViewOption {
  id: string;
  name: string;
  filters?: unknown;
}

export function TaskToolbar(props: {
  query: TaskCollectionQuery;
  relationCounts: Record<string, number>;
  savedViews: TaskSavedViewOption[];
  total: number;
  writeEnabled: boolean;
  onChange: (changes: Partial<TaskCollectionQuery>) => void;
  onApplySavedView?: (view: TaskSavedViewOption) => void;
  onSaveView?: (name: string) => Promise<void>;
}) {
  const [searchDraft, setSearchDraft] = useState(props.query.search);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSearchDraft(props.query.search), [props.query.search]);

  function submitFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onChange({ search: searchDraft.trim() });
  }

  async function saveView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = viewName.trim();
    if (!name || !props.onSaveView) return;
    setPending(true);
    setError(null);
    try {
      await props.onSaveView(name);
      setViewName("");
      setSaveOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存视图失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="task-toolbar">
      <div className="task-saved-views">
        <span>保存视图</span>
        {props.savedViews.map((view) => (
          <button key={view.id} onClick={() => props.onApplySavedView?.(view)} type="button">
            {view.name}
          </button>
        ))}
        <button
          aria-label="保存当前视图"
          className="task-save-view-button"
          disabled={!props.writeEnabled || !props.onSaveView}
          onClick={() => setSaveOpen(true)}
          title="保存当前视图"
          type="button"
        >
          <BookmarkPlus aria-hidden="true" size={15} />
        </button>
        <strong>{props.total} 个任务</strong>
      </div>

      <div className="task-relations" aria-label="任务关系筛选">
        {RELATIONS.map(([key, label]) => (
          <button
            aria-pressed={props.query.relation === key}
            key={key}
            onClick={() => props.onChange({ relation: key })}
            type="button"
          >
            {label}{key === "all" ? "" : ` ${props.relationCounts[key] ?? 0}`}
          </button>
        ))}
      </div>

      <div className="task-filter-row">
        <form aria-label="筛选任务" onSubmit={submitFilter}>
          <label>
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="搜索任务"
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="搜索标题或内容"
              value={searchDraft}
            />
          </label>
          <select
            aria-label="状态筛选"
            onChange={(event) => props.onChange({
              status: event.target.value ? [event.target.value as TaskCollectionQuery["status"][number]] : [],
            })}
            value={props.query.status[0] ?? ""}
          >
            <option value="">全部状态</option>
            <option value="backlog">待规划</option>
            <option value="todo">待处理</option>
            <option value="in_progress">进行中</option>
            <option value="in_review">待验收</option>
            <option value="completed">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
          <select
            aria-label="排序方式"
            onChange={(event) => props.onChange({ sort: event.target.value as TaskCollectionQuery["sort"] })}
            value={props.query.sort}
          >
            <option value="updated_desc">最近更新</option>
            <option value="due_asc">截止时间</option>
            <option value="priority_desc">优先级</option>
            <option value="created_desc">创建时间</option>
          </select>
          {props.query.view === "board" ? (
            <select
              aria-label="看板分组"
              onChange={(event) => props.onChange({ group: event.target.value as TaskCollectionQuery["group"] })}
              value={props.query.group}
            >
              <option value="status">按状态</option>
              <option value="assignee">按负责人</option>
              <option value="priority">按优先级</option>
              <option value="project">按项目</option>
            </select>
          ) : null}
          <button aria-label="应用筛选" title="应用筛选" type="submit">
            <SlidersHorizontal aria-hidden="true" size={15} />
          </button>
        </form>
        <div className="task-view-tabs" aria-label="任务视图" role="tablist">
          {VIEWS.map(([key, label, Icon]) => (
            <button
              aria-label={label}
              aria-selected={props.query.view === key}
              key={key}
              onClick={() => props.onChange({ view: key })}
              role="tab"
              title={label}
              type="button"
            >
              <Icon aria-hidden="true" size={16} />
            </button>
          ))}
        </div>
      </div>

      {saveOpen ? (
        <div className="desktop-overlay" role="presentation">
          <section aria-label="保存当前视图" aria-modal="true" className="task-save-dialog" role="dialog">
            <header>
              <h2>保存当前视图</h2>
              <button aria-label="关闭保存视图" onClick={() => setSaveOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <form onSubmit={saveView}>
              <label className="desktop-field">
                <span>视图名称</span>
                <input autoFocus onChange={(event) => setViewName(event.target.value)} required value={viewName} />
              </label>
              {error ? <p role="alert">{error}</p> : null}
              <footer>
                <button disabled={pending} onClick={() => setSaveOpen(false)} type="button">取消</button>
                <button disabled={pending} type="submit">{pending ? "保存中" : "保存"}</button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
