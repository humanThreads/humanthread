import type { DesktopLoopDetailResponse } from "@humanthread/workbench-client";
import {
  AlertTriangle,
  Check,
  Clock3,
  ExternalLink,
  MessageSquare,
  Send,
  Terminal,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  readLoopExecutionLogs,
  subscribeLoopExecutionLogs,
  type LoopExecutionLogEntry,
} from "../../lib/loop-execution-logs";
import type { AgentLoopPanel } from "./agent-queries";

type Detail = DesktopLoopDetailResponse["data"];
type Interaction = NonNullable<Detail["interaction"]>;

export interface AgentLoopDetailProps {
  detail: Detail | null;
  isLoading: boolean;
  error: Error | null;
  actionsEnabled: boolean;
  initialTab?: AgentLoopPanel;
  onClose(): void;
  onTabChange?(tab: AgentLoopPanel): void;
  onMessage(input: { interactionId: string; expectedVersion: number; body: string }): void;
  onConfirm(input: { interactionId: string; expectedVersion: number; reason: string }): void;
  onDecision(input: { interactionId: string; expectedVersion: number; decision: "approved" | "rejected"; reason: string; selectedEdgeId: string }): void;
  terminalContent?: ReactNode;
  hasLocalTerminal?: boolean;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    waiting: "等待中", waiting_input: "等待输入", waiting_approval: "等待审批",
    running: "执行中", succeeded: "已完成", failed: "失败", paused: "已暂停",
    open: "待处理", confirmed: "已确认", approved: "已批准", rejected: "已拒绝",
  };
  return labels[status] ?? status;
}

function statusTone(status: string) {
  if (["running", "succeeded", "approved", "confirmed"].includes(status)) return "success";
  if (["waiting", "waiting_input", "waiting_approval", "open", "paused"].includes(status)) return "warning";
  if (["failed", "rejected"].includes(status)) return "danger";
  return "neutral";
}

function formatTime(value: string | null) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function AgentDetailStatus({ status }: { status: string }) {
  return <span className="agent-status" data-tone={statusTone(status)}>{statusLabel(status)}</span>;
}

export function AgentLoopDetail(props: AgentLoopDetailProps) {
  const [tab, setTab] = useState<AgentLoopPanel>(props.initialTab ?? "runtime");
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const detail = props.detail;
  const loopRunId = detail?.run.id ?? "";
  const subscribeToLogs = useCallback(
    (listener: () => void) => loopRunId ? subscribeLoopExecutionLogs(loopRunId, listener) : () => undefined,
    [loopRunId],
  );
  const readLogs = useCallback(() => readLoopExecutionLogs(loopRunId), [loopRunId]);
  const localLogs = useSyncExternalStore(subscribeToLogs, readLogs, readLogs);
  const selectedNode = useMemo(
    () => detail?.nodes.find((node) => node.nodeKey === selectedNodeKey) ?? detail?.nodes.find((node) => node.status.includes("waiting")) ?? detail?.nodes[0] ?? null,
    [detail?.nodes, selectedNodeKey],
  );
  const interaction = detail?.interaction;

  useEffect(() => {
    setTab(props.initialTab ?? "runtime");
  }, [detail?.run.id, props.initialTab]);

  function selectTab(nextTab: AgentLoopPanel) {
    setTab(nextTab);
    props.onTabChange?.(nextTab);
  }

  return <aside className="agent-loop-detail" aria-label="Loop 运行详情">
    <header className="agent-loop-detail-header">
      <div className="agent-loop-detail-heading">
        <Workflow aria-hidden="true" size={17} />
        <div><span>Loop Run</span><h2>{detail?.task.title ?? "Loop 详情"}</h2></div>
      </div>
      <button aria-label="关闭 Loop 详情" className="agent-icon-button" onClick={props.onClose} title="关闭 Loop 详情" type="button"><X size={16} /></button>
    </header>
    {props.isLoading ? <div className="agent-loop-detail-state" aria-label="正在加载 Loop 详情" /> : null}
    {!props.isLoading && props.error ? <div className="agent-loop-detail-state agent-loop-detail-error" role="alert"><AlertTriangle size={20} /><strong>Loop 详情暂时无法加载</strong><span>{props.error.message}</span></div> : null}
    {!props.isLoading && !props.error && detail ? <>
      <section className="agent-loop-detail-summary">
        <div className="agent-loop-detail-summary-top"><AgentDetailStatus status={detail.run.status} /><span>v{detail.run.version} · 迭代 {detail.run.currentIteration}/{detail.run.maxIterations}</span></div>
        {detail.run.waitingReason ? <p className="agent-loop-waiting-reason">等待原因：{detail.run.waitingReason}</p> : null}
        <dl>
          <div><dt>Worker</dt><dd>{detail.worker ? `${detail.worker.name} · ${detail.worker.status}` : "未分配"}</dd></div>
          <div><dt>定义 / 投影</dt><dd>v{detail.run.definitionVersion} / v{detail.run.projectionVersion}</dd></div>
          <div><dt>最近心跳</dt><dd>{formatTime(detail.run.lastHeartbeatAt)}</dd></div>
        </dl>
        <Link className="agent-loop-task-link" to={detail.task.route}><ExternalLink size={14} />打开任务</Link>
      </section>
      <nav className="agent-loop-detail-tabs" aria-label="Loop 详情视图" role="tablist">
        <button aria-selected={tab === "runtime"} onClick={() => selectTab("runtime")} role="tab" type="button">运行与时间线</button>
        <button aria-selected={tab === "logs"} onClick={() => selectTab("logs")} role="tab" type="button">执行日志</button>
        <button aria-selected={tab === "interaction"} onClick={() => selectTab("interaction")} role="tab" type="button">人工交互{interaction?.status === "open" ? " · 1" : ""}</button>
        <button aria-selected={tab === "terminal"} onClick={() => selectTab("terminal")} role="tab" type="button">终端</button>
      </nav>
      {tab === "terminal" ? props.terminalContent ?? <div className="agent-loop-detail-state agent-loop-detail-terminal-empty"><Terminal aria-hidden="true" size={20} /><strong>{props.hasLocalTerminal ? "本机终端正在准备" : "当前 Loop 没有可附着的本机终端。"}</strong></div> : tab === "runtime" ? <RuntimeDetail detail={detail} selectedNode={selectedNode} onSelectNode={setSelectedNodeKey} /> : tab === "logs" ? <ExecutionLogDetail detail={detail} localLogs={localLogs} /> : <InteractionDetail
        actionsEnabled={props.actionsEnabled}
        decision={decision}
        interaction={interaction ?? null}
        message={message}
        onConfirm={() => interaction && props.onConfirm({ interactionId: interaction.id, expectedVersion: interaction.version, reason: reason.trim() })}
        onDecision={() => interaction && props.onDecision({ interactionId: interaction.id, expectedVersion: interaction.version, decision, reason: reason.trim(), selectedEdgeId: detail.edges[0]?.edgeId ?? "default" })}
        onMessage={() => {
          if (!interaction || !message.trim()) return;
          props.onMessage({ interactionId: interaction.id, expectedVersion: interaction.version, body: message.trim() });
          setMessage("");
        }}
        onSetDecision={setDecision}
        onSetMessage={setMessage}
        onSetReason={setReason}
        reason={reason}
      />}
    </> : null}
  </aside>;
}

function ExecutionLogDetail(props: {
  detail: Detail;
  localLogs: readonly LoopExecutionLogEntry[];
}) {
  const outputRef = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  const lines = useMemo(() => [
    ...props.detail.timeline.map((item) => ({
      id: `platform:${item.id}`,
      occurredAt: item.occurredAt,
      source: "平台",
      stream: "system" as const,
      nodeKey: item.kind,
      text: item.summary,
    })),
    ...props.localLogs.map((item) => ({
      ...item,
      source: "本机",
    })),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)), [props.detail.timeline, props.localLogs]);

  useEffect(() => {
    const output = outputRef.current;
    if (output && followingRef.current) output.scrollTop = output.scrollHeight;
  }, [lines.length]);

  const emptyMessage = props.detail.worker
    ? "当前没有本机实时输出。可继续查看平台节点记录。"
    : "尚未分配 Worker，暂无本机执行输出。";

  return <section className="agent-loop-execution-log" aria-label="执行日志">
    <header>
      <div><Terminal aria-hidden="true" size={14} /><strong>Execution stream</strong></div>
      <span data-live={props.localLogs.length > 0}>{props.localLogs.length > 0 ? "本机实时输出" : "平台记录"}</span>
    </header>
    {lines.length ? <ol
      aria-label="Loop 执行日志"
      aria-live="polite"
      onScroll={(event) => {
        const target = event.currentTarget;
        followingRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 24;
      }}
      ref={outputRef}
      role="log"
    >
      {lines.map((line) => <li data-stream={line.stream} key={line.id}>
        <time dateTime={line.occurredAt}>{formatLogTime(line.occurredAt)}</time>
        <span className="agent-loop-log-source">{line.source}</span>
        <span className="agent-loop-log-node" title={line.nodeKey}>{line.nodeKey}</span>
        <pre>{line.text}</pre>
      </li>)}
    </ol> : <div className="agent-loop-log-empty"><Terminal aria-hidden="true" size={18} /><span>{emptyMessage}</span></div>}
  </section>;
}

function formatLogTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function RuntimeDetail(props: {
  detail: Detail;
  selectedNode: Detail["nodes"][number] | null;
  onSelectNode(nodeKey: string): void;
}) {
  return <div className="agent-loop-runtime-detail">
    <section className="agent-loop-node-strip" aria-label="Loop 节点进度">
      {props.detail.nodes.map((node) => <button aria-pressed={props.selectedNode?.nodeKey === node.nodeKey} key={node.nodeKey} onClick={() => props.onSelectNode(node.nodeKey)} type="button">
        <span className="agent-loop-node-index">{node.attemptNo}</span><span><strong>{node.label}</strong><small>{statusLabel(node.status)}</small></span>
      </button>)}
    </section>
    {props.selectedNode ? <section className="agent-loop-node-evidence" aria-label="节点证据">
      <header><div><span>{props.selectedNode.nodeKey} · {props.selectedNode.type}</span><h3>{props.selectedNode.label}</h3></div><AgentDetailStatus status={props.selectedNode.status} /></header>
      <dl><div><dt>等待原因</dt><dd>{props.selectedNode.waitingReason ?? "无"}</dd></div><div><dt>尝试次数</dt><dd>{props.selectedNode.attemptNo}</dd></div></dl>
      {props.selectedNode.attempts.map((attempt) => <div className="agent-loop-attempt" key={attempt.attempt}><span>Attempt {attempt.attempt} · {attempt.executorType}</span><small>{formatTime(attempt.startedAt)} - {formatTime(attempt.finishedAt)}</small>{attempt.summary ? <p>{attempt.summary}</p> : null}{attempt.errorSummary ? <p data-tone="danger">{attempt.errorSummary}</p> : null}</div>)}
    </section> : <p className="agent-empty-state">暂无节点运行记录。</p>}
    <section className="agent-loop-timeline" aria-label="Loop 时间线"><header><Clock3 size={14} /><h3>节点时间线</h3><span>{props.detail.timeline.length} 条</span></header>{props.detail.timeline.length ? <ol>{props.detail.timeline.map((item) => <li key={item.id}><Workflow size={13} /><div><strong>{item.summary}</strong><small>{formatTime(item.occurredAt)}{item.status ? ` · ${item.status}` : ""}</small>{item.routeDecision ? <div className="agent-loop-route-audit"><span>{item.routeDecision.reasonCode}</span><p>{item.routeDecision.summary}</p><small>置信度 {Math.round(item.routeDecision.confidence * 100)}% · Router v{item.routeDecision.routerContractVersion}</small>{item.routeDecision.evidence.length ? <ul>{item.routeDecision.evidence.map((path) => <li key={path}>{path}</li>)}</ul> : null}{item.routeDecision.errorSummary ? <p data-tone="danger">{item.routeDecision.errorSummary}</p> : null}</div> : null}</div></li>)}</ol> : <p className="agent-empty-state">暂无时间线记录。</p>}</section>
  </div>;
}

function InteractionDetail(props: {
  interaction: Interaction | null;
  actionsEnabled: boolean;
  message: string;
  reason: string;
  decision: "approved" | "rejected";
  onSetMessage(value: string): void;
  onSetReason(value: string): void;
  onSetDecision(value: "approved" | "rejected"): void;
  onMessage(): void;
  onConfirm(): void;
  onDecision(): void;
}) {
  if (!props.interaction) return <div className="agent-loop-interaction-empty"><MessageSquare size={20} /><strong>当前没有人工交互</strong><span>Loop 继续执行后，新的交互会显示在这里。</span></div>;
  return <section className="agent-loop-interaction" aria-label="人工交互">
    <header><div><span>{props.interaction.kind}</span><h3>{statusLabel(props.interaction.status)}</h3></div><AgentDetailStatus status={props.interaction.status} /></header>
    <ol className="agent-loop-message-list">{props.interaction.messages.map((item) => <li key={item.id}><strong>{item.actorType}</strong><p>{item.body}</p><small>{formatTime(item.createdAt)}</small></li>)}</ol>
    {props.interaction.status === "open" && props.actionsEnabled ? <>
      {props.interaction.messages.length ? <label className="agent-loop-composer"><span>回复需求</span><textarea aria-label="回复需求" onChange={(event) => props.onSetMessage(event.target.value)} value={props.message} placeholder="输入回复" /><button disabled={!props.message.trim()} onClick={props.onMessage} type="button"><Send size={14} />发送回复</button></label> : null}
      {props.interaction.kind === "requirement_conversation" ? <div className="agent-loop-confirm"><label><span>确认备注</span><input onChange={(event) => props.onSetReason(event.target.value)} value={props.reason} /></label><button onClick={props.onConfirm} type="button"><Check size={14} />确认并继续</button></div> : null}
      {props.interaction.kind === "business_approval" ? <div className="agent-loop-confirm"><label><span>审批结果</span><select onChange={(event) => props.onSetDecision(event.target.value as "approved" | "rejected")} value={props.decision}><option value="approved">批准</option><option value="rejected">拒绝</option></select></label><button disabled={props.decision === "rejected" && !props.reason.trim()} onClick={props.onDecision} type="button"><Check size={14} />提交审批</button></div> : null}
    </> : <p className="agent-loop-stale-note">当前会话不可写或交互已关闭。</p>}
  </section>;
}
