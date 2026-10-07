import { Activity, CircleAlert, Cpu, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getNativeBridge } from "../../lib/native-bridge";
import type { CodexAppServerState } from "../../lib/providers/codex-app-server-client";

function parseStates(value: unknown): CodexAppServerState[] {
  if (!Array.isArray(value)) throw new Error("Codex 本地服务状态无效");
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const state = entry as Partial<CodexAppServerState>;
    if (
      typeof state.processKey !== "string"
      || typeof state.generation !== "number"
      || typeof state.pid !== "number"
      || typeof state.bindingFingerprint !== "string"
      || (typeof state.model !== "string" && state.model !== null)
      || (typeof state.reasoningEffort !== "string" && state.reasoningEffort !== null)
      || state.transport !== "stdio"
      || typeof state.status !== "string"
      || typeof state.pendingRequestCount !== "number"
    ) return [];
    return [state as CodexAppServerState];
  });
}

function statusLabel(status: string): string {
  if (status === "ready") return "就绪";
  if (status === "starting") return "启动中";
  if (status === "failed") return "失败";
  if (status === "stopped") return "已停止";
  return status;
}

export function CodexAppServerDiagnostics(props: { enabled: boolean }) {
  const [states, setStates] = useState<CodexAppServerState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!props.enabled) return;
    try {
      const bridge = getNativeBridge();
      if (!bridge) throw new Error("本地 Codex 服务状态仅在桌面客户端中可用");
      setStates(parseStates(await bridge.invoke("list_codex_app_servers")));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取 Codex 本地服务状态");
    }
  }, [props.enabled]);

  useEffect(() => {
    void refresh();
    if (!props.enabled) return undefined;
    const timer = globalThis.setInterval(() => { void refresh(); }, 2_000);
    return () => globalThis.clearInterval(timer);
  }, [props.enabled, refresh]);

  if (!props.enabled) return null;
  return (
    <section aria-labelledby="codex-app-server-diagnostics-title" className="settings-domain-section settings-runtime-section">
      <header>
        <span className="settings-section-icon"><Server aria-hidden="true" size={18} /></span>
        <div><h2 id="codex-app-server-diagnostics-title">本地 Codex 服务</h2><p>显示当前设备的 app-server 连接状态，不包含凭据和提示词。</p></div>
        <button aria-label="刷新 Codex 服务状态" className="icon-button" onClick={() => void refresh()} title="刷新" type="button"><RefreshCw aria-hidden="true" size={15} /></button>
      </header>
      {error ? <p className="runtime-settings-notice" data-tone="error" role="alert">{error}</p> : null}
      {states.length === 0 && !error ? <p className="settings-empty-state">当前没有运行中的 Codex 服务。</p> : null}
      <div className="settings-member-list">
        {states.map((state) => (
          <div key={`${state.processKey}:${state.generation}`}>
            <span className="read-domain-avatar" aria-hidden="true">{state.status === "ready" ? <Activity size={15} /> : <CircleAlert size={15} />}</span>
            <span>
              <strong>{state.model ?? "环境模型"} · {state.reasoningEffort ?? "默认强度"}</strong>
              <small>{statusLabel(state.status)} · PID {state.pid} · generation {state.generation} · pending {state.pendingRequestCount}</small>
            </span>
            <em><Cpu size={13} />{state.transport}</em>
          </div>
        ))}
      </div>
    </section>
  );
}
