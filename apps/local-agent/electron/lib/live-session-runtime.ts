import type { LiveSessionJournal } from "@humanthread/live-session-journal";

import type { CodexTuiBroker } from "./codex-tui-broker";
import { createLiveSessionConnector, type LiveSessionConnector } from "./live-session-connector";

export interface LiveSessionRuntime {
  publish(input: { sessionId: string; bytes: Uint8Array }): Promise<void>;
  open(input: {
    sessionId: string;
    relayUrl: string;
    authorization: string;
  }): Promise<void>;
  close(sessionId: string): Promise<void>;
  closeAll(): Promise<void>;
  state(sessionId: string): "connecting" | "online" | "reconnecting" | "closed" | null;
}

export function createLiveSessionRuntime(input: {
  broker: CodexTuiBroker;
  journal: LiveSessionJournal;
  heartbeatMs?: number;
}): LiveSessionRuntime {
  const connectors = new Map<string, LiveSessionConnector>();

  return {
    async publish(output) {
      const connector = connectors.get(output.sessionId);
      if (!connector) return;
      await connector.publish(output.bytes);
    },
    async open(binding) {
      if (connectors.has(binding.sessionId)) return;
      const connector = createLiveSessionConnector({
        relayUrl: binding.relayUrl,
        sessionId: binding.sessionId,
        authorization: binding.authorization,
        heartbeatMs: input.heartbeatMs ?? 15_000,
        now: () => new Date(),
        onControl: () => undefined,
          onInput: async (bytes) => {
          const session = input.broker.session(binding.sessionId);
          if (!session || session.status !== "running") {
            throw Object.assign(new Error("Live session target is not running"), { code: "provider_tui_detached" });
          }
          await input.broker.write(binding.sessionId, 1, Buffer.from(bytes).toString("base64"));
          },
        onResize: async (size) => {
          const session = input.broker.session(binding.sessionId);
          if (!session || session.status !== "running") {
            throw Object.assign(new Error("Live session target is not running"), { code: "provider_tui_detached" });
          }
          await input.broker.resize(binding.sessionId, 1, size.rows, size.cols);
        },
      });
      connectors.set(binding.sessionId, connector);
      await connector.start();
    },
    async close(sessionId) {
      const connector = connectors.get(sessionId);
      connectors.delete(sessionId);
      await connector?.close().catch(() => undefined);
      await input.journal.remove(sessionId).catch(() => undefined);
    },
    async closeAll() {
      await Promise.all([...connectors.keys()].map((sessionId) => this.close(sessionId)));
    },
    state(sessionId) {
      return connectors.get(sessionId)?.state() ?? null;
    },
  };
}
