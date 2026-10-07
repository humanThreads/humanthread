import { desktopProjectCollectionResponseSchema } from "@humanthread/workbench-client";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

import { usePreviewReadModel } from "../session/preview-session";
import { Pagination, usePaginatedItems } from "../ui/pagination";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader, SurfacePanel } from "../ui/primitives";

const HEALTH_LABELS = {
  healthy: "正常",
  at_risk: "有风险",
  blocked: "受阻",
  complete: "已完成",
  unknown: "未知",
} as const;

export function ProjectsPage() {
  const query = usePreviewReadModel({
    domain: "projects",
    endpoint: "/api/desktop/projects",
    schema: desktopProjectCollectionResponseSchema,
  });
  const projects = query.data?.data.projects ?? [];
  const pagination = usePaginatedItems(projects, { initialPageSize: 20 });

  return (
    <div className="page-stack">
      <PageHeader
        description="项目健康度、路线图进度和本地配置状态集中在同一视图。"
        title="项目"
      />
      <SurfacePanel>
        <SurfaceHeader title="项目空间" description={`${projects.length} 个项目`} />
        <AsyncState
          empty={query.isSuccess && projects.length === 0}
          error={query.error instanceof Error ? query.error.message : null}
          label="正在加载项目"
          onRetry={() => void query.refetch()}
          status={query.isPending ? "pending" : query.isError ? "error" : "success"}
        >
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>项目</th><th>健康度</th><th>负责人</th><th>里程碑</th><th>任务</th><th>下一里程碑</th><th /></tr></thead>
              <tbody>
                {pagination.items.map((project) => (
                  <tr key={project.id}>
                    <td><Link className="project-name-link" to={`/projects/${encodeURIComponent(project.id)}`}><strong>{project.name}</strong></Link><small className="table-subline">{project.objective ?? "尚未定义目标"}</small></td>
                    <td><StatusPill tone={project.health === "healthy" ? "success" : project.health === "blocked" ? "danger" : "warning"}>{HEALTH_LABELS[project.health]}</StatusPill></td>
                    <td>{project.owner?.name ?? "未设置"}</td>
                    <td>{project.progress.completed} / {project.progress.total}</td>
                    <td>开放 {project.taskCounts.open} · 阻塞 {project.taskCounts.blocked}</td>
                    <td>{project.nextMilestone?.name ?? "暂无"}</td>
                    <td><Link aria-label={`查看项目详情：${project.name}`} className="secondary-button project-detail-link" to={`/projects/${encodeURIComponent(project.id)}`}>查看详情<ArrowUpRight aria-hidden="true" size={14} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination label="项目列表分页" pagination={pagination} />
        </AsyncState>
      </SurfacePanel>
    </div>
  );
}
