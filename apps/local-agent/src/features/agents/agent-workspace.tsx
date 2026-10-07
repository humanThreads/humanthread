import type { DesktopAgentsResponse } from "@humanthread/workbench-client";
import {
  Bot,
  Check,
  CirclePause,
  CirclePlay,
  Cpu,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Terminal,
  TerminalSquare,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Pagination, usePaginatedItems } from "../../ui/pagination";
import type { AgentLoopPanel, AgentView } from "./agent-queries";

type AgentData = DesktopAgentsResponse["data"];
type LoopCommand = "start" | "pause" | "resume" | "cancel";

const VIEW_LABELS: Array<{ key: AgentView; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "runs", label: "Runs" },
  { key: "loops", label: "Loops" },
  { key: "approvals", label: "审批" },
  { key: "workers", label: "执行端" },
  { key: "terminals", label: "本机终端" },
];

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "可用",
    cancelled: "已取消",
    claimed: "已领取",
    created: "待启动",
    failed: "失败",
    offline: "离线",
    online: "在线",
    paused: "已暂停",
    pending: "待审批",
    queued: "排队中",
    running: "执行中",
    starting: "启动中",
    succeeded: "已完成",
    waiting: "等待条件",
    waiting_approval: "等待审批",
  };
  return labels[status] ?? status;
}

function relativeTime(value: string | null): string {
  if (!value) return "暂无心跳";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status: string): string {
  if (["active", "online", "running", "succeeded"].includes(status)) return "success";
  if (["waiting", "waiting_approval", "pending", "paused"].includes(status)) return "warning";
  if (["failed", "offline", "cancelled"].includes(status)) return "danger";
  return "neutral";
}

function AgentStatus(props: { status: string }) {
  return <span className="agent-status" data-tone={statusTone(props.status)}>{statusLabel(props.status)}</span>;
}

function viewCount(view: AgentView, data: AgentData): number | null {
  if (view === "runs") return data.runs.length;
  if (view === "loops") return data.loops.length;
  if (view === "approvals") return data.approvals.filter((item) => item.status === "pending").length;
  if (view === "workers") return data.workers.length;
  return null;
}

function RunRows(props: { runs: AgentData["runs"]; limit?: number }) {
  const runs = props.limit ? props.runs.slice(0, props.limit) : props.runs;
  if (!runs.length) return <p className="agent-empty-state">当前 Space 没有 Agent Run。</p>;
  return <div className="agent-run-list">{runs.map((run) => (
    <Link aria-label={`打开任务：${run.taskTitle}`} key={run.id} to={run.route}>
      <span className="agent-provider-mark"><Bot aria-hidden="true" size={15} /></span>
      <span className="agent-primary-copy">
        <strong>{run.taskTitle}</strong>
        <small>{run.provider} · 第 {run.attempt} 次 · {run.workerName ?? "等待 Worker"}</small>
      </span>
      <span className="agent-time-copy">{relativeTime(run.lastHeartbeatAt)}</span>
      <AgentStatus status={run.status} />
      <ExternalLink aria-hidden="true" size={14} />
    </Link>
  ))}</div>;
}

function Overview(props: { data: AgentData; onViewChange(view: AgentView): void }) {
  const activeRuns = props.data.runs.filter((run) => ["claimed", "starting", "running", "waiting_approval"].includes(run.status));
  const availableWorkers = props.data.workers.filter((worker) => worker.status !== "offline");
  return <div className="agent-overview">
    <section className="agent-overview-band" aria-labelledby="agent-overview-title">
      <div>
        <Bot aria-hidden="true" size={18} />
        <span><strong id="agent-overview-title">Agent 控制面</strong><small>Run、Loop 与人工判断保持在任务上下文中。</small></span>
      </div>
      <dl>
        <div><dt>活动 Run</dt><dd>{activeRuns.length}</dd></div>
        <div><dt>等待审批</dt><dd>{props.data.approvals.length}</dd></div>
        <div><dt>在线 Worker</dt><dd>{availableWorkers.length}</dd></div>
        <div><dt>活动 Loop</dt><dd>{props.data.loops.length}</dd></div>
      </dl>
    </section>
    <section className="agent-section" aria-labelledby="agent-current-runs-title">
      <header><h2 id="agent-current-runs-title">当前执行</h2><button onClick={() => props.onViewChange("runs")} type="button">查看全部</button></header>
      <RunRows limit={6} runs={props.data.runs} />
    </section>
    <div className="agent-overview-columns">
      <section className="agent-section" aria-labelledby="agent-attention-title">
        <header><h2 id="agent-attention-title">需要人工处理</h2><span>{props.data.approvals.length}</span></header>
        {props.data.approvals.length ? props.data.approvals.slice(0, 4).map((approval) => (
          <button className="agent-signal-row" key={approval.id} onClick={() => props.onViewChange("approvals")} type="button">
            <ShieldCheck aria-hidden="true" size={15} />
            <span><strong>{approval.taskTitle ?? approval.action}</strong><small>{approval.policyReason}</small></span>
            <AgentStatus status={approval.status} />
          </button>
        )) : <p className="agent-empty-state">当前没有待审批操作。</p>}
      </section>
      <section className="agent-section" aria-labelledby="agent-capacity-title">
        <header><h2 id="agent-capacity-title">执行容量</h2><button onClick={() => props.onViewChange("workers")} type="button">管理执行端</button></header>
        {props.data.workers.length ? props.data.workers.map((worker) => (
          <div className="agent-worker-row" key={worker.id}>
            <Cpu aria-hidden="true" size={15} />
            <span><strong>{worker.name}</strong><small>{worker.runtimeType} · {relativeTime(worker.lastHeartbeatAt)}</small></span>
            <b>{worker.activeRunCount} / {worker.maxConcurrentRuns}</b>
            <AgentStatus status={worker.status} />
          </div>
        )) : <p className="agent-empty-state">当前 Space 没有 Worker。</p>}
      </section>
    </div>
  </div>;
}

function LoopRows(props: {
  loops: AgentData["loops"];
  busyId: string | null;
  selectedLoopId?: string | null;
  onSelect: ((loopId: string, panel?: AgentLoopPanel) => void) | undefined;
  onCommand(input: { loopId: string; command: LoopCommand; expectedVersion: number }): void;
}) {
  if (!props.loops.length) return <p className="agent-empty-state">当前没有活动 Loop。</p>;
  return <div className="agent-loop-list">{props.loops.map((loop) => {
    const primaryCommand: LoopCommand | null = loop.status === "created"
      ? "start"
      : loop.status === "running"
        ? "pause"
        : loop.status === "paused"
          ? "resume"
          : null;
    const primaryLabel = primaryCommand === "pause"
      ? "暂停 Loop"
      : primaryCommand === "start"
        ? "启动 Loop"
        : "恢复 Loop";
    return <article className={props.selectedLoopId === loop.id ? "agent-loop-row-selected" : undefined} key={loop.id}>
      <div className="agent-loop-state">
        <AgentStatus status={loop.status} />
        <span>迭代 {loop.currentIteration} / {loop.maxIterations}</span>
      </div>
      <button aria-label={`查看 Loop 详情：${loop.taskTitle}`} className="agent-loop-select" onClick={() => props.onSelect?.(loop.id)} type="button"><span className="agent-primary-copy"><strong>{loop.taskTitle}</strong><small>Attempt {loop.attempt} · {relativeTime(loop.lastHeartbeatAt)}{loop.waitingReason ? ` · ${loop.waitingReason}` : ""}</small></span></button>
      <div className="agent-row-actions">
        <button aria-label={`查看执行日志：${loop.taskTitle}`} onClick={() => props.onSelect?.(loop.id, "logs")} title="执行日志" type="button"><Terminal size={15} /></button>
        <Link aria-label={`打开任务：${loop.taskTitle}`} title="打开任务" to={loop.route}><ExternalLink size={15} /></Link>
        {primaryCommand ? <button aria-label={primaryLabel} disabled={props.busyId === loop.id} onClick={() => props.onCommand({ loopId: loop.id, command: primaryCommand, expectedVersion: loop.version })} title={primaryLabel} type="button">
          {primaryCommand === "pause" ? <CirclePause size={16} /> : <CirclePlay size={16} />}
        </button> : <span className="agent-loop-action-placeholder">{loop.status === "waiting_approval" ? "审批后继续" : loop.status === "waiting" ? "等待条件" : "不可操作"}</span>}
        <button aria-label="取消 Loop" disabled={props.busyId === loop.id} onClick={() => props.onCommand({ loopId: loop.id, command: "cancel", expectedVersion: loop.version })} title="取消 Loop" type="button"><X size={16} /></button>
      </div>
    </article>;
  })}</div>;
}

function ApprovalWorkspace(props: {
  approvals: AgentData["approvals"];
  busyId: string | null;
  onDecision(input: { approvalId: string; decision: "approved" | "rejected"; reason: string }): void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const selected = props.approvals.find((item) => item.id === selectedId) ?? null;
  if (!props.approvals.length) return <p className="agent-empty-state agent-empty-state-large">审批箱已清空。</p>;
  return <div className="agent-approval-workspace">
    <div className="agent-approval-list">{props.approvals.map((approval) => (
      <button aria-pressed={approval.id === selectedId} key={approval.id} onClick={() => { setSelectedId(approval.id); setReason(""); }} type="button">
        <ShieldCheck aria-hidden="true" size={15} />
        <span><strong>{approval.taskTitle ?? approval.action}</strong><small>{approval.action} · {relativeTime(approval.createdAt)}</small></span>
        <AgentStatus status={approval.status} />
      </button>
    ))}</div>
    <section className="agent-approval-detail" aria-label="审批详情">
      {selected ? <>
        <header><div><span>{selected.type}</span><h2>{selected.taskTitle ?? selected.action}</h2></div><AgentStatus status={selected.status} /></header>
        <dl><div><dt>请求操作</dt><dd>{selected.action}</dd></div><div><dt>影响范围</dt><dd>{selected.scope}</dd></div><div><dt>策略原因</dt><dd>{selected.policyReason}</dd></div></dl>
        <label><span>驳回原因</span><textarea disabled={props.busyId === selected.id} onChange={(event) => setReason(event.target.value)} value={reason} /></label>
        <footer>
          <button className="agent-secondary-action" disabled={props.busyId === selected.id || !reason.trim()} onClick={() => props.onDecision({ approvalId: selected.id, decision: "rejected", reason: reason.trim() })} type="button"><X size={15} />驳回</button>
          <button className="agent-primary-action" disabled={props.busyId === selected.id} onClick={() => props.onDecision({ approvalId: selected.id, decision: "approved", reason: "" })} type="button"><Check size={15} />批准</button>
        </footer>
      </> : <div className="agent-detail-placeholder"><ShieldCheck aria-hidden="true" size={24} /><strong>选择一个审批请求</strong><span>核对操作、范围与策略原因后再做决定。</span></div>}
    </section>
  </div>;
}

function WorkerWorkspace(props: { data: AgentData }) {
  const profilePagination = usePaginatedItems(props.data.profiles, { initialPageSize: 12 });
  const workerPagination = usePaginatedItems(props.data.workers, { initialPageSize: 20 });
  const kubernetesWorkers = props.data.workers.filter((worker) => worker.runtimeType === "kubernetes");
  return <div className="agent-worker-workspace">
    {kubernetesWorkers.length ? (
      <section className="agent-kubernetes-summary" aria-label="Kubernetes Worker 存活统计">
        <div><Cpu aria-hidden="true" size={18} /><span><strong>Kubernetes Worker</strong><small>仅统计当前存活实例，不累计历史实例名称</small></span></div>
        <div><span>存活实例</span><strong>{kubernetesWorkers.length}</strong></div>
        <div><span>任务组</span><strong>{kubernetesWorkers[0]?.runtimeType ?? "kubernetes"}</strong></div>
      </section>
    ) : null}
    <section className="agent-section" aria-labelledby="agent-profiles-title"><header><h2 id="agent-profiles-title">Agent Profiles</h2><span>{props.data.profiles.length}</span></header>
      {props.data.profiles.length ? profilePagination.items.map((profile) => <div className="agent-profile-row" key={profile.id}><Bot aria-hidden="true" size={16} /><span><strong>{profile.name}</strong><small>{profile.provider}{profile.model ? ` · ${profile.model}` : ""}</small></span><AgentStatus status={profile.status} /></div>) : <p className="agent-empty-state">没有可用 Agent Profile。</p>}
      <Pagination label="Agent Profiles 分页" pagination={profilePagination} />
    </section>
    <section className="agent-section" aria-labelledby="agent-workers-title"><header><h2 id="agent-workers-title">Workers</h2><span>{props.data.workers.length}</span></header>
      {props.data.workers.length ? workerPagination.items.map((worker) => <div className="agent-worker-row" key={worker.id}><Cpu aria-hidden="true" size={16} /><span><strong>{worker.name}</strong><small>{worker.runtimeType} · {worker.agentVersion ?? "版本未知"} · {relativeTime(worker.lastHeartbeatAt)}</small></span><b>{worker.activeRunCount} / {worker.maxConcurrentRuns}</b><AgentStatus status={worker.status} /></div>) : <p className="agent-empty-state">没有已连接 Worker。</p>}
      <Pagination label="Worker 列表分页" pagination={workerPagination} />
    </section>
  </div>;
}

export function AgentWorkspaceView(props: {
  activeView: AgentView;
  data: AgentData;
  onViewChange(view: AgentView): void;
  onLoopCommand(input: { loopId: string; command: LoopCommand; expectedVersion: number }): void | Promise<void>;
  selectedLoopId?: string | null;
  onLoopSelect?(loopId: string, panel?: AgentLoopPanel): void;
  loopDetail?: ReactNode;
  terminalContent?: ReactNode;
  onApprovalDecision(input: { approvalId: string; decision: "approved" | "rejected"; reason: string }): void | Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const counters = useMemo(() => new Map(VIEW_LABELS.map(({ key }) => [key, viewCount(key, props.data)])), [props.data]);
  const runPagination = usePaginatedItems(props.data.runs, { initialPageSize: 20 });
  const loopPagination = usePaginatedItems(props.data.loops, { initialPageSize: 20 });
  const approvalPagination = usePaginatedItems(props.data.approvals, { initialPageSize: 20 });

  async function run<T extends { loopId: string } | { approvalId: string }>(input: T, action: () => void | Promise<void>, success: string) {
    const id = "loopId" in input ? input.loopId : input.approvalId;
    setBusyId(id);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "success", text: success });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Agent 操作失败" });
    } finally {
      setBusyId(null);
    }
  }

  return <div className="agent-workspace">
    <header className="agent-workspace-toolbar">
      <div role="tablist" aria-label="Agent 工作区视图">{VIEW_LABELS.map((view) => {
        const count = counters.get(view.key);
        return <button aria-selected={props.activeView === view.key} key={view.key} onClick={() => props.onViewChange(view.key)} role="tab" type="button">{view.label}{count !== null ? ` ${count}` : ""}</button>;
      })}</div>
      <span><RefreshCw aria-hidden="true" size={13} />实时数据来自当前 Space</span>
    </header>
    {notice ? <p className="agent-action-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}
    <div className="agent-workspace-body">
    <main className="agent-workspace-scroll">
      {props.activeView === "overview" ? <Overview data={props.data} onViewChange={props.onViewChange} /> : null}
      {props.activeView === "runs" ? <section className="agent-section agent-full-section" aria-labelledby="agent-runs-title"><header><h2 id="agent-runs-title">Run 队列</h2><span>{props.data.runs.length}</span></header><RunRows runs={runPagination.items} /><Pagination label="Agent Run 列表分页" pagination={runPagination} /></section> : null}
      {props.activeView === "loops" ? <section className="agent-section agent-full-section" aria-labelledby="agent-loops-title"><header><h2 id="agent-loops-title">Loop Engine</h2><span>{props.data.loops.length}</span></header><LoopRows busyId={busyId} loops={loopPagination.items} onSelect={props.onLoopSelect} selectedLoopId={props.selectedLoopId ?? null} onCommand={(input) => void run(input, () => props.onLoopCommand(input), "Loop 状态已更新")} /><Pagination label="Loop 列表分页" pagination={loopPagination} /></section> : null}
      {props.activeView === "approvals" ? <><ApprovalWorkspace approvals={approvalPagination.items} busyId={busyId} onDecision={(input) => void run(input, () => props.onApprovalDecision(input), input.decision === "approved" ? "操作已批准" : "操作已驳回")} /><Pagination label="审批列表分页" pagination={approvalPagination} /></> : null}
      {props.activeView === "workers" ? <WorkerWorkspace data={props.data} /> : null}
      {props.activeView === "terminals" ? props.terminalContent ?? <section className="agent-section agent-full-section" aria-label="本机 Codex 终端"><p className="agent-empty-state">本机终端仅在 Desktop 客户端中可用。</p></section> : null}
    </main>
    {props.loopDetail}
    </div>
  </div>;
}
