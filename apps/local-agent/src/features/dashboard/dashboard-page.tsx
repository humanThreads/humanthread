import { useQuery } from "@tanstack/react-query";
import {
  desktopDashboardResponseSchema,
  workbenchQueryKey,
  type DesktopDashboardResponse,
} from "@humanthread/workbench-client";
import { ArrowRight, Bot, Monitor, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { useDesktopSession } from "../../session/session-provider";

type DashboardData = DesktopDashboardResponse["data"];

function signalRoute(key: string): string {
  if (key.includes("approval")) return "/agents?view=approvals";
  if (key.includes("block")) return "/tasks?filter=blocked";
  if (key.includes("risk")) return "/projects?view=risks";
  return "/tasks";
}

export function DashboardView(props: { data: DashboardData }) {
  return (
    <div className="dashboard-workbench">
      <section className="dashboard-current" aria-labelledby="dashboard-current-title">
        <header>
          <div>
            <span>当前工作</span>
            <h2 id="dashboard-current-title">{props.data.currentTask?.title ?? "暂无活动任务"}</h2>
          </div>
          {props.data.currentTask ? (
            <Link
              aria-label={`打开任务：${props.data.currentTask.title}`}
              to={props.data.currentTask.route}
            >
              打开任务 <ArrowRight aria-hidden="true" size={15} />
            </Link>
          ) : null}
        </header>
        {props.data.currentTask ? (
          <div className="dashboard-current-meta">
            <span>{props.data.currentTask.projectName}</span>
            <span>{props.data.currentTask.status}</span>
            <span>{props.data.currentTask.assigneeName ?? "未分配"}</span>
          </div>
        ) : <p>新分配或已开始的任务会出现在这里。</p>}
      </section>

      <section className="dashboard-signals" aria-labelledby="dashboard-signals-title">
        <header>
          <TriangleAlert aria-hidden="true" size={17} />
          <h2 id="dashboard-signals-title">需要处理</h2>
        </header>
        <div>
          {props.data.actionSignals.map((signal) => (
            <Link key={signal.key} to={signalRoute(signal.key)}>
              <span>{signal.label} <strong>{signal.count}</strong></span>
              <small>{signal.description}</small>
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          ))}
          {props.data.actionSignals.length === 0 ? <p>当前没有待处理信号。</p> : null}
        </div>
      </section>

      <section className="dashboard-overview" aria-label="工作概览">
        <div className="dashboard-stats">
          {props.data.stats.map((stat) => (
            <div key={stat.key}>
              <span>{stat.label}</span>
              <strong>{stat.count}</strong>
              <small>{stat.description}</small>
            </div>
          ))}
        </div>
        <div className="dashboard-devices">
          <header><Monitor aria-hidden="true" size={17} /><h2>执行设备</h2></header>
          {props.data.devices.map((device) => (
            <div key={device.id}>
              <Bot aria-hidden="true" size={16} />
              <span><strong>{device.name}</strong><small>{device.platform} · {device.userName}</small></span>
              <em data-status={device.status}>{device.status}</em>
            </div>
          ))}
          {props.data.devices.length === 0 ? <p>暂无已连接设备。</p> : null}
        </div>
      </section>
    </div>
  );
}

export function DashboardPage() {
  const session = useDesktopSession();
  const query = useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context
      ? workbenchQueryKey(session.context, "dashboard")
      : ["desktop", "dashboard", "disabled"],
    queryFn: async () => {
      if (!session.client || !session.context) throw new Error("桌面会话不可用");
      const search = new URLSearchParams({ space: session.context.spaceKey });
      return session.client.request(
        `/api/desktop/dashboard?${search.toString()}`,
        desktopDashboardResponseSchema,
      );
    },
  });

  if (query.isPending) return <div className="feature-loading-state" aria-label="正在加载首页" />;
  if (query.isError) return <p className="feature-error-state">{query.error.message}</p>;
  return <DashboardView data={query.data.data} />;
}
