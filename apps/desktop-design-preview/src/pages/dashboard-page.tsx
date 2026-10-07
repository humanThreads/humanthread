import { desktopDashboardResponseSchema } from "@humanthread/workbench-client";
import { ArrowRight, Bot, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { usePreviewReadModel } from "../session/preview-session";
import { Pagination, usePaginatedItems } from "../ui/pagination";
import { AsyncState, PageHeader, StatusPill, SurfacePanel, SurfaceHeader } from "../ui/primitives";

function signalRoute(key: string): string {
  if (key.includes("approval")) return "/agents?view=approvals";
  if (key.includes("risk")) return "/projects?health=at_risk";
  if (key.includes("block")) return "/tasks?relation=blocked";
  return "/tasks";
}

export function DashboardPage() {
  const query = usePreviewReadModel({
    domain: "dashboard",
    endpoint: "/api/desktop/dashboard",
    schema: desktopDashboardResponseSchema,
  });
  const data = query.data?.data;
  const taskPagination = usePaginatedItems(data?.tasks ?? [], { initialPageSize: 20 });

  return (
    <div className="page-stack">
      <PageHeader
        actions={<StatusPill tone="warning">执行默认关闭</StatusPill>}
        description="从当前任务、阻塞和待确认事项开始处理。"
        title="首页"
      />
      <AsyncState
        error={query.error instanceof Error ? query.error.message : null}
        label="正在加载首页"
        onRetry={() => void query.refetch()}
        status={query.isPending ? "pending" : query.isError ? "error" : "success"}
      >
        {data ? (
          <div className="dashboard-layout">
            <div className="dashboard-primary">
              <SurfacePanel label="当前工作">
                <SurfaceHeader
                  actions={data.currentTask ? (
                    <Link className="text-button" to={data.currentTask.route}>
                      打开任务 <ArrowRight aria-hidden="true" size={14} />
                    </Link>
                  ) : null}
                  description={data.currentTask ? data.currentTask.projectName : "新分配或已开始的任务会出现在这里"}
                  title="当前工作"
                />
                <div className="current-work">
                  <h2>{data.currentTask?.title ?? "暂无活动任务"}</h2>
                  {data.currentTask ? (
                    <div className="inline-meta">
                      <StatusPill tone="info">{data.currentTask.status}</StatusPill>
                      <span>{data.currentTask.assigneeName ?? "未分配"}</span>
                    </div>
                  ) : null}
                </div>
              </SurfacePanel>

              <section className="metric-strip" aria-label="工作指标">
                {data.stats.map((stat) => (
                  <Link className="metric-item" key={stat.key} to={`/tasks?stat=${stat.key}`}>
                    <span>{stat.label}</span>
                    <strong>{stat.count}</strong>
                    <small>{stat.description}</small>
                  </Link>
                ))}
              </section>

              <SurfacePanel label="最近任务">
                <SurfaceHeader title="最近任务" />
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>任务</th><th>项目</th><th>状态</th><th>负责人</th></tr></thead>
                    <tbody>
                      {taskPagination.items.map((task) => (
                        <tr key={task.id}>
                          <td><Link to={task.route}>{task.title}</Link></td>
                          <td>{task.projectName}</td>
                          <td><StatusPill tone="info">{task.status}</StatusPill></td>
                          <td>{task.assigneeName ?? "未分配"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination label="最近任务分页" pagination={taskPagination} />
              </SurfacePanel>
            </div>

            <aside className="dashboard-rail">
              <SurfacePanel label="需要处理">
                <SurfaceHeader
                  actions={<TriangleAlert aria-hidden="true" size={16} />}
                  title="需要处理"
                />
                <div className="signal-list">
                  {data.actionSignals.map((signal) => (
                    <Link key={signal.key} to={signalRoute(signal.key)}>
                      <span><strong>{signal.label}</strong><small>{signal.description}</small></span>
                      <em>{signal.count}</em>
                    </Link>
                  ))}
                </div>
              </SurfacePanel>

              <SurfacePanel label="执行设备">
                <SurfaceHeader title="执行设备" />
                <div className="device-list">
                  {data.devices.map((device) => (
                    <div key={device.id}>
                      <Bot aria-hidden="true" size={16} />
                      <span><strong>{device.name}</strong><small>{device.platform} · {device.userName}</small></span>
                      <StatusPill tone="success">{device.status}</StatusPill>
                    </div>
                  ))}
                </div>
              </SurfacePanel>
            </aside>
          </div>
        ) : null}
      </AsyncState>
    </div>
  );
}
