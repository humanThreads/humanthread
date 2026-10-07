import { desktopProjectDetailResponseSchema } from "@humanthread/workbench-client";
import { ArrowLeft, FolderGit2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { usePreviewReadModel } from "../session/preview-session";
import { Pagination, usePaginatedItems } from "../ui/pagination";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader, SurfacePanel } from "../ui/primitives";

type ProjectTab = "overview" | "roadmap" | "tasks" | "documents" | "risks" | "loops" | "settings";

const TABS: Array<{ key: ProjectTab; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "roadmap", label: "路线图" },
  { key: "tasks", label: "任务" },
  { key: "documents", label: "文档" },
  { key: "risks", label: "风险" },
  { key: "loops", label: "Loop 模型" },
  { key: "settings", label: "设置" },
];

export function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const [tab, setTab] = useState<ProjectTab>("overview");
  const query = usePreviewReadModel({
    domain: "project-detail",
    endpoint: `/api/desktop/projects/${encodeURIComponent(projectId)}`,
    parameters: { projectId },
    enabled: Boolean(projectId),
    schema: desktopProjectDetailResponseSchema,
  });
  const detail = query.data?.data.detail;
  const taskPagination = usePaginatedItems(detail?.tasks ?? [], { initialPageSize: 20 });
  const documentPagination = usePaginatedItems(detail?.documents ?? [], { initialPageSize: 20 });

  return (
    <div className="page-stack">
      <PageHeader
        actions={<Link className="secondary-button" to="/projects"><ArrowLeft aria-hidden="true" size={14} />返回项目</Link>}
        description={detail?.project.objective ?? "项目详情"}
        showTitle
        title={detail?.project.name ?? "项目"}
      />
      <AsyncState
        error={query.error instanceof Error ? query.error.message : null}
        label="正在加载项目详情"
        onRetry={() => void query.refetch()}
        status={query.isPending ? "pending" : query.isError ? "error" : "success"}
      >
        {detail ? (
          <>
            <section className="metric-strip" aria-label="项目指标">
              <div className="metric-item"><span>健康度</span><strong>{detail.project.health}</strong><small>{detail.health.nextAction}</small></div>
              <div className="metric-item"><span>开放任务</span><strong>{detail.taskSummary.open}</strong><small>阻塞 {detail.taskSummary.blocked}</small></div>
              <div className="metric-item"><span>里程碑</span><strong>{detail.project.progress.completed} / {detail.project.progress.total}</strong><small>{detail.health.currentStageName ?? "未进入阶段"}</small></div>
              <div className="metric-item"><span>资源</span><strong>{detail.resources.documents + detail.resources.members}</strong><small>文档与成员</small></div>
            </section>
            <SurfacePanel>
              <nav aria-label="项目详情视图" className="tab-strip">
                {TABS.map((item) => <button aria-current={tab === item.key ? "page" : undefined} key={item.key} onClick={() => setTab(item.key)} type="button">{item.label}</button>)}
              </nav>
              {tab === "overview" ? (
                <div className="project-overview">
                  <section><h2>项目目标</h2><p>{detail.project.objective ?? "尚未定义项目目标"}</p></section>
                  <section><h2>当前状态</h2><p>{detail.health.nextAction}</p><StatusPill tone={detail.project.health === "healthy" ? "success" : "warning"}>{detail.project.health}</StatusPill></section>
                  <section><h2>本地配置</h2><div className="workspace-status"><FolderGit2 aria-hidden="true" size={17} /><span>{detail.workspace ? `配置版本 ${detail.workspace.configurationVersion}` : "未绑定 Workspace"}</span><StatusPill tone={detail.workspace?.status === "ready" ? "success" : "warning"}>{detail.workspace?.status ?? "未配置"}</StatusPill></div></section>
                </div>
              ) : null}
              {tab === "roadmap" ? (
                <div className="roadmap-list">
                  {detail.roadmap.map((stage) => (
                    <section key={stage.id}>
                      <header><strong>{stage.name}</strong><span>{stage.completedMilestones} / {stage.totalMilestones}</span></header>
                      {stage.milestones.map((milestone) => (
                        <article key={milestone.id}><div><strong>{milestone.name}</strong><small>{milestone.taskCount} 个任务</small></div><StatusPill tone="info">{milestone.status}</StatusPill></article>
                      ))}
                    </section>
                  ))}
                </div>
              ) : null}
              {tab === "tasks" ? <><div className="data-table-wrap"><table className="data-table"><thead><tr><th>任务</th><th>状态</th><th>负责人</th><th>优先级</th></tr></thead><tbody>{taskPagination.items.map((task) => <tr key={task.id}><td>{task.title}</td><td>{task.status}</td><td>{task.assigneeName ?? "未分配"}</td><td>{task.priority}</td></tr>)}</tbody></table></div><Pagination label="项目任务分页" pagination={taskPagination} /></> : null}
              {tab === "documents" ? <><div className="data-table-wrap"><table className="data-table"><thead><tr><th>文档</th><th>路径</th><th>版本</th></tr></thead><tbody>{documentPagination.items.map((document) => <tr key={document.id}><td>{document.title}</td><td>{document.path}</td><td>v{document.version}</td></tr>)}</tbody></table></div><Pagination label="项目文档分页" pagination={documentPagination} /></> : null}
              {tab === "risks" ? <div className="card-grid">{detail.risks.map((risk) => <article className="compact-card" key={risk.id}><strong>{risk.name}</strong><p>{risk.summary}</p><StatusPill tone="warning">{risk.status}</StatusPill></article>)}</div> : null}
              {tab === "loops" ? <div className="empty-state"><strong>Loop 模型</strong><p>项目 Loop 模型将在正式客户端中管理，设计预览保持只读。</p></div> : null}
              {tab === "settings" ? <div className="empty-state"><strong>项目设置</strong><p>成员、可见性和 Workspace 配置在正式客户端中编辑。</p></div> : null}
            </SurfacePanel>
          </>
        ) : null}
      </AsyncState>
    </div>
  );
}
