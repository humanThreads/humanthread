import { CircleDot, FolderOpen, Power, RefreshCw, RotateCcw, Terminal } from "lucide-react";
import { useMemo, useState } from "react";

import type { CodexTuiClient, CodexTuiSession } from "../../lib/codex-tui-client";
import { LocalTerminalView } from "./local-terminal-view";

type StatusFilter = "all" | "running" | "detached" | "interrupted";

function statusLabel(status: CodexTuiSession["status"]): string {
  const labels: Record<CodexTuiSession["status"], string> = {
    starting: "启动中",
    running: "执行中",
    detached: "已分离",
    interrupted: "已中断",
    completed: "已完成",
  };
  return labels[status];
}

function statusTone(status: CodexTuiSession["status"]): string {
  if (status === "running") return "success";
  if (status === "interrupted") return "danger";
  if (status === "starting") return "warning";
  return "neutral";
}

function relativeTime(value: number | null): string {
  if (!value) return "暂无活动";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function LocalTerminalPage(props: {
  client: CodexTuiClient;
  sessions: CodexTuiSession[];
  selectedSessionId: string | null;
  onRefresh(): void | Promise<void>;
  onOpen(sessionId: string): void;
  onClose(sessionId: string): void | Promise<void>;
  onError?(message: string): void;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [project, setProject] = useState("all");
  const [attachment, setAttachment] = useState<"all" | "attached" | "detached">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const projects = useMemo(() => [...new Set(props.sessions.map((session) => session.projectId ?? "unassigned"))].sort(), [props.sessions]);
  const filtered = useMemo(() => props.sessions
    .filter((session) => status === "all" || session.status === status)
    .filter((session) => project === "all" || (session.projectId ?? "unassigned") === project)
    .filter((session) => attachment === "all"
      || (attachment === "attached" ? session.attached : !session.attached))
    .sort((left, right) => (right.lastActivityAtMs ?? 0) - (left.lastActivityAtMs ?? 0)), [
      attachment,
      project,
      props.sessions,
      status,
    ]);
  const selected = props.selectedSessionId
    ? props.sessions.find((session) => session.sessionId === props.selectedSessionId) ?? null
    : null;

  async function closeSession(sessionId: string) {
    setBusyId(sessionId);
    try {
      await props.onClose(sessionId);
    } catch (error) {
      props.onError?.(error instanceof Error ? error.message : "关闭终端失败");
    } finally {
      setBusyId(null);
    }
  }

  if (selected) {
    return <div className="local-terminal-page">
      <div className="local-terminal-page-header">
        <button onClick={() => props.onOpen("")} type="button">返回本机终端列表</button>
        <span>{selected.runId}</span>
      </div>
      <LocalTerminalView
        client={props.client}
        {...(props.onError ? { onError: props.onError } : {})}
        session={selected}
      />
    </div>;
  }

  return <section className="local-terminal-page" aria-label="本机 Codex 终端">
    <header className="local-terminal-page-toolbar">
      <div>
        <Terminal aria-hidden="true" size={17} />
        <span><strong>本机终端</strong><small>仅显示当前 Desktop 管理的 Codex thread</small></span>
      </div>
      <button onClick={() => void props.onRefresh()} type="button"><RefreshCw aria-hidden="true" size={13} />刷新</button>
    </header>
    <div className="local-terminal-filters">
      <label>终端状态
        <select aria-label="终端状态" onChange={(event) => setStatus(event.target.value as StatusFilter)} value={status}>
          <option value="all">全部</option>
          <option value="running">执行中</option>
          <option value="detached">已分离</option>
          <option value="interrupted">已中断</option>
        </select>
      </label>
      <label>项目
        <select aria-label="项目" onChange={(event) => setProject(event.target.value)} value={project}>
          <option value="all">全部项目</option>
          {projects.map((projectId) => <option key={projectId} value={projectId}>{projectId}</option>)}
        </select>
      </label>
      <label>附着状态
        <select aria-label="附着状态" onChange={(event) => setAttachment(event.target.value as typeof attachment)} value={attachment}>
          <option value="all">全部</option>
          <option value="attached">已附着</option>
          <option value="detached">未附着</option>
        </select>
      </label>
      <span>{filtered.length} 个本机会话</span>
    </div>
    {filtered.length ? <div className="local-terminal-session-list">
      {filtered.map((session) => <article className="local-terminal-session-row" key={session.sessionId}>
        <span className="local-terminal-session-icon"><CircleDot aria-hidden="true" size={14} /></span>
        <div className="local-terminal-session-main">
          <strong>{session.nodeKey ?? session.runId}</strong>
          <small>{session.projectId ?? "未分配项目"} · {session.model ?? "默认模型"} · thread {session.threadId.slice(0, 12)}</small>
          <code>{session.cwd}</code>
        </div>
        <span className="agent-status" data-tone={statusTone(session.status)}>{statusLabel(session.status)}</span>
        <span className="local-terminal-session-activity">{relativeTime(session.lastActivityAtMs)}</span>
        <div className="local-terminal-session-actions">
          <button aria-label={`打开 ${session.nodeKey ?? session.runId}`} onClick={() => props.onOpen(session.sessionId)} type="button"><FolderOpen aria-hidden="true" size={13} />打开</button>
          {session.status === "detached" ? <button aria-label={`重新附着 ${session.nodeKey ?? session.runId}`} onClick={() => props.onOpen(session.sessionId)} type="button"><RotateCcw aria-hidden="true" size={13} />重新附着</button> : null}
          <button aria-label={`关闭 ${session.nodeKey ?? session.runId}`} disabled={busyId === session.sessionId} onClick={() => void closeSession(session.sessionId)} type="button"><Power aria-hidden="true" size={13} />关闭终端</button>
        </div>
      </article>)}
    </div> : <div className="local-terminal-empty">
      <Terminal aria-hidden="true" size={22} />
      <strong>没有符合条件的本机终端</strong>
      <span>运行中的 Agent thread 和可重新附着的会话会显示在这里。</span>
    </div>}
  </section>;
}
