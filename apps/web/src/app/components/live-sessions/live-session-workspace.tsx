"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  Bot,
  Plus,
  Search,
  Server,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { CreateLiveSessionInput, LiveSessionView } from "../../../../../../packages/shared/src/index";
import { WorkbenchButton } from "../workbench-ui";
import { LiveSessionContextPanel } from "./live-session-context-panel";
import { LiveSessionTerminal } from "./live-session-terminal";

type SpaceOption = { id: string; name: string };
type ProjectOption = { id: string; name: string; spaceId: string };
type TaskOption = { id: string; title: string; projectId: string; statusCategory: string };
type DeviceOption = { id: string; name: string; runtimeReady: boolean; online: boolean };
type WorkerPoolOption = { projectId: string; poolId: string; displayName: string; online: boolean };

export function LiveSessionWorkspace(props: {
  spaces: SpaceOption[];
  projects: ProjectOption[];
  tasks: TaskOption[];
  devices: DeviceOption[];
  workerPools: WorkerPoolOption[];
  sessions: LiveSessionView[];
  relayBaseUrl?: string;
}) {
  async function requestSession(input: CreateLiveSessionInput): Promise<{ session: LiveSessionView; ticket: { token: string } | null }> {
    const response = await fetch("/api/live-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json() as {
      ok?: boolean;
      result?: { session?: LiveSessionView; ticket?: { token: string } | null };
      error?: string;
    };
    if (!response.ok || !body.ok || !body.result?.session) {
      throw new Error(body.error ?? "会话创建失败");
    }
    return { session: body.result.session, ticket: body.result.ticket ?? null };
  }

  async function closeSession(sessionId: string): Promise<void> {
    const response = await fetch(`/api/live-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("会话关闭失败");
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    setSelectedSessionId((current) => (current === sessionId ? "" : current));
    setNotice(null);
  }

  const [kind, setKind] = useState<"agent" | "worker">("agent");
  const [surface] = useState<"web" | "android" | "desktop">("web");
  const [spaceId, setSpaceId] = useState(props.spaces[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [deviceId, setDeviceId] = useState(props.devices.find((device) => device.online && device.runtimeReady)?.id ?? "");
  const [modelSites, setModelSites] = useState<Array<{
    id: string;
    name: string;
    models: Array<{ name: string; label: string }>;
  }>>([]);
  const [modelDefault, setModelDefault] = useState<{
    siteId: string;
    model: string;
    reasoningEffort: string;
  } | null>(null);
  const [modelDefaultSource, setModelDefaultSource] = useState<"project-binding" | "desktop-account" | null>(null);
  const [modelUnavailableReason, setModelUnavailableReason] = useState<string | null>(null);
  const [modelSiteId, setModelSiteId] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelEffort, setModelEffort] = useState("high");
  const [cacheHelpOpen, setCacheHelpOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState(props.sessions);
  const [selectedSessionId, setSelectedSessionId] = useState(props.sessions[0]?.id ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [closeCandidate, setCloseCandidate] = useState<LiveSessionView | null>(null);
  const [closePending, setClosePending] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);

  useEffect(() => {
    setSessions(props.sessions);
    setSelectedSessionId((current) => current || props.sessions[0]?.id || "");
  }, [props.sessions]);

  const availableProjects = useMemo(
    () => props.projects.filter((project) => project.spaceId === spaceId),
    [props.projects, spaceId],
  );
  const availableTasks = useMemo(
    () => props.tasks.filter((task) => task.projectId === projectId && task.statusCategory !== "completed" && task.statusCategory !== "cancelled"),
    [projectId, props.tasks],
  );
  const selectedPool = props.workerPools.find((pool) => pool.projectId === projectId) ?? null;
  const selectedDevice = props.devices.find((device) => device.id === deviceId) ?? null;
  const onlineDevices = props.devices.filter((device) => device.online && device.runtimeReady);
  const effectiveProjectId = availableProjects.some((project) => project.id === projectId) ? projectId : "";
  const effectiveTaskId = availableTasks.some((task) => task.id === taskId) ? taskId : "";
  const executionPolicy = effectiveProjectId && effectiveTaskId ? "loop" : "direct";
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
  const visibleSessions = sessions
    .filter((session) => {
      const query = sessionSearch.trim().toLowerCase();
      if (!query) return true;
      return `${session.targetDisplayName} ${session.kind} ${session.executionPolicy}`.toLowerCase().includes(query);
    })
    // Live sessions stay at the top. Auto-created Loop sessions outlive their
    // Attempt by the full TTL, and their newest-first rows used to bury the
    // session the user was actually watching.
    .slice()
    .sort((left, right) => Number(left.history === true) - Number(right.history === true));
  const selectedModelSite = modelSites.find((site) => site.id === modelSiteId) ?? null;

  function modelSelectionPayload(): CreateLiveSessionInput["modelSelection"] {
    if (!modelSiteId || !modelName.trim()) return null;
    return { siteId: modelSiteId, model: modelName, reasoningEffort: modelEffort as never };
  }

  async function createSession() {
    const validationMessage = kind === "agent"
      ? !spaceId
        ? "请选择 Space"
        : !selectedDevice || !selectedDevice.online || !selectedDevice.runtimeReady
          ? "请选择在线的 Agent 设备"
          : null
      : !spaceId
        ? "请选择 Space"
        : !effectiveProjectId
          ? "Worker 会话必须选择项目"
          : !selectedPool
            ? "所选项目未绑定 Worker Pool"
            : !selectedPool.online
              ? "所选项目的 Worker Pool 离线"
              : null;
    if (validationMessage) {
      setNotice(validationMessage);
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const input: CreateLiveSessionInput = kind === "agent"
        ? {
            commandId: crypto.randomUUID().replaceAll("-", "").slice(0, 32),
            kind,
            surface,
            spaceId,
            projectId: effectiveProjectId || null,
            taskId: effectiveTaskId || null,
            executionPolicy,
            target: { type: "agent_device", deviceId },
            modelSelection: modelSelectionPayload(),
            businessRunId: null,
            initialCols: 120,
            initialRows: 36,
          }
        : {
            commandId: crypto.randomUUID().replaceAll("-", "").slice(0, 32),
            kind,
            surface,
            spaceId,
            projectId: effectiveProjectId || null,
            taskId: effectiveTaskId || null,
            executionPolicy,
            target: { type: "worker_pool" },
            modelSelection: modelSelectionPayload(),
            businessRunId: null,
            initialCols: 120,
            initialRows: 36,
          };
      const created = await requestSession(input);
      setSessions((current) => [created.session, ...current.filter((session) => session.id !== created.session.id)]);
      setSelectedSessionId(created.session.id);
      setCreateOpen(false);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "会话创建失败");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    const query = new URLSearchParams({ kind, spaceId });
    if (kind === "worker" && effectiveProjectId) query.set("projectId", effectiveProjectId);
    if (kind === "agent" && deviceId) query.set("deviceId", deviceId);
    let cancelled = false;
    void (async () => {
      if (!spaceId || (kind === "worker" && !effectiveProjectId) || (kind === "agent" && !deviceId)) {
        setModelSites([]);
        setModelDefault(null);
        setModelDefaultSource(null);
        setModelUnavailableReason(null);
        setModelSiteId("");
        setModelName("");
        return;
      }
      try {
        const response = await fetch(`/api/live-sessions/model-options?${query.toString()}`);
        const body = await response.json() as {
          ok?: boolean;
          result?: {
            sites?: Array<{ id: string; name: string; models: Array<{ name: string; label: string }> }>;
            default?: { siteId: string; model: string; reasoningEffort: string } | null;
            defaultSource?: "project-binding" | "desktop-account" | null;
            unavailableReason?: string | null;
          };
        };
        if (cancelled) return;
        if (!response.ok || !body.ok) {
          setModelSites([]);
          setModelDefault(null);
          setModelDefaultSource(null);
          setModelUnavailableReason("options_unavailable");
          return;
        }
        setModelSites(body.result?.sites ?? []);
        setModelDefault(body.result?.default ?? null);
        setModelDefaultSource(body.result?.defaultSource ?? null);
        setModelUnavailableReason(body.result?.unavailableReason ?? null);
        setModelSiteId("");
        setModelName("");
        setModelEffort(body.result?.default?.reasoningEffort ?? "high");
      } catch {
        if (cancelled) return;
        setModelSites([]);
        setModelDefault(null);
        setModelDefaultSource(null);
        setModelUnavailableReason("options_unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId, effectiveProjectId, kind, spaceId]);

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setMobileSessionsOpen(false);
  }

  const sessionRail = <div className="tui-session-list">
    {visibleSessions.length === 0 ? <p className="px-3 py-6 text-xs leading-5 text-[#57606a]">当前没有可查看的会话。已结束的会话会保留为历史日志。</p> : visibleSessions.map((session) => {
      const selected = session.id === selectedSession?.id;
      return <button
        key={session.id}
        type="button"
        aria-label={`打开 ${session.id}`}
        aria-current={selected ? "true" : undefined}
        onClick={() => selectSession(session.id)}
        className="tui-session-item"
        data-active={String(selected)}
      >
        <span className="tui-session-icon" data-kind={session.kind}>{session.kind === "worker" ? <Server aria-hidden="true" size={15} /> : <Bot aria-hidden="true" size={15} />}</span>
        <span className="tui-session-copy"><strong>{session.targetDisplayName}</strong><span>{session.kind === "worker" ? "Worker" : "Agent"} · {session.executionPolicy === "loop" ? "Loop" : "直接执行"}{session.history ? " · 历史" : ""}</span></span>
        <span
          className="tui-status-dot"
          data-tone={session.history ? "history" : session.status === "running" ? "success" : "warning"}
          title={session.history ? "历史会话" : "在线会话"}
          aria-label={session.history ? "历史会话" : "在线会话"}
          role="img"
        />
      </button>;
    })}
  </div>;

  const createDialog = <Dialog.Root open={createOpen} onOpenChange={(open) => { if (!pending) setCreateOpen(open); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[70] bg-[#24292f66]" />
      <Dialog.Content className="fixed bottom-0 right-0 top-0 z-[70] w-[min(94vw,620px)] overflow-y-auto border-l border-[#d0d7de] bg-white p-5 shadow-2xl outline-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-base font-semibold text-[#24292f]">新建在线会话</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-6 text-[#57606a]">选择 Agent 或 Worker。关联任务后使用 Loop，否则直接启动执行。</Dialog.Description>
          </div>
          <Dialog.Close className="grid h-9 w-9 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa]" aria-label="关闭新建会话">
            <X aria-hidden="true" size={17} />
          </Dialog.Close>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold">空间
            <select aria-label="空间" value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
              {props.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">{kind === "worker" ? "项目（必选）" : "项目（可选）"}
            <select aria-label="项目" value={effectiveProjectId} onChange={(event) => { setProjectId(event.target.value); setTaskId(""); }}>
              <option value="">不关联项目</option>
              {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">任务（可选）
            <select aria-label="任务" value={effectiveTaskId} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">不关联任务</option>
              {availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1 text-sm font-semibold">执行目标
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-1" role="group" aria-label="执行目标">
              <button aria-label="Agent" aria-pressed={kind === "agent"} className="min-h-8 flex-1 rounded px-3 text-sm font-semibold aria-pressed:bg-white aria-pressed:shadow-sm" onClick={() => setKind("agent")} type="button">Agent</button>
              <button aria-label="Worker" aria-pressed={kind === "worker"} className="min-h-8 flex-1 rounded px-3 text-sm font-semibold aria-pressed:bg-white aria-pressed:shadow-sm" onClick={() => setKind("worker")} type="button">Worker</button>
            </div>
          </div>
          {kind === "agent" ? <label className="grid gap-1 text-sm font-semibold">在线 Agent 设备
            <select aria-label="在线 Agent 设备" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">请选择设备</option>
              {onlineDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
            </select>
          </label> : <div className="grid gap-1 text-sm font-semibold">项目 Worker Pool
            <span aria-label="项目 Worker Pool">{selectedPool ? `${selectedPool.displayName} · ${selectedPool.online ? "在线" : "离线"}` : "选择项目后解析"}</span>
          </div>}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold">模型站点
            <select aria-label="模型站点" value={modelSiteId} onChange={(event) => { setModelSiteId(event.target.value); setModelName(""); }}>
              <option value="">{kind === "worker" ? "项目默认" : "账号默认"}</option>
              {modelSites.map((site) => <option key={site.id} value={site.id} disabled={site.models.length === 0}>{site.name}{site.models.length === 0 ? " · 未配置模型" : ""}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">模型
            <select aria-label="模型" value={modelName} disabled={!selectedModelSite} onChange={(event) => setModelName(event.target.value)}>
              <option value="">{selectedModelSite ? "请选择模型" : "使用默认模型"}</option>
              {selectedModelSite?.models.map((entry) => <option key={entry.name} value={entry.name}>{entry.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">推理强度
            <select aria-label="推理强度" value={modelEffort} onChange={(event) => setModelEffort(event.target.value)}>
              {["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => <option key={effort} value={effort}>{effort}</option>)}
            </select>
          </label>
        </div>
        {modelDefault || modelUnavailableReason ? <p className="mt-2 text-xs text-[#57606a]">
          {modelDefault ? `不选择时使用${modelDefaultSource === "project-binding" ? "项目默认" : "账号默认"}：${modelDefault.model} · ${modelDefault.reasoningEffort}` : "模型站点暂时无法读取，将使用服务端默认值。"}
        </p> : null}
        {notice ? <p className="mt-3 text-sm text-[#57606a]" role="status">{notice}</p> : null}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#d8dee4] pt-4">
          <div className="relative">
            <button aria-label="本地会话缓存说明" className="grid h-8 w-8 place-items-center rounded-full border border-[#d0d7de] bg-white text-[#9a6700]" onBlur={() => setCacheHelpOpen(false)} onFocus={() => setCacheHelpOpen(true)} onMouseEnter={() => setCacheHelpOpen(true)} onMouseLeave={() => setCacheHelpOpen(false)} type="button">
              <AlertCircle aria-hidden="true" size={17} />
            </button>
            {cacheHelpOpen ? <div role="tooltip" className="absolute bottom-10 left-0 z-20 w-[min(70vw,360px)] rounded-lg border border-[#d0d7de] bg-white p-3 text-sm shadow-lg">
              <strong>本地会话缓存</strong>
              <p className="mt-1 leading-6 text-[#57606a]">本地缓存删除后，刷新页面不会恢复这部分内容；服务端只做实时转发，不保留会话正文。</p>
            </div> : null}
          </div>
          <WorkbenchButton disabled={pending} onClick={() => void createSession()} type="button">
            <Plus aria-hidden="true" size={15} />创建会话
          </WorkbenchButton>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;

  const closeDialog = <Dialog.Root open={Boolean(closeCandidate)} onOpenChange={(open) => { if (!open && !closePending) setCloseCandidate(null); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-[#24292f66]" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#d0d7de] bg-white p-5 shadow-2xl outline-none">
        <Dialog.Title className="text-base font-semibold text-[#24292f]">关闭在线会话？</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-6 text-[#57606a]">关闭后，该会话会立即从在线列表和 Relay 中移除。任务、Loop 和已产出的业务结果不会被删除。</Dialog.Description>
        {notice ? <p className="mt-3 text-sm text-[#cf222e]" role="status">{notice}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <WorkbenchButton disabled={closePending} onClick={() => setCloseCandidate(null)} type="button">取消</WorkbenchButton>
          <WorkbenchButton disabled={closePending} variant="danger" onClick={() => {
            if (!closeCandidate) return;
            setClosePending(true);
            setNotice(null);
            void closeSession(closeCandidate.id).then(() => {
              setCloseCandidate(null);
            }).catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : "会话关闭失败");
            }).finally(() => setClosePending(false));
          }} type="button">关闭会话</WorkbenchButton>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;

  return <div className="live-session-page">
    <div className="tui-layout">
      <aside className="tui-session-rail" aria-label="进行中的会话">
        <div className="tui-rail-header">
          <div><span className="tui-kicker">LIVE</span><h1>进行中的会话</h1></div>
          <button className="tui-icon-button" aria-label="新建会话" onClick={() => setCreateOpen(true)} type="button"><Plus aria-hidden="true" size={16} /></button>
        </div>
        <label className="tui-search"><Search aria-hidden="true" size={14} /><input aria-label="搜索会话" value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="搜索会话" /></label>
        {sessionRail}
        <div className="tui-rail-footer"><Terminal aria-hidden="true" size={14} /><span>绿色在线 · 橙色接入中 · 灰色历史</span></div>
      </aside>

      <main className="tui-workspace">
        {selectedSession ? <LiveSessionTerminal
          key={selectedSession.id}
          session={selectedSession}
          {...(props.relayBaseUrl ? { relayBaseUrl: props.relayBaseUrl } : {})}
          onClose={() => setCloseCandidate(selectedSession)}
          onOpenSessions={() => setMobileSessionsOpen(true)}
          onOpenContext={() => setMobileContextOpen(true)}
        /> : <section className="tui-terminal-shell"><div className="tui-terminal-empty"><div><Terminal aria-hidden="true" className="mx-auto text-[#8c959f]" size={28} /><p className="mt-3 text-sm font-semibold text-[#24292f]">还没有进行中的会话</p><p className="mt-1 text-sm text-[#57606a]">新建会话后，终端会显示在这里。</p><WorkbenchButton className="mt-4" onClick={() => setCreateOpen(true)} type="button" aria-label="新建在线会话"><Plus aria-hidden="true" size={15} />新建会话</WorkbenchButton></div></div></section>}
        {notice ? <p className="mt-2 text-sm text-[#cf222e]" role="status">{notice}</p> : null}
      </main>

      {selectedSession ? <LiveSessionContextPanel session={selectedSession} projects={props.projects} tasks={props.tasks} /> : null}
    </div>

    {mobileSessionsOpen ? <div className="tui-mobile-layer" role="presentation">
      <button className="tui-mobile-backdrop" aria-label="关闭会话列表" onClick={() => setMobileSessionsOpen(false)} type="button" />
      <section className="tui-mobile-sheet" aria-label="进行中的会话" role="dialog" aria-modal="true">
        <header><div><span className="tui-kicker">LIVE</span><h2>进行中的会话</h2></div><div className="flex items-center gap-2"><button className="tui-icon-button" aria-label="新建会话" onClick={() => { setMobileSessionsOpen(false); setCreateOpen(true); }} type="button"><Plus aria-hidden="true" size={16} /></button><button className="tui-icon-button" aria-label="关闭会话列表" onClick={() => setMobileSessionsOpen(false)} type="button"><X aria-hidden="true" size={16} /></button></div></header>
        {sessionRail}
      </section>
    </div> : null}

    {mobileContextOpen && selectedSession ? <div className="tui-mobile-layer tui-context-layer" role="presentation">
      <button className="tui-mobile-backdrop" aria-label="关闭执行上下文" onClick={() => setMobileContextOpen(false)} type="button" />
      <section className="tui-mobile-sheet" aria-label="执行上下文" role="dialog" aria-modal="true">
        <header><div><span className="tui-kicker">CONTEXT</span><h2>执行上下文</h2></div><button className="tui-icon-button" aria-label="关闭执行上下文" onClick={() => setMobileContextOpen(false)} type="button"><X aria-hidden="true" size={16} /></button></header>
        <div className="tui-mobile-context">
          <div className="tui-context-row"><span>项目</span><strong>{props.projects.find((project) => project.id === selectedSession.projectId)?.name ?? "未关联项目"}</strong></div>
          <div className="tui-context-row"><span>任务</span><strong>{props.tasks.find((task) => task.id === selectedSession.taskId)?.title ?? "直接会话"}</strong></div>
          <div className="tui-context-row"><span>执行目标</span><strong>{selectedSession.targetDisplayName}</strong></div>
          <div className="tui-context-row"><span>模型</span><strong>{selectedSession.model?.model ?? "默认模型"}</strong></div>
        </div>
      </section>
    </div> : null}

    {createDialog}
    {closeDialog}
  </div>;
}
