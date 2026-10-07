import {
  Activity,
  Bot,
  Check,
  ChevronRight,
  Circle,
  Command,
  Copy,
  Cpu,
  FolderGit2,
  GitBranch,
  Menu,
  PanelRight,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  User,
  Wifi,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type Session = {
  id: string;
  title: string;
  kind: "Worker" | "Agent";
  project: string;
  target: string;
  model: string;
  branch: string;
  task: string;
  loop: string;
  status: "running" | "starting";
};

const sessions: Session[] = [
  {
    id: "8da9d3aeec349340a6839af7cade8cec",
    title: "实现项目仓库凭据向导",
    kind: "Worker",
    project: "HUMANTHREAD",
    target: "linux-worker-02",
    model: "GPT-5 Codex · High",
    branch: "2026-HT100049-repo-credential",
    task: "HT-100049 项目仓库凭证向导",
    loop: "task-development@v12",
    status: "running",
  },
  {
    id: "b4c3a5154c4a973b409d97d3c9a7a8ee",
    title: "定位 Worker 领取后无输出的问题",
    kind: "Worker",
    project: "HUMANTHREAD",
    target: "etl-worker-01",
    model: "GPT-5 Codex · Medium",
    branch: "2026-HT100052-worker-trace",
    task: "HT-100052 修复 Worker 日志中断",
    loop: "task-development@v12",
    status: "running",
  },
  {
    id: "a30892fb74a6486bc80e40dbece04d5c",
    title: "梳理项目设置环境凭据入口",
    kind: "Agent",
    project: "HUMANTHREAD",
    target: "MacBook Pro · alice",
    model: "GPT-5 Codex · High",
    branch: "main",
    task: "直接会话",
    loop: "直接执行",
    status: "starting",
  },
];

const DEFAULT_SESSION = sessions[0]!;

const terminalLines = [
  { tone: "muted", text: "HumanThread Worker · session 8da9d3ae" },
  { tone: "success", text: "✓ connected to etl/live-session relay · latency 42ms" },
  { tone: "plain", text: "" },
  { tone: "label", text: "PROJECT   HUMANTHREAD" },
  { tone: "label", text: "TASK      HT-100049 项目仓库凭证向导" },
  { tone: "label", text: "BRANCH    2026-HT100049-repo-credential" },
  { tone: "label", text: "LOOP      task-development@v12" },
  { tone: "plain", text: "" },
  { tone: "accent", text: "codex › 我正在检查项目仓库配置与现有凭证注入边界。" },
  { tone: "plain", text: "" },
  { tone: "success", text: "  read   Project.workerRepositoryUrl" },
  { tone: "success", text: "  read   ProjectEnvironmentSecret" },
  { tone: "success", text: "  read   worker-worktree credential mapping" },
  { tone: "warning", text: "  note   account password is provider-dependent" },
  { tone: "plain", text: "" },
  { tone: "accent", text: "codex › 下一步将仓库创建入口、Token 最小权限和拉取校验串成同一向导。" },
  { tone: "plain", text: "" },
  { tone: "muted", text: "working · press Esc to interrupt · ctrl+j for commands" },
];

function StatusDot(props: { tone: "success" | "warning" | "muted" }) {
  return <span className="tui-status-dot" data-tone={props.tone} aria-hidden="true" />;
}

export function TuiWorkspacePreview() {
  const [selectedId, setSelectedId] = useState(DEFAULT_SESSION.id);
  const [controller, setController] = useState(true);
  const [online, setOnline] = useState(true);
  const [contextOpen, setContextOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? DEFAULT_SESSION,
    [selectedId],
  );

  function selectSession(sessionId: string) {
    setSelectedId(sessionId);
    setController(true);
    setOnline(true);
    setSessionPickerOpen(false);
  }

  return (
    <div className="tui-preview" data-context-open={String(contextOpen)}>
      <header className="tui-appbar">
        <div className="tui-brand">
          <img alt="" src="/brand/humanthread-mark.svg" />
          <div className="tui-brand-copy">
            <strong>HumanThread</strong>
            <span>在线会话</span>
          </div>
        </div>
        <div className="tui-breadcrumb" aria-label="当前位置">
          <span>工作台</span>
          <ChevronRight aria-hidden="true" size={13} />
          <span>在线会话</span>
          <ChevronRight aria-hidden="true" size={13} />
          <strong>{selected.kind}</strong>
        </div>
        <div className="tui-appbar-actions">
          <span className="tui-review-badge">交互预览</span>
          <button className="tui-icon-button tui-mobile-only" aria-label="打开会话列表" onClick={() => setSessionPickerOpen(true)} type="button">
            <Menu aria-hidden="true" size={16} />
          </button>
          <button className="tui-icon-button tui-context-trigger" aria-label="打开执行上下文" onClick={() => setContextOpen(true)} type="button">
            <PanelRight aria-hidden="true" size={16} />
          </button>
        </div>
      </header>

      <div className="tui-layout">
        <aside className="tui-session-rail" aria-label="进行中的会话">
          <div className="tui-rail-header">
            <div>
              <span className="tui-kicker">LIVE</span>
              <h1>进行中的会话</h1>
            </div>
            <button className="tui-icon-button" aria-label="新建会话" type="button">
              <Plus aria-hidden="true" size={16} />
            </button>
          </div>
          <label className="tui-search">
            <Search aria-hidden="true" size={14} />
            <input aria-label="搜索会话" placeholder="搜索会话" />
          </label>
          <div className="tui-session-list">
            {sessions.map((session) => {
              const active = session.id === selected.id;
              return (
                <button
                  aria-current={active ? "true" : undefined}
                  className="tui-session-item"
                  data-active={String(active)}
                  key={session.id}
                  onClick={() => selectSession(session.id)}
                  type="button"
                >
                  <span className="tui-session-icon" data-kind={session.kind.toLowerCase()}>
                    {session.kind === "Worker" ? <Server aria-hidden="true" size={15} /> : <Bot aria-hidden="true" size={15} />}
                  </span>
                  <span className="tui-session-copy">
                    <strong>{session.title}</strong>
                    <span>{session.project} · {session.target}</span>
                  </span>
                  <StatusDot tone={session.status === "running" ? "success" : "warning"} />
                </button>
              );
            })}
          </div>
          <div className="tui-rail-footer">
            <ShieldCheck aria-hidden="true" size={15} />
            <span>终端正文只存在于活动会话中</span>
          </div>
        </aside>

        <main className="tui-workspace">
          <section className="tui-terminal-shell" aria-label="在线 TUI 终端">
            <header className="tui-terminal-header">
              <div className="tui-terminal-title">
                <span className="tui-session-mark"><Terminal aria-hidden="true" size={16} /></span>
                <div>
                  <div className="tui-title-row">
                    <h2>{selected.title}</h2>
                    <span className="tui-status-pill" data-tone={online ? "success" : "danger"}>
                      <StatusDot tone={online ? "success" : "muted"} /> {online ? "运行中" : "已断开"}
                    </span>
                  </div>
                  <p>{selected.kind} · {selected.target} · {selected.model}</p>
                </div>
              </div>
              <div className="tui-terminal-actions">
                <button className="tui-toolbar-button" onClick={() => setOnline((value) => !value)} type="button">
                  <RefreshCw aria-hidden="true" size={14} />
                  {online ? "模拟断线" : "重新连接"}
                </button>
                <button className="tui-toolbar-button" data-primary="true" disabled={!online} onClick={() => setController((value) => !value)} type="button">
                  {controller ? <User aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}
                  {controller ? "释放控制" : "接管控制"}
                </button>
                <button className="tui-icon-button tui-close-button" aria-label="关闭会话" type="button">
                  <X aria-hidden="true" size={16} />
                </button>
              </div>
            </header>

            <div className="tui-terminal-statusbar">
              <span className="tui-connection-state" data-online={String(online)}>
                <Wifi aria-hidden="true" size={14} /> {online ? "Relay 已连接" : "Relay 已断开"}
              </span>
              <span><Radio aria-hidden="true" size={13} /> 执行端 {online ? "在线" : "离线"}</span>
              <span data-warning={String(!controller)}><ShieldCheck aria-hidden="true" size={13} /> {controller ? "你持有控制权" : "只读观察模式"}</span>
              <span className="tui-status-spacer" />
              <span><Activity aria-hidden="true" size={13} /> journal ready</span>
              <span>seq 4,281</span>
            </div>

            <div className="tui-terminal-canvas" data-online={String(online)}>
              <div className="tui-terminal-glow" aria-hidden="true" />
              {online ? (
                <div className="tui-terminal-content" role="log" aria-label="终端输出">
                  {terminalLines.map((line, index) => (
                    <div className="tui-terminal-line" data-tone={line.tone} key={`${index}:${line.text}`}>
                      {line.text || "\u00a0"}
                    </div>
                  ))}
                  <div className="tui-prompt-line">
                    <span className="tui-prompt-mark">›</span>
                    <span className="tui-caret" aria-hidden="true" />
                  </div>
                </div>
              ) : (
                <div className="tui-terminal-offline" role="status">
                  <RefreshCw aria-hidden="true" size={22} />
                  <strong>连接已暂停</strong>
                  <span>点击“重新连接”恢复终端和输入。</span>
                </div>
              )}
            </div>

            <footer className="tui-terminal-footer">
              <span><Command aria-hidden="true" size={13} /> 输入直接进入 PTY</span>
              <span>120 × 32</span>
              <span>UTF-8</span>
              <span className="tui-footer-spacer" />
              <span><Circle aria-hidden="true" size={8} fill="currentColor" /> 42 ms</span>
            </footer>
          </section>
        </main>

        <aside className="tui-context-panel" aria-label="执行上下文">
          <header className="tui-context-header">
            <div>
              <span className="tui-kicker">CONTEXT</span>
              <h2>执行上下文</h2>
            </div>
            <button className="tui-icon-button tui-context-close" aria-label="关闭执行上下文" onClick={() => setContextOpen(false)} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </header>
          <div className="tui-context-scroll">
            <section className="tui-context-section">
              <h3>项目与任务</h3>
              <div className="tui-context-row"><span><FolderGit2 aria-hidden="true" size={14} />项目</span><strong>{selected.project}</strong></div>
              <div className="tui-context-row"><span><Check aria-hidden="true" size={14} />Task</span><strong>{selected.task}</strong></div>
              <div className="tui-context-row"><span><GitBranch aria-hidden="true" size={14} />分支</span><code>{selected.branch}</code></div>
            </section>
            <section className="tui-context-section">
              <h3>执行</h3>
              <div className="tui-context-row"><span><Cpu aria-hidden="true" size={14} />目标</span><strong>{selected.target}</strong></div>
              <div className="tui-context-row"><span><Activity aria-hidden="true" size={14} />策略</span><strong>{selected.loop}</strong></div>
              <div className="tui-context-row"><span><Bot aria-hidden="true" size={14} />模型</span><strong>{selected.model}</strong></div>
            </section>
            <section className="tui-context-section">
              <h3>连接与恢复</h3>
              <div className="tui-context-row"><span><Wifi aria-hidden="true" size={14} />Relay</span><strong data-tone={online ? "success" : "danger"}>{online ? "已连接" : "已断开"}</strong></div>
              <div className="tui-context-row"><span><ShieldCheck aria-hidden="true" size={14} />控制权</span><strong data-tone={controller ? "success" : "warning"}>{controller ? "当前设备" : "其他会话"}</strong></div>
              <div className="tui-context-row"><span><RefreshCw aria-hidden="true" size={14} />Journal</span><strong>ready · 30 天</strong></div>
            </section>
            <section className="tui-context-note">
              <ShieldCheck aria-hidden="true" size={16} />
              <div>
                <strong>不保存会话正文</strong>
                <p>平台只代理活动会话的终端字节、控制权和在线状态。</p>
              </div>
            </section>
          </div>
        </aside>
      </div>

      {sessionPickerOpen ? (
        <div className="tui-mobile-layer" role="presentation">
          <button className="tui-mobile-backdrop" aria-label="关闭会话列表" onClick={() => setSessionPickerOpen(false)} type="button" />
          <section className="tui-mobile-sheet" aria-label="进行中的会话" role="dialog" aria-modal="true">
            <header>
              <div><span className="tui-kicker">LIVE</span><h2>进行中的会话</h2></div>
              <button className="tui-icon-button" aria-label="关闭会话列表" onClick={() => setSessionPickerOpen(false)} type="button"><X aria-hidden="true" size={16} /></button>
            </header>
            <div className="tui-session-list">
              {sessions.map((session) => <button className="tui-session-item" data-active={String(session.id === selected.id)} key={`mobile:${session.id}`} onClick={() => selectSession(session.id)} type="button"><span className="tui-session-icon" data-kind={session.kind.toLowerCase()}>{session.kind === "Worker" ? <Server aria-hidden="true" size={15} /> : <Bot aria-hidden="true" size={15} />}</span><span className="tui-session-copy"><strong>{session.title}</strong><span>{session.project} · {session.target}</span></span></button>)}
            </div>
          </section>
        </div>
      ) : null}

      {contextOpen ? (
        <div className="tui-mobile-layer tui-context-layer" role="presentation">
          <button className="tui-mobile-backdrop" aria-label="关闭执行上下文" onClick={() => setContextOpen(false)} type="button" />
          <section className="tui-mobile-sheet" aria-label="执行上下文" role="dialog" aria-modal="true">
            <header>
              <div><span className="tui-kicker">CONTEXT</span><h2>执行上下文</h2></div>
              <button className="tui-icon-button" aria-label="关闭执行上下文" onClick={() => setContextOpen(false)} type="button"><X aria-hidden="true" size={16} /></button>
            </header>
            <div className="tui-mobile-context">
              <div className="tui-context-row"><span>项目</span><strong>{selected.project}</strong></div>
              <div className="tui-context-row"><span>任务</span><strong>{selected.task}</strong></div>
              <div className="tui-context-row"><span>执行目标</span><strong>{selected.target}</strong></div>
              <div className="tui-context-row"><span>模型</span><strong>{selected.model}</strong></div>
              <div className="tui-context-row"><span>分支</span><code>{selected.branch}</code></div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
