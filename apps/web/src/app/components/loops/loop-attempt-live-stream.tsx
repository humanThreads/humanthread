"use client";

import { CircleDashed, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { LoopRunProjection } from "@/lib/orchestration/loop-read-model";

type Attempt = LoopRunProjection["nodes"][number]["attempts"][number];

type LiveStreamResult = {
  mode: "phase" | "tui" | "phase_and_tui";
  session: { id: string; streamMode?: string };
  phase: {
    name: string;
    status: "pending" | "running" | "succeeded" | "failed" | "skipped";
    startedAt: string;
    finishedAt: string | null;
    code: string | null;
    summary: string | null;
  } | null;
};

type TerminalInstance = {
  loadAddon(addon: unknown): void;
  open(element: HTMLElement): void;
  write(data: Uint8Array | string): void;
  dispose(): void;
};

type FitAddonInstance = { fit(): void };

const PHASE_LABELS: Record<string, string> = {
  "assignment.claimed": "已领取任务",
  "repository.configuration_check": "仓库配置检查",
  "git.fetch": "Git Check",
  "worktree.prepare": "准备工作树",
  "checkout.verify": "校验检出",
  "app_server.start": "启动 Codex",
  "tui.attach": "接入 TUI",
  "codex.turn": "Codex 执行",
  cleanup: "清理",
};

const STATUS_LABELS: Record<LiveStreamResult["phase"] extends null ? never : string, string> = {
  pending: "等待中",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

/**
 * Read-only observation surface for one Loop attempt. It intentionally has no
 * claim, input or resize controls: the browser can watch and nothing more.
 */
export function LoopAttemptLiveStream({
  loopRunId,
  attempt,
}: {
  loopRunId: string;
  attempt: Attempt;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Highest output sequence the relay has confirmed for this viewer. It is the
  // only correct resume cursor: the platform-side session row never learns the
  // relay's in-memory sequence, and replaying from zero after a reload would
  // duplicate or drop terminal bytes.
  const cursorRef = useRef(0);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; result: LiveStreamResult }
    | { kind: "unavailable"; code: string }
  >({ kind: "loading" });

  useEffect(() => {
    let disposed = false;
    let terminal: TerminalInstance | null = null;
    let socket: WebSocket | null = null;
    void (async () => {
      try {
        const response = await fetch(
          `/api/loop-runs/${encodeURIComponent(loopRunId)}/attempts/${encodeURIComponent(attempt.attemptId)}/live-stream`,
          { method: "GET" },
        );
        const body = await response.json() as {
          ok?: boolean;
          result?: LiveStreamResult;
          errorCode?: string;
        };
        if (disposed) return;
        if (!response.ok || !body.ok || !body.result) {
          setState({ kind: "unavailable", code: body.errorCode ?? "live_stream_not_available" });
          return;
        }
        setState({ kind: "ready", result: body.result });
        if (body.result.mode === "phase") return;
        const ticketResponse = await fetch(
          `/api/live-sessions/${encodeURIComponent(body.result.session.id)}/ticket`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "viewer" }),
          },
        );
        const ticketBody = await ticketResponse.json() as { result?: { ticket?: { token?: string } } };
        const token = ticketBody.result?.ticket?.token;
        if (!ticketResponse.ok || !token || disposed) return;
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        // The terminal host only exists once the ready state has rendered, so
        // wait for the next frame instead of racing the first paint.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (disposed || !hostRef.current) return;
        terminal = new Terminal({
          convertEol: true,
          cursorBlink: false,
          disableStdin: true,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          scrollback: 5_000,
          theme: { background: "#0d1117", foreground: "#c9d1d9", cursor: "#0d1117" },
        }) as unknown as TerminalInstance;
        const fitAddon = new FitAddon() as unknown as FitAddonInstance;
        terminal.loadAddon(fitAddon);
        terminal.open(hostRef.current);
        fitAddon.fit();
        const base = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
        const url = new URL("/live-session/control", base);
        url.searchParams.set("sessionId", body.result.session.id);
        url.searchParams.set("ticket", token);
        url.searchParams.set("scope", "viewer");
        if (cursorRef.current > 0) url.searchParams.set("cursor", String(cursorRef.current));
        socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        socket.onmessage = (event) => {
          if (typeof event.data !== "string") {
            terminal?.write(new Uint8Array(event.data as ArrayBuffer));
            return;
          }
          try {
            const message = JSON.parse(event.data) as {
              type?: string;
              targetOnline?: unknown;
              sequences?: { first?: unknown; last?: unknown };
              status?: unknown;
            };
            const first = message.sequences?.first;
            const last = message.sequences?.last;
            if (message.type === "server.hello") {
              if (typeof last === "number" && Number.isSafeInteger(last)) {
                cursorRef.current = Math.max(cursorRef.current, last);
              }
              // When the relay has already dropped the bytes this viewer still
              // needs, ask the execution side to serve them from its journal.
              // This is the only path that can show a viewer the beginning of a
              // turn the bounded in-memory replay window has moved past.
              if (
                cursorRef.current > 0
                && typeof first === "number"
                && Number.isSafeInteger(first)
                && first > 1
              ) {
                socket?.send(JSON.stringify({ type: "control.replay", afterSequence: cursorRef.current }));
              }
              return;
            }
            if (message.type === "server.replay" && message.status === "unavailable") {
              setState({ kind: "unavailable", code: "live_stream_replay_unavailable" });
              return;
            }
          } catch {
            // Phase and control frames are best effort; malformed frames must
            // never break the terminal byte stream.
          }
        };
        socket.onclose = () => {
          if (disposed) return;
          // A dropped viewer socket used to leave the panel permanently blank.
          // Reconnect from the last confirmed sequence so the bounded replay
          // window is applied relative to this viewer's real position.
          setRetryKey((value) => value + 1);
        };
      } catch {
        if (!disposed) setState({ kind: "unavailable", code: "live_stream_not_available" });
      }
    })();
    return () => {
      disposed = true;
      socket?.close(1000, "viewer left");
      terminal?.dispose();
      terminal = null;
    };
  }, [attempt.attemptId, loopRunId, retryKey]);

  return <section className="min-w-0 px-4 py-4" aria-label="实时执行">
    <PhaseSummary attempt={attempt} />
    {state.kind === "loading" ? <p className="mt-3 text-sm text-[#57606a]">正在连接实时执行…</p> : null}
    {state.kind === "unavailable" ? (
      <p className="mt-3 text-sm text-[#57606a]">{unavailableCopy(state.code)}</p>
    ) : null}
    {state.kind === "ready" && state.result.mode !== "phase" ? (
      <div className="mt-3 min-h-48 overflow-hidden rounded-md border border-[#0d1117] bg-[#0d1117]" aria-label="只读 Codex TUI">
        <div ref={hostRef} className="min-h-48 w-full overflow-x-auto" />
      </div>
    ) : null}
  </section>;
}

function PhaseSummary({ attempt }: { attempt: Attempt }) {
  const phase = attempt.executionPhase;
  if (!phase) {
    return (
      <p className="text-sm text-[#57606a]" role="status">
        无阶段记录。该尝试创建于实时执行能力上线前，或尚未上报首个阶段。
      </p>
    );
  }
  return (
    <div className="min-w-0 border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Radio aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#0969da]" />
        <span className="min-w-0 break-all text-sm font-semibold text-[#24292f]">{phase.phase}</span>
        <span className="shrink-0 rounded-full border border-[#d0d7de] bg-white px-2 py-0.5 text-[11px] font-medium text-[#57606a]">
          {PHASE_LABELS[phase.phase] ?? phase.status}
        </span>
        <span className="shrink-0 text-xs font-medium text-[#57606a]">{STATUS_LABELS[phase.status]}</span>
        {phase.code ? <span className="min-w-0 break-all text-xs text-[#cf222e]">{phase.code}</span> : null}
      </div>
      {phase.summary ? <p className="mt-1.5 break-words text-xs leading-5 text-[#57606a]">{phase.summary}</p> : null}
    </div>
  );
}

function unavailableCopy(code: string): string {
  if (code === "live_stream_owner_unavailable") return "暂无可用观察者，无法建立实时执行流。";
  if (code === "live_stream_attempt_finished") return "该节点尝试已经结束，实时流已关闭。";
  return "没有活动实时会话。历史尝试不提供终端回放。";
}

export const __testing = { CircleDashed };
