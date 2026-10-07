"use client";

import {
  Activity as ActivityIcon,
  Command as CommandIcon,
  FileText as FileTextIcon,
  Menu as MenuIcon,
  PanelRight,
  Radio as RadioIcon,
  RefreshCw as RefreshCwIcon,
  ShieldCheck,
  Terminal,
  User as UserIcon,
  Wifi as WifiIcon,
  X as XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { LiveSessionView } from "../../../../../../packages/shared/src/index";

type TerminalInstance = {
  loadAddon(addon: unknown): void;
  open(element: HTMLElement): void;
  write(data: Uint8Array | string): void;
  onData(handler: (data: string) => void): { dispose(): void };
  readonly rows: number;
  readonly cols: number;
  dispose(): void;
};

type FitAddonInstance = { fit(): void };

function encodeInput(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function LiveSessionTerminal(props: {
  session: LiveSessionView;
  relayBaseUrl?: string;
  onClose?: () => void;
  onOpenSessions?: () => void;
  onOpenContext?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const fitRef = useRef<FitAddonInstance | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const controllerRef = useRef(false);
  const claimedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const [retryKey, setRetryKey] = useState(0);
  const [status, setStatus] = useState<"connecting" | "online" | "reconnecting" | "closed" | "error">("connecting");
  const [targetOnline, setTargetOnline] = useState(false);
  const [controller, setController] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ cols: 120, rows: 36 });

  useEffect(() => {
    controllerRef.current = controller;
  }, [controller]);

  useEffect(() => {
    const syncTerminalSize = () => {
      fitRef.current?.fit();
      const socket = socketRef.current;
      const terminal = terminalRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !terminal) return;
      setSize({ cols: terminal.cols, rows: terminal.rows });
      socket.send(JSON.stringify({ type: "control.resize", rows: terminal.rows, cols: terminal.cols }));
    };
    window.addEventListener("resize", syncTerminalSize);
    const observer = typeof ResizeObserver === "function" && hostRef.current
      ? new ResizeObserver(syncTerminalSize)
      : null;
    if (observer && hostRef.current) observer.observe(hostRef.current);
    return () => {
      window.removeEventListener("resize", syncTerminalSize);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let terminal: TerminalInstance | null = null;
    let fitAddon: FitAddonInstance | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    claimedRef.current = false;
    /**
     * Claims the control lease at most once per socket. The relay forwards
     * `control.input` only from the controller, so a viewer that never claims
     * looks like a terminal where the cursor ignores the keyboard.
     */
    const claimControlOnce = () => {
      if (claimedRef.current) return;
      // History has no executor left; claiming control would only produce a
      // lease nobody can serve.
      if (props.session.history === true) return;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      claimedRef.current = true;
      socket.send(JSON.stringify({ type: "control.claim" }));
    };
    /**
     * Publishes the viewer's real geometry. The PTY is created at a fixed
     * default (120x36), so without this the TUI keeps rendering for a
     * desktop-sized canvas and appears as a clipped strip on smaller screens.
     */
    const sendResize = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN || !terminal) return;
      if (!Number.isFinite(terminal.rows) || !Number.isFinite(terminal.cols)) return;
      socket.send(JSON.stringify({ type: "control.resize", rows: terminal.rows, cols: terminal.cols }));
    };
    void (async () => {
      const ticketResponse = await fetch(`/api/live-sessions/${encodeURIComponent(props.session.id)}/ticket`, { method: "POST" });
      const ticketBody = await ticketResponse.json() as { ok?: boolean; result?: { ticket?: { token?: string } }; error?: string };
      const token = ticketBody.result?.ticket?.token;
      if (!ticketResponse.ok || !ticketBody.ok || !token) throw new Error(ticketBody.error ?? "无法签发会话票据");
      if (disposed) return;
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !hostRef.current) return;
      terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        scrollback: 5_000,
        theme: { background: "#0d1117", foreground: "#c9d1d9", cursor: "#c9d1d9" },
      }) as unknown as TerminalInstance;
      fitAddon = new FitAddon() as unknown as FitAddonInstance;
      terminal.loadAddon(fitAddon);
      terminal.open(hostRef.current);
      fitAddon.fit();
      setSize({ cols: terminal.cols, rows: terminal.rows });
      terminalRef.current = terminal;
      fitRef.current = fitAddon;
      dataDisposable = terminal.onData((data) => {
        if (!controllerRef.current || socket?.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "control.input", bytesBase64: encodeInput(data) }));
      });
      const base = props.relayBaseUrl ?? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
      const url = new URL("/live-session/control", base);
      url.searchParams.set("sessionId", props.session.id);
      url.searchParams.set("ticket", token);
      socket = new WebSocket(url);
      socketRef.current = socket;
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setStatus("online");
        // A terminal that silently drops keystrokes reads as broken. The relay
        // only forwards input from the connection holding the control lease, so
        // the viewer takes it as soon as the socket is usable; the toolbar still
        // allows handing control back.
        claimControlOnce();
        sendResize();
      };
      socket.onclose = () => {
        if (disposed) return;
        const attempt = reconnectAttemptRef.current;
        if (attempt < 5) {
          reconnectAttemptRef.current = attempt + 1;
          setStatus("reconnecting");
          reconnectTimer = setTimeout(() => setRetryKey((value) => value + 1), Math.min(1_000 * 2 ** attempt, 10_000));
        } else {
          setStatus("closed");
        }
      };
      socket.onerror = () => setStatus("error");
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          terminal?.write(new Uint8Array(event.data as ArrayBuffer));
          return;
        }
        try {
          const message = JSON.parse(event.data) as { type?: string };
          if (message.type === "control.claimed") setController(true);
          if (message.type === "control.released") setController(false);
          if ((message.type === "server.hello" || message.type === "server.state") && typeof (message as { targetOnline?: unknown }).targetOnline === "boolean") {
            const online = (message as { targetOnline: boolean }).targetOnline;
            setTargetOnline(online);
            if (online) claimControlOnce();
          }
        } catch {
          // Relay control frames are JSON; malformed frames are ignored.
        }
      };
    })().catch((caught: unknown) => {
      if (disposed) return;
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "终端连接失败");
    });
    return () => {
      disposed = true;
      claimedRef.current = false;
      dataDisposable?.dispose();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "viewer left");
      socketRef.current = null;
      terminal?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [props.relayBaseUrl, props.session.id, retryKey]);

  const toggleControl = () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: controller ? "control.release" : "control.claim" }));
  };

  // A finished session is history: its execution will never attach again, so
  // showing "waiting for the executor" over its log is misleading. The relay
  // still serves the recorded journal, which is what the user came to read.
  const history = props.session.history === true;
  const waitingForTarget = !history && (props.session.status === "starting" || !targetOnline);
  const relayLabel = status === "online"
    ? "Relay 已连接"
    : status === "closed"
      ? "Relay 已断开"
      : status === "error"
        ? "Relay 连接失败"
        : "正在连接 Relay";
  const controlLabel = history ? "历史日志" : waitingForTarget ? "等待执行端" : controller ? "释放控制" : "接管控制";

  return <section className="tui-terminal-shell" aria-label={`在线终端 ${props.session.id}`}>
    <header className="tui-terminal-header">
      <div className="tui-terminal-title">
        <span className="tui-session-mark"><Terminal aria-hidden="true" size={16} /></span>
        <div>
          <div className="tui-title-row">
            <h2>{props.session.targetDisplayName}</h2>
            <span className="tui-status-pill" data-tone={history ? "history" : status === "online" ? "success" : "danger"}>
              {history ? "历史" : status === "online" ? "运行中" : status === "connecting" ? "连接中" : status === "closed" ? "已断开" : "连接失败"}
            </span>
          </div>
          <p>{props.session.kind === "agent" ? "Agent" : "Worker"} · {props.session.targetDisplayName} · {props.session.model?.model ?? "默认模型"}</p>
        </div>
      </div>
      <div className="tui-terminal-actions">
        {props.onOpenSessions ? <button className="tui-icon-button tui-mobile-only" aria-label="打开会话列表" onClick={props.onOpenSessions} type="button">
          <MenuIcon aria-hidden="true" size={16} />
        </button> : null}
        {props.onOpenContext ? <button className="tui-icon-button tui-context-trigger" aria-label="打开执行上下文" onClick={props.onOpenContext} type="button">
          <PanelRight aria-hidden="true" size={16} />
        </button> : null}
        <button className="tui-toolbar-button" data-primary="true" disabled={history || waitingForTarget} onClick={toggleControl} type="button">
          {history ? <FileTextIcon aria-hidden="true" size={14} /> : controller ? <UserIcon aria-hidden="true" size={14} /> : <ShieldCheck aria-hidden="true" size={14} />}
          {controlLabel}
        </button>
        <button className="tui-toolbar-button" onClick={() => setRetryKey((value) => value + 1)} type="button">
          <RefreshCwIcon aria-hidden="true" size={14} />重新连接
        </button>
        {props.onClose ? <button className="tui-icon-button tui-close-button" aria-label="关闭会话" onClick={props.onClose} type="button">
          <XIcon aria-hidden="true" size={16} />
        </button> : null}
      </div>
    </header>
    <div className="tui-terminal-statusbar">
      <span className="tui-connection-state" data-online={String(status === "online")}><WifiIcon aria-hidden="true" size={14} /> {relayLabel}</span>
      <span><RadioIcon aria-hidden="true" size={13} /> {history ? "执行端 已结束" : `执行端 ${targetOnline ? "在线" : "离线"}`}</span>
      <span data-warning={String(!controller)}><ShieldCheck aria-hidden="true" size={13} /> {controller ? "你持有控制权" : "只读观察模式"}</span>
      <span className="tui-status-spacer" />
      <span><ActivityIcon aria-hidden="true" size={13} /> journal {props.session.journal.status}</span>
      <span>seq {props.session.journal.lastSequence.toLocaleString("en-US")}</span>
    </div>
    <div className="tui-terminal-canvas">
      <div className="tui-terminal-host" ref={hostRef} />
      {waitingForTarget ? <div className="tui-terminal-waiting" role="status">
        <RefreshCwIcon aria-hidden="true" size={20} />
        <strong>等待执行端接入</strong>
        <span>只有 Agent 设备或 Worker Pool 连接到执行网关后，终端才会输出并可输入。</span>
      </div> : null}
      {error ? <p className="tui-terminal-error" role="alert">{error}</p> : null}
    </div>
    <footer className="tui-terminal-footer">
      <span><CommandIcon aria-hidden="true" size={13} /> 输入直接进入 PTY</span>
      <span>{size.cols} × {size.rows}</span>
      <span>UTF-8</span>
      <span className="tui-footer-spacer" />
      <span>stdin · stdout</span>
    </footer>
  </section>;
}
