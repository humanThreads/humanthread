import WebSocket from "ws";

const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;

export interface LiveSessionConnectorSocket {
  readyState: number;
  send(value: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface LiveSessionConnector {
  start(): Promise<void>;
  heartbeat(): Promise<void>;
  publish(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  state(): "connecting" | "online" | "reconnecting" | "closed";
}

function connectorError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function validateRelayUrl(value: string, sessionId: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw connectorError("internal_connector_offline", "Relay URL is invalid");
  }
  if (url.protocol !== "wss:") throw connectorError("internal_connector_offline", "Relay must use WSS");
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

export function createLiveSessionConnector(input: {
  relayUrl: string;
  sessionId: string;
  authorization: string;
  connect?: (input: { url: string; headers: Record<string, string> }) => LiveSessionConnectorSocket;
  heartbeatMs: number;
  now(): Date;
  onControl(state: "controller" | "viewer"): void;
  onInput(bytes: Uint8Array): void | Promise<void>;
  /** Terminal geometry reported by the controlling viewer. */
  onResize?(size: { rows: number; cols: number }): void | Promise<void>;
}): LiveSessionConnector {
  if (!SESSION_ID_PATTERN.test(input.sessionId)) throw connectorError("live_session_invalid", "Live session id is invalid");
  if (!input.authorization.trim()) throw connectorError("internal_connector_offline", "Relay authorization is required");
  if (!Number.isSafeInteger(input.heartbeatMs) || input.heartbeatMs < 250) {
    throw connectorError("live_session_invalid", "Connector heartbeat interval is invalid");
  }
  const url = validateRelayUrl(input.relayUrl, input.sessionId);
  const connect = input.connect ?? ((connection) => new WebSocket(connection.url, { headers: connection.headers }));
  let socket: LiveSessionConnectorSocket | null = null;
  let status: ReturnType<LiveSessionConnector["state"]> = "closed";
  let control: "controller" | "viewer" = "viewer";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const sendControl = (payload: Record<string, unknown>) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

  return {
    async start() {
      if (status !== "closed" && status !== "reconnecting") return;
      status = "connecting";
      socket = connect({
        url,
        headers: { authorization: input.authorization },
      });
      socket.on("open", () => {
        status = "online";
        control = "viewer";
        sendControl({
          type: "execution.hello",
          protocol: 1,
          sessionId: input.sessionId,
          lastSequence: 0,
          at: input.now().toISOString(),
        });
      });
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === "control.claimed") {
          control = "controller";
          input.onControl("controller");
          return;
        }
        if (message.type === "control.released") {
          control = "viewer";
          input.onControl("viewer");
          return;
        }
        if (message.type === "control.input" && control === "controller" && typeof message.bytesBase64 === "string") {
          const bytes = Buffer.from(message.bytesBase64, "base64");
          if (bytes.byteLength > 0 && bytes.byteLength <= 256 * 1024) void input.onInput(bytes);
        }
        if (message.type === "control.resize" && control === "controller") {
          const rows = message.rows;
          const cols = message.cols;
          if (typeof rows === "number" && typeof cols === "number") void input.onResize?.({ rows, cols });
        }
      });
      socket.on("close", () => {
        status = "reconnecting";
        control = "viewer";
        input.onControl("viewer");
      });
      socket.on("error", () => {
        status = "reconnecting";
      });
      heartbeatTimer = setInterval(() => { void this.heartbeat(); }, input.heartbeatMs);
      heartbeatTimer.unref?.();
    },
    async heartbeat() {
      sendControl({
        type: "execution.heartbeat",
        sessionId: input.sessionId,
        at: input.now().toISOString(),
      });
    },
    async publish(bytes) {
      if (bytes.byteLength === 0) return;
      if (!socket || socket.readyState !== WebSocket.OPEN || status !== "online") {
        throw connectorError("internal_connector_offline", "Relay connection is offline");
      }
      socket.send(bytes);
    },
    async close() {
      status = "closed";
      control = "viewer";
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      socket?.close(1000, "desktop closed");
      socket = null;
    },
    state() {
      return status;
    },
  };
}
