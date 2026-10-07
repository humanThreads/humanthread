import {
  Ban,
  CirclePause,
  Link2,
  Play,
  Radio,
  RotateCcw,
  Unplug,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CodexTuiClient, CodexTuiSession } from "../../lib/codex-tui-client";

type TerminalInstance = {
  loadAddon(addon: unknown): void;
  open(element: HTMLElement): void;
  write(data: Uint8Array | string): void;
  onData(handler: (data: string) => void): { dispose(): void };
  dispose(): void;
};

type FitAddonInstance = { fit(): void };

function encodeInput(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function controlLabel(session: CodexTuiSession): string {
  if (session.status === "starting") return "启动中";
  if (session.status === "detached") return "已分离";
  if (session.status === "interrupted") return "已中断";
  return session.controlState === "controller" ? "已接管" : "只读";
}

function controlTone(session: CodexTuiSession): string {
  if (session.status === "interrupted") return "danger";
  if (session.status === "detached" || session.status === "starting") return "warning";
  return session.controlState === "controller" ? "success" : "neutral";
}

export function LocalTerminalView(props: {
  session: CodexTuiSession;
  client: CodexTuiClient;
  onSessionChange?(session: CodexTuiSession): void;
  onError?(message: string): void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const fitRef = useRef<FitAddonInstance | null>(null);
  const sessionRef = useRef(props.session);
  const [session, setSession] = useState(props.session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    setSession(props.session);
  }, [props.session]);

  useEffect(() => {
    let disposed = false;
    let terminal: TerminalInstance | null = null;
    let fitAddon: FitAddonInstance | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    let stopOutput: (() => void) | null = null;
    let stopState: (() => void) | null = null;
    void (async () => {
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
      }) as unknown as TerminalInstance;
      fitAddon = new FitAddon() as unknown as FitAddonInstance;
      terminal.loadAddon(fitAddon);
      terminal.open(hostRef.current);
      terminalRef.current = terminal;
      fitRef.current = fitAddon;
      dataDisposable = terminal.onData((data) => {
        if (sessionRef.current.status !== "running" || sessionRef.current.controlState !== "controller") return;
        void props.client.write(sessionRef.current.sessionId, encodeInput(data)).catch(() => undefined);
      });
      // Subscribe before reading the replay snapshot so output produced during
      // attach is buffered rather than dropped on the floor.
      const buffered: string[] = [];
      let replayReady = false;
      stopOutput = await props.client.subscribeOutput((output) => {
        if (output.sessionId !== sessionRef.current.sessionId) return;
        if (!replayReady) {
          buffered.push(output.deltaBase64);
          return;
        }
        terminal?.write(decodeBase64(output.deltaBase64));
      });
      const attach = await props.client.attach(sessionRef.current.sessionId);
      if (disposed) return;
      if (attach.replayBase64) terminal.write(decodeBase64(attach.replayBase64));
      replayReady = true;
      for (const delta of buffered.splice(0)) terminal.write(decodeBase64(delta));
      setSession(attach.session);
      props.onSessionChange?.(attach.session);
      fitAddon.fit();
      stopState = await props.client.subscribeState((next) => {
        if (next.sessionId !== sessionRef.current.sessionId) return;
        setSession(next);
        props.onSessionChange?.(next);
      });
    })().catch((caught: unknown) => {
      const message = caught instanceof Error ? caught.message : "终端初始化失败";
      setError(message);
      props.onError?.(message);
    });
    return () => {
      disposed = true;
      stopOutput?.();
      stopState?.();
      dataDisposable?.dispose();
      terminal?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [props.client, props.onError, props.onSessionChange, props.session.sessionId]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const fit = fitRef.current;
      const terminal = terminalRef.current;
      if (!fit || !terminal || sessionRef.current.status !== "running" || sessionRef.current.controlState !== "controller") return;
      fit.fit();
      const size = (terminal as unknown as { cols?: number; rows?: number });
      if (size.cols && size.rows) {
        void props.client.resize(sessionRef.current.sessionId, size.rows, size.cols).catch(() => undefined);
      }
    });
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [props.client]);

  async function run(action: () => Promise<CodexTuiSession>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setSession(next);
      props.onSessionChange?.(next);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "终端操作失败";
      setError(message);
      props.onError?.(message);
    } finally {
      setBusy(false);
    }
  }

  async function reattach() {
    setBusy(true);
    setError(null);
    try {
      const next = await props.client.reattach(session.sessionId);
      setSession(next);
      props.onSessionChange?.(next);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "终端重新附着失败";
      setError(message);
      props.onError?.(message);
    } finally {
      setBusy(false);
    }
  }

  const canControl = session.status === "running";
  const controlling = session.controlState === "controller";

  return <section className="local-terminal-view" aria-label="Loop 本机终端">
    <header className="local-terminal-toolbar">
      <div className="local-terminal-title">
        <Radio aria-hidden="true" size={14} />
        <strong>{session.nodeKey ?? session.runId}</strong>
        <small>{session.model ?? "默认模型"}</small>
      </div>
      <span className="local-terminal-control-state" data-tone={controlTone(session)}>
        {controlling ? <Play aria-hidden="true" size={12} /> : session.status === "detached" ? <Unplug aria-hidden="true" size={12} /> : <Ban aria-hidden="true" size={12} />}
        {controlLabel(session)}
      </span>
      <div className="local-terminal-actions">
        {session.status === "detached" ? <button disabled={busy} onClick={() => void reattach()} type="button"><RotateCcw aria-hidden="true" size={13} />重新附着</button> : null}
        {canControl && !controlling ? <button disabled={busy} onClick={() => void run(() => props.client.acquire(session.sessionId))} type="button"><Link2 aria-hidden="true" size={13} />接管终端</button> : null}
        {canControl && controlling ? <button disabled={busy} onClick={() => void run(() => props.client.release(session.sessionId))} type="button"><CirclePause aria-hidden="true" size={13} />释放控制</button> : null}
      </div>
    </header>
    {error ? <p className="local-terminal-error" role="alert">{error}</p> : null}
    <div className="local-terminal-host" ref={hostRef} />
    <footer>
      <span>thread {session.threadId.slice(0, 12)}</span>
      <span>{session.cwd}</span>
      <span>{session.bufferBytes} bytes</span>
    </footer>
  </section>;
}
