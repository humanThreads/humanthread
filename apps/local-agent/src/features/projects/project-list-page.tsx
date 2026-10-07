import {
  desktopProjectCollectionResponseSchema,
  type DesktopProjectSummary,
} from "@humanthread/workbench-client";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useDesktopSession } from "../../session/session-provider";
import { Pagination, usePaginatedItems } from "../../ui/pagination";
import {
  buildProjectCollectionSearch,
  parseProjectCollectionQuery,
  projectCollectionQueryKey,
  type ProjectCollectionQuery,
} from "./project-queries";

const HEALTH_LABELS: Record<DesktopProjectSummary["health"], string> = {
  healthy: "正常",
  at_risk: "有风险",
  blocked: "受阻",
  complete: "已完成",
  unknown: "待评估",
};

function dateLabel(value: string | null): string {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" })
    .format(new Date(value));
}

export function ProjectList(props: { projects: DesktopProjectSummary[] }) {
  if (props.projects.length === 0) {
    return <div className="project-empty-state">当前工作空间没有匹配的项目</div>;
  }

  return (
    <div className="project-list-wrap">
      <table aria-label="项目列表" className="project-list-table">
        <thead>
          <tr>
            <th>项目</th>
            <th>负责人</th>
            <th>健康度</th>
            <th>进度</th>
            <th>任务</th>
            <th>下一里程碑</th>
            <th>更新</th>
            <th>本地配置</th>
          </tr>
        </thead>
        <tbody>
          {props.projects.map((project) => (
            <tr key={project.id}>
              <td>
                <Link className="project-name-link" to={`/projects/${encodeURIComponent(project.id)}`}>
                  <span>
                    <h2>{project.name}</h2>
                    <small>{project.spaceLabel}</small>
                  </span>
                  <p>{project.objective ?? "尚未定义项目目标"}</p>
                </Link>
              </td>
              <td>{project.owner?.name ?? "未设置"}</td>
              <td><span className={`project-health project-health-${project.health}`}>{HEALTH_LABELS[project.health]}</span></td>
              <td>
                <div className="project-progress-cell">
                  <span>里程碑 {project.progress.completed} / {project.progress.total}</span>
                  <i><span style={{ width: `${project.progress.percent}%` }} /></i>
                </div>
              </td>
              <td>
                <div className="project-task-links">
                  <Link to={`/tasks?project=${encodeURIComponent(project.id)}`}>进行中 {project.taskCounts.open}</Link>
                  <Link to={`/tasks?project=${encodeURIComponent(project.id)}&relation=blocked`}>
                    已阻塞 {project.taskCounts.blocked}
                  </Link>
                </div>
              </td>
              <td>
                <span className="project-milestone-cell">
                  {project.nextMilestone?.name ?? "暂无"}
                  <small>{dateLabel(project.nextMilestone?.targetAt ?? null)}</small>
                </span>
              </td>
              <td>{dateLabel(project.updatedAt)}</td>
              <td>
                <div className="project-row-actions">
                  <Link className="project-detail-link" to={`/projects/${encodeURIComponent(project.id)}`}>查看详情</Link>
                  <Link className="project-loop-model-link" to={`/projects/${encodeURIComponent(project.id)}/loops/models`}>配置 Loop 模型</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="project-mobile-list">
        {props.projects.map((project) => (
          <div key={project.id}>
            <Link to={`/projects/${encodeURIComponent(project.id)}`}>
              <span><strong>{project.name}</strong><small>{project.owner?.name ?? "未设置负责人"}</small></span>
              <p>{project.objective ?? "尚未定义项目目标"}</p>
              <footer>
                <span className={`project-health project-health-${project.health}`}><CircleAlert size={13} />{HEALTH_LABELS[project.health]}</span>
                <span>里程碑 {project.progress.completed} / {project.progress.total}</span>
              </footer>
            </Link>
            <div className="project-row-actions">
              <Link className="project-detail-link" to={`/projects/${encodeURIComponent(project.id)}`}>查看详情</Link>
              <Link className="project-loop-model-link" to={`/projects/${encodeURIComponent(project.id)}/loops/models`}>配置 Loop 模型</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function routeSearch(query: ProjectCollectionQuery): URLSearchParams {
  const search = buildProjectCollectionSearch(query, "unused");
  search.delete("space");
  return search;
}

export function ProjectListPage() {
  const session = useDesktopSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => parseProjectCollectionQuery(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(query.search);
  const projectsQuery = useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context
      ? projectCollectionQueryKey(session.context, query)
      : ["desktop", "projects", "disabled"],
    queryFn: async () => {
      if (!session.client || !session.context) throw new Error("桌面会话不可用");
      const search = buildProjectCollectionSearch(query, session.context.spaceKey);
      return session.client.request(
        `/api/desktop/projects?${search.toString()}`,
        desktopProjectCollectionResponseSchema,
      );
    },
  });
  const pagination = usePaginatedItems(projectsQuery.data?.data.projects ?? [], {
    initialPageSize: 20,
    resetKey: JSON.stringify(query),
  });

  function updateQuery(changes: Partial<ProjectCollectionQuery>) {
    setSearchParams(routeSearch({ ...query, ...changes }), { replace: true });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateQuery({ search: searchDraft.trim() });
  }

  if (projectsQuery.isPending) {
    return <div aria-label="正在加载项目" className="feature-loading-state project-loading-state" />;
  }
  if (projectsQuery.isError) {
    return <p className="feature-error-state" role="alert">{projectsQuery.error.message}</p>;
  }

  return (
    <div className="project-workspace">
      <header className="project-list-toolbar">
        <div><strong>项目空间</strong><span>{projectsQuery.data.data.projects.length} 个项目</span></div>
        <form onSubmit={submitSearch} role="search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="搜索项目"
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="搜索名称或目标"
            value={searchDraft}
          />
        </form>
        <select
          aria-label="项目健康度"
          onChange={(event) => updateQuery({ health: event.target.value as ProjectCollectionQuery["health"] })}
          value={query.health}
        >
          <option value="all">全部健康度</option>
          <option value="healthy">正常</option>
          <option value="at_risk">有风险</option>
          <option value="blocked">受阻</option>
          <option value="complete">已完成</option>
        </select>
      </header>
      <ProjectList projects={pagination.items} />
      <Pagination label="项目列表分页" pagination={pagination} />
    </div>
  );
}
