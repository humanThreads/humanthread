"use client";

import {
  Activity,
  Bot,
  Check,
  Cpu,
  FolderGit2,
  Radio,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";

import type { LiveSessionView } from "../../../../../../packages/shared/src/index";

type ProjectOption = { id: string; name: string; spaceId: string };
type TaskOption = { id: string; title: string; projectId: string; statusCategory: string };

export function LiveSessionContextPanel(props: {
  session: LiveSessionView;
  projects: ProjectOption[];
  tasks: TaskOption[];
  onClose?: () => void;
}) {
  const project = props.session.projectId
    ? props.projects.find((candidate) => candidate.id === props.session.projectId) ?? null
    : null;
  const task = props.session.taskId
    ? props.tasks.find((candidate) => candidate.id === props.session.taskId) ?? null
    : null;
  // A finished session keeps its row so the journal stays readable, but it has
  // no live relay and no control lease to hand out.
  const history = props.session.history === true;
  const relayOnline = !history && props.session.status === "running";
  const hasControl = props.session.controlState === "controller";

  return <aside className="tui-context-panel" aria-label="执行上下文">
    <header className="tui-context-header">
      <div>
        <span className="tui-kicker">CONTEXT</span>
        <h2>执行上下文</h2>
      </div>
      {props.onClose ? <button className="tui-icon-button tui-context-close" aria-label="关闭执行上下文" onClick={props.onClose} type="button">
        <X aria-hidden="true" size={16} />
      </button> : null}
    </header>
    <div className="tui-context-scroll">
      <section className="tui-context-section">
        <h3>项目与任务</h3>
        <div className="tui-context-row"><span><FolderGit2 aria-hidden="true" size={14} />项目</span><strong>{project?.name ?? "未关联项目"}</strong></div>
        <div className="tui-context-row"><span><Check aria-hidden="true" size={14} />Task</span><strong>{task?.title ?? "直接会话"}</strong></div>
        <div className="tui-context-row"><span><Radio aria-hidden="true" size={14} />策略</span><strong>{props.session.executionPolicy === "loop" ? "Loop 编排" : "直接执行"}</strong></div>
      </section>
      <section className="tui-context-section">
        <h3>执行</h3>
        <div className="tui-context-row"><span><Cpu aria-hidden="true" size={14} />目标</span><strong>{props.session.targetDisplayName}</strong></div>
        <div className="tui-context-row"><span><Bot aria-hidden="true" size={14} />类型</span><strong>{props.session.kind === "agent" ? "Agent" : "Worker"}</strong></div>
        <div className="tui-context-row"><span><Activity aria-hidden="true" size={14} />模型</span><strong>{props.session.model ? `${props.session.model.model} · ${props.session.model.reasoningEffort}` : "使用默认模型"}</strong></div>
      </section>
      <section className="tui-context-section">
        <h3>连接与恢复</h3>
        <div className="tui-context-row"><span><Wifi aria-hidden="true" size={14} />Relay</span><strong data-tone={history ? "history" : relayOnline ? "success" : "warning"}>{history ? "历史日志" : relayOnline ? "会话运行中" : props.session.status}</strong></div>
        <div className="tui-context-row"><span><ShieldCheck aria-hidden="true" size={14} />控制权</span><strong data-tone={history ? "history" : hasControl ? "success" : "warning"}>{history ? "已结束" : hasControl ? "当前设备" : props.session.controlState === "viewer" ? "只读观察" : "未接管"}</strong></div>
        <div className="tui-context-row"><span><Activity aria-hidden="true" size={14} />Journal</span><strong>{props.session.journal.status} · {props.session.journal.retentionDays} 天</strong></div>
      </section>
      <section className="tui-context-note">
        <ShieldCheck aria-hidden="true" size={16} />
        <div>
          <strong>不保存会话正文</strong>
          <p>平台只代理活动会话的终端字节、控制权和在线状态。</p>
        </div>
      </section>
    </div>
  </aside>;
}
