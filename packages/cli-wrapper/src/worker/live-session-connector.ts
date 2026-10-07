import WebSocket from "ws";

const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;
const DEFAULT_INITIAL_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

interface WorkerConnectorSocket {
  readyState: number;
  send(value: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface WorkerLiveSessionConnector {
  start(): Promise<void>;
  heartbeat(): Promise<void>;
  publish(bytes: Uint8Array): Promise<void>;
  publishPhase(phase: WorkerLiveSessionPhase): Promise<void>;
  /**
   * Rebinds terminal input/resize once the PTY exists. The connector opens
   * before worktree preparation, so the first handlers have no TUI to target.
   */
  attachInputHandlers(handlers: {
    onInput(bytes: Uint8Array): void | Promise<void>;
    onResize?(size: { rows: number; cols: number }): void | Promise<void>;
  }): void;
  /**
   * Supplies historical chunks for a viewer that asked to replay from a cursor.
   * The Worker owns the only durable copy of the terminal stream, so the relay
   * can only answer a replay request by asking the execution side for it.
   */
  attachReplayHandler(handler: (request: { requestId: string; afterSequence: number }) => void | Promise<void>): void;
  /** Re-emits a historical chunk as part of the single monotonic output stream. */
  publishReplayChunk(chunk: { sequence: number; bytes: Uint8Array }): void;
  /** Reports whether the requested replay range can be served. */
  publishReplayState(state: {
    requestId: string;
    status: "ready" | "unavailable";
    firstSequence?: number;
    lastSequence?: number;
  }): void;
  close(): Promise<void>;
  state(): "connecting" | "online" | "reconnecting" | "closed";
  /** Bytes held for replay while the relay is offline. Diagnostic surface only. */
  bufferedBytes?(): number;
}

/**
 * Display-only snapshot of the Worker's current execution boundary. It never
 * carries terminal bytes, so it must not enter the journal or output sequence.
 */
export interface WorkerLiveSessionPhase {
  phase: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string | null;
  code: string | null;
  summary: string | null;
}

export function createWorkerLiveSessionConnector(input: {
  relayUrl: string;
  sessionId: string;
  workerPoolSessionToken: string;
  attemptNo?: number;
  leaseGeneration?: number;
  connect?: (input: { url: string; headers: Record<string, string> }) => WorkerConnectorSocket;
  heartbeatMs: number;
  now(): Date;
  onInput(bytes: Uint8Array): void | Promise<void>;
  /** Terminal geometry reported by the controlling viewer. */
  onResize?(size: { rows: number; cols: number }): void | Promise<void>;
  onInputError?(error: unknown): void;
  initialConnectTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxBufferedBytes?: number;
}): WorkerLiveSessionConnector {
  if (!SESSION_ID_PATTERN.test(input.sessionId)) throw connectorError("live_session_invalid", "Live session id is invalid");
  if (!input.workerPoolSessionToken.trim()) {
    throw connectorError("internal_connector_offline", "Worker pool session is required");
  }
  if (!Number.isSafeInteger(input.heartbeatMs) || input.heartbeatMs < 250) {
    throw connectorError("live_session_invalid", "Connector heartbeat interval is invalid");
  }
  const initialConnectTimeoutMs = input.initialConnectTimeoutMs ?? DEFAULT_INITIAL_CONNECT_TIMEOUT_MS;
  if (!Number.isSafeInteger(initialConnectTimeoutMs) || initialConnectTimeoutMs < 1) {
    throw connectorError("live_session_invalid", "Connector connect timeout is invalid");
  }
  const reconnectDelayMs = input.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  if (!Number.isSafeInteger(reconnectDelayMs) || reconnectDelayMs < 0) {
    throw connectorError("live_session_invalid", "Connector reconnect delay is invalid");
  }
  const maxBufferedBytes = input.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 1) {
    throw connectorError("live_session_invalid", "Connector buffer limit is invalid");
  }
  let url: URL;
  try {
    url = new URL(input.relayUrl);
  } catch {
    throw connectorError("internal_connector_offline", "Relay URL is invalid");
  }
  if (url.protocol !== "wss:") throw connectorError("internal_connector_offline", "Relay must use WSS");
  url.searchParams.set("sessionId", input.sessionId);
  const connect = input.connect ?? ((connection) => new WebSocket(connection.url, { headers: connection.headers }));
  let socket: WorkerConnectorSocket | null = null;
  let status: ReturnType<WorkerLiveSessionConnector["state"]> = "closed";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let controller = false;
  let inputHandlers: {
    onInput(bytes: Uint8Array): void | Promise<void>;
    onResize?(size: { rows: number; cols: number }): void | Promise<void>;
  } = {
    onInput: input.onInput,
    ...(input.onResize ? { onResize: input.onResize } : {}),
  };
  let replayHandler: ((request: { requestId: string; afterSequence: number }) => void | Promise<void>) | null = null;
  // Terminal bytes produced while the relay handshake or a reconnect is in
  // flight are buffered instead of rejected. A rejected publish surfaces on the
  // app-server notification path where nothing can catch it, which used to take
  // down the whole worker process and leave the browser on a black terminal.
  let buffered: Uint8Array[] = [];
  let bufferedBytes = 0;

  // Read through a helper so TypeScript does not narrow the mutable status
  // across the async handshake path.
  const isClosed = () => status === "closed";
  const canSend = () => Boolean(socket) && socket?.readyState === WebSocket.OPEN && status === "online";

  const send = (payload: Record<string, unknown>) => {
    if (!canSend()) return;
    socket?.send(JSON.stringify(payload));
  };

  const trimBuffer = () => {
    while (bufferedBytes > maxBufferedBytes && buffered.length > 0) bufferedBytes -= buffered.shift()!.byteLength;
  };

  const flushBuffer = () => {
    if (!canSend() || buffered.length === 0) return;
    const pending = buffered;
    buffered = [];
    bufferedBytes = 0;
    for (const [index, chunk] of pending.entries()) {
      try {
        socket?.send(chunk);
      } catch {
        // A socket that fails mid-flush keeps the unsent tail so a reconnect
        // can replay it instead of silently dropping terminal history.
        buffered = pending.slice(index);
        bufferedBytes = buffered.reduce((sum, value) => sum + value.byteLength, 0);
        trimBuffer();
        controller = false;
        socket = null;
        status = "reconnecting";
        scheduleReconnect();
        return;
      }
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimer || isClosed()) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (isClosed()) return;
      void open().catch(() => scheduleReconnect());
    }, reconnectDelayMs);
    reconnectTimer.unref?.();
  };

  const attach = (created: WorkerConnectorSocket) => {
    created.on("open", () => {
      status = "online";
      socket = created;
      send({
        type: "execution.hello",
        protocol: 1,
        sessionId: input.sessionId,
        at: input.now().toISOString(),
      });
      flushBuffer();
    });
    created.on("message", (data, isBinary) => {
      if (isBinary) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.type === "control.claimed") {
        controller = true;
        return;
      }
      if (message.type === "control.released") {
        controller = false;
        return;
      }
      if (message.type === "control.input" && controller && typeof message.bytesBase64 === "string") {
        const bytes = Buffer.from(message.bytesBase64, "base64");
        if (bytes.byteLength > 0 && bytes.byteLength <= 256 * 1024) {
          // Viewer input is best effort: a detached or restarting PTY must not
          // break the execution socket that also carries terminal output. An
          // uncaught rejection here would kill the whole worker process.
          Promise.resolve(inputHandlers.onInput(bytes)).catch((error) => input.onInputError?.(error));
        }
      }
      if (message.type === "control.resize" && controller) {
        const rows = message.rows;
        const cols = message.cols;
        if (typeof rows === "number" && typeof cols === "number") {
          // Resize is best effort for the same reason input is: a detached PTY
          // must not take down the execution socket carrying terminal output.
          Promise.resolve(inputHandlers.onResize?.({ rows, cols })).catch((error) => input.onInputError?.(error));
        }
      }
      if (message.type === "control.replay" && typeof message.requestId === "string") {
        const afterSequence = typeof message.afterSequence === "number" ? message.afterSequence : 0;
        // Replay is best effort: a journal read failure must not break the live
        // terminal stream that shares this socket.
        Promise.resolve(replayHandler?.({ requestId: message.requestId, afterSequence }))
          .catch((error) => input.onInputError?.(error));
      }
    });
    created.on("close", () => {
      controller = false;
      if (socket === created) socket = null;
      if (isClosed()) return;
      status = "reconnecting";
      scheduleReconnect();
    });
    created.on("error", () => {
      controller = false;
      if (isClosed()) return;
      status = "reconnecting";
      scheduleReconnect();
    });
  };

  const open = async (): Promise<WorkerConnectorSocket> => {
    const created = connect({
      url: url.toString(),
      headers: { "x-worker-pool-session": input.workerPoolSessionToken },
    });
    attach(created);
    if (created.readyState === WebSocket.OPEN) {
      status = "online";
      socket = created;
      send({ type: "execution.hello", protocol: 1, sessionId: input.sessionId, at: input.now().toISOString() });
      flushBuffer();
      return created;
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(connectorError("internal_connector_offline", "Relay handshake timed out"));
      }, initialConnectTimeoutMs);
      timer.unref?.();
      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const onFailure = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(connectorError("internal_connector_offline", "Relay connection is offline"));
      };
      created.on("open", onOpen);
      created.on("error", onFailure);
      created.on("close", onFailure);
    });
    return created;
  };

  return {
    async start() {
      if (status === "online" || status === "connecting") return;
      status = "connecting";
      try {
        await open();
      } catch (error) {
        if (!isClosed()) scheduleReconnect();
        throw error;
      }
      if (!heartbeatTimer) {
        heartbeatTimer = setInterval(() => { void this.heartbeat(); }, input.heartbeatMs);
        heartbeatTimer.unref?.();
      }
    },
    async heartbeat() {
      send({
        type: "execution.heartbeat",
        sessionId: input.sessionId,
        at: input.now().toISOString(),
      });
    },
    async publish(bytes) {
      if (bytes.byteLength === 0) return;
      if (canSend()) {
        socket?.send(bytes);
        return;
      }
      if (isClosed()) return;
      buffered.push(bytes);
      bufferedBytes += bytes.byteLength;
      trimBuffer();
    },
    async publishPhase(phase) {
      if (!canSend()) return;
      send({
        type: "server.phase",
        phase: {
          phase: phase.phase,
          status: phase.status,
          startedAt: phase.startedAt,
          finishedAt: phase.finishedAt,
          code: phase.code,
          summary: phase.summary,
          attemptNo: input.attemptNo ?? 1,
          leaseGeneration: input.leaseGeneration ?? 1,
        },
      });
    },
    attachInputHandlers(handlers) {
      inputHandlers = handlers;
    },
    attachReplayHandler(handler) {
      replayHandler = handler;
    },
    /**
     * Publishes a replayed chunk while preserving the live output sequence.
     * Replayed bytes are re-emitted as ordinary output frames so the relay and
     * every other viewer observe one monotonic stream.
     */
    publishReplayChunk(chunk: { sequence: number; bytes: Uint8Array }) {
      if (!canSend() || chunk.bytes.byteLength === 0) return;
      send({
        type: "execution.replayChunk",
        sequence: chunk.sequence,
        bytesBase64: Buffer.from(chunk.bytes).toString("base64"),
      });
    },
    publishReplayState(state: { requestId: string; status: "ready" | "unavailable"; firstSequence?: number; lastSequence?: number }) {
      if (!canSend()) return;
      send({ type: "execution.replayState", ...state });
    },
    async close() {
      status = "closed";
      controller = false;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      heartbeatTimer = null;
      reconnectTimer = null;
      buffered = [];
      bufferedBytes = 0;
      socket?.close(1000, "worker closed");
      socket = null;
    },
    state() {
      return status;
    },
    bufferedBytes() {
      return bufferedBytes;
    },
  };
}

function connectorError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
