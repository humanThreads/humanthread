import { desktopAgentsResponseSchema } from "@humanthread/workbench-client";
import { CheckCircle2, Cpu, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { usePreviewReadModel } from "../session/preview-session";
import { Pagination, usePaginatedItems } from "../ui/pagination";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader, SurfacePanel } from "../ui/primitives";

type AgentTab = "profiles" | "workers" | "runs" | "loops" | "approvals";

const TABS: Array<{ key: AgentTab; label: string }> = [
  { key: "profiles", label: "Profiles" },
  { key: "workers", label: "Workers" },
  { key: "runs", label: "Runs" },
  { key: "loops", label: "Loops" },
  { key: "approvals", label: "Approvals" },
];

export function AgentsPage() {
  const [tab, setTab] = useState<AgentTab>("workers");
  const query = usePreviewReadModel({
    domain: "agents",
    endpoint: "/api/desktop/agents",
    schema: desktopAgentsResponseSchema,
  });
  const data = query.data?.data;
  const kubernetesWorkers = data?.workers.filter((worker) => worker.runtimeType === "kubernetes") ?? [];
  const profilePagination = usePaginatedItems(data?.profiles ?? [], { initialPageSize: 12 });
  const workerPagination = usePaginatedItems(data?.workers ?? [], { initialPageSize: 20 });
  const runPagination = usePaginatedItems(data?.runs ?? [], { initialPageSize: 20 });
  const approvalPagination = usePaginatedItems(data?.approvals ?? [], { initialPageSize: 20 });

  return (
    <div className="page-stack">
      <PageHeader
        actions={<StatusPill tone="warning">审批只读</StatusPill>}
        description="统一查看 Agent Profiles、Worker、Loop 与人工审批。"
        title="Agents"
      />
      <AsyncState
        error={query.error instanceof Error ? query.error.message : null}
        label="正在加载 Agents"
        onRetry={() => void query.refetch()}
        status={query.isPending ? "pending" : query.isError ? "error" : "success"}
      >
        {data ? (
          <>
            <section className="metric-strip" aria-label="Agent 指标">
              <div className="metric-item"><span>Profiles</span><strong>{data.profiles.length}</strong><small>可配置 Agent 身份</small></div>
              <div className="metric-item"><span>Workers</span><strong>{data.workers.length}</strong><small>当前存活实例</small></div>
              <div className="metric-item"><span>运行中 Loop</span><strong>{data.loops.length}</strong><small>当前运行与等待</small></div>
              <div className="metric-item"><span>待审批</span><strong>{data.approvals.length}</strong><small>需要人工决策</small></div>
            </section>

            {kubernetesWorkers.length ? (
              <SurfacePanel className="kubernetes-summary">
                <div><Cpu aria-hidden="true" size={18} /><span><strong>Kubernetes Worker</strong><small>仅统计当前存活实例，不累计历史实例名称</small></span></div>
                <div><span>存活实例</span><strong>{kubernetesWorkers.length}</strong></div>
                <div><span>任务组</span><strong>{kubernetesWorkers[0]?.runtimeType}</strong></div>
              </SurfacePanel>
            ) : null}

            <SurfacePanel>
              <nav aria-label="Agent 视图" className="tab-strip">
                {TABS.map((item) => (
                  <button aria-current={tab === item.key ? "page" : undefined} key={item.key} onClick={() => setTab(item.key)} type="button">{item.label}</button>
                ))}
              </nav>
              {tab === "profiles" ? (
                <>
                  <div className="card-grid">
                    {profilePagination.items.map((profile) => (
                      <article className="compact-card" key={profile.id}>
                        <div><ShieldCheck aria-hidden="true" size={17} /><strong>{profile.name}</strong></div>
                        <p>{profile.provider} · {profile.model ?? "未绑定模型"}</p>
                        <StatusPill tone={profile.status === "ready" ? "success" : "warning"}>{profile.status}</StatusPill>
                      </article>
                    ))}
                  </div>
                  <Pagination label="Agent Profiles 分页" pagination={profilePagination} />
                </>
              ) : null}
              {tab === "workers" ? (
                <>
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Worker</th><th>Runtime</th><th>状态</th><th>活跃 / 并发</th><th>版本</th><th>最近心跳</th></tr></thead>
                      <tbody>
                        {workerPagination.items.map((worker) => (
                          <tr key={worker.id}>
                            <td>{worker.name}</td><td>{worker.runtimeType}</td>
                            <td><StatusPill tone="success">{worker.status}</StatusPill></td>
                            <td>{worker.activeRunCount} / {worker.maxConcurrentRuns}</td>
                            <td>{worker.agentVersion ?? "未知"}</td>
                            <td>{worker.lastHeartbeatAt ? new Date(worker.lastHeartbeatAt).toLocaleString("zh-CN") : "无"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination label="Worker 列表分页" pagination={workerPagination} />
                </>
              ) : null}
              {tab === "runs" ? (
                <>
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead><tr><th>任务</th><th>状态</th><th>Provider</th><th>Worker</th><th>尝试</th></tr></thead>
                      <tbody>{runPagination.items.map((run) => <tr key={run.id}><td>{run.taskTitle}</td><td>{run.status}</td><td>{run.provider}</td><td>{run.workerName ?? "未分配"}</td><td>{run.attempt}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <Pagination label="Agent Run 列表分页" pagination={runPagination} />
                </>
              ) : null}
              {tab === "loops" ? <div className="empty-state"><CheckCircle2 aria-hidden="true" size={20} /><strong>暂无运行中的 Loop</strong><p>Loop 启动后会显示节点、迭代和人工交互。</p></div> : null}
              {tab === "approvals" ? (
                <>
                  <div className="approval-list">
                    {approvalPagination.items.map((approval) => (
                      <article key={approval.id}>
                        <div><strong>{approval.action}</strong><StatusPill tone="warning">{approval.status}</StatusPill></div>
                        <p>{approval.policyReason}</p>
                        <span>范围：{approval.scope}</span>
                        <div className="toolbar-actions">
                          <button className="secondary-button" disabled type="button">拒绝</button>
                          <button className="primary-button" disabled type="button">批准</button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <Pagination label="审批列表分页" pagination={approvalPagination} />
                </>
              ) : null}
            </SurfacePanel>
          </>
        ) : null}
      </AsyncState>
    </div>
  );
}
