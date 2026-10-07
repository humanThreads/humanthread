import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import WebSocket, { WebSocketServer } from "ws";

import { LiveRelayRouter, relayError } from "./router";

const CONTROL_PATH = "/live-session/control";
const EXECUTION_PATH = "/live-session/execution";
const MAX_FRAME_BYTES = 256 * 1024;
const TICKET_PREFIX = "lst1";
const VIEWER_SCOPE = "viewer";

export interface LiveRelayServer {
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
  router: LiveRelayRouter;
}

function sessionIdFromRequest(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? "/", "http://relay.local");
  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  return /^[a-f0-9]{32}$/u.test(sessionId) ? sessionId : null;
}

function viewerScope(request: IncomingMessage): boolean {
  const url = new URL(request.url ?? "/", "http://relay.local");
  return url.searchParams.get("scope")?.trim() === VIEWER_SCOPE;
}

/**
 * A viewer may resume from an explicit cursor after a page reload or a network
 * blip. Without it the relay always replayed from zero, so a viewer that had
 * already seen part of the stream received duplicated or missing bytes.
 */
function viewerCursor(request: IncomingMessage): number {
  const raw = new URL(request.url ?? "/", "http://relay.local").searchParams.get("cursor")?.trim() ?? "";
  if (!/^\d{1,12}$/u.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function ticketSecret(value: string | undefined): string | null {
  const secret = value?.trim();
  return secret ? secret : null;
}

function safeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyTicket(input: {
  ticket: string;
  kind: "control" | "execution" | "viewer";
  sessionId: string;
  secret: string;
  now?: Date;
}): boolean {
  const [prefix, encodedPayload, signature] = input.ticket.trim().split(".");
  if (prefix !== TICKET_PREFIX || !encodedPayload || !signature) return false;
  const expected = createHmac("sha256", input.secret).update(encodedPayload).digest("base64url");
  if (!safeEquals(signature, expected)) return false;
  let payload: Record<string, unknown>;
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return false;
    payload = decoded as Record<string, unknown>;
  } catch {
    return false;
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return payload.version === 1
    && payload.sessionId === input.sessionId
    && payload.kind === input.kind
    && Number.isInteger(payload.exp)
    && Number(payload.exp) > nowSeconds;
}

export function createLiveRelayServer(input: {
  port: number;
  host?: string;
  router?: LiveRelayRouter;
  authorize?: (input: { kind: "control" | "execution" | "viewer"; sessionId: string; request: IncomingMessage }) => boolean;
  ticketSecret?: string;
}): LiveRelayServer {
  const router = input.router ?? new LiveRelayRouter();
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://relay.local").pathname;
    if (path === "/healthz") json(response, 200, { ok: true, service: "humanthread-live-relay" });
    else json(response, 404, { ok: false, error: "not_found" });
  });
  const control = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const execution = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://relay.local").pathname;
    const sessionId = sessionIdFromRequest(request);
    const kind = path === CONTROL_PATH
      ? viewerScope(request) ? "viewer" : "control"
      : path === EXECUTION_PATH ? "execution" : null;
    if (!sessionId || !kind || (input.authorize ? !input.authorize({ kind, sessionId, request }) : true)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const webSocketServer = path === CONTROL_PATH ? control : execution;
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request, sessionId, kind);
    });
  });

  control.on("connection", (socket: WebSocket, request: IncomingMessage, sessionId: string, kind: "control" | "viewer") => {
    const connectionId = randomConnectionId();
    const readOnly = kind === "viewer";
    try {
      // Reuse any route created by an earlier execution connection; replacing
      // it would discard the execution input sender and seqence cursors.
      const session = router.session(sessionId)
        ?? router.registerSession({ sessionId, firstSequence: 0, lastSequence: 0 });
      router.attachViewer({
        sessionId,
        connectionId,
        lastSequence: viewerCursor(request),
        readOnly,
        send: ({ bytes }) => socket.readyState === WebSocket.OPEN && socket.send(bytes, { binary: true }),
        sendText: (text) => socket.readyState === WebSocket.OPEN && socket.send(text),
        disconnect: () => socket.close(1013, "backpressure"),
      });
      socket.send(JSON.stringify({ type: "server.hello", protocol: 1, sessionId, connectionId, sequences: {
        first: session.firstSequence,
        last: session.lastSequence,
      }, targetOnline: session.executionConnectionId !== null }));
    } catch (error) {
      socket.close(1008, error instanceof Error ? error.message : "live_session_not_found");
    }
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      try {
        const message = JSON.parse(data.toString("utf8")) as { type?: string; bytesBase64?: string };
        if (message.type === "control.claim") {
          if (readOnly) throw relayError("live_session_control_conflict", "Viewer connections cannot claim control");
          router.claimControl(sessionId, connectionId);
          socket.send(JSON.stringify({ type: "control.claimed" }));
        }
        if (message.type === "control.release") {
          router.releaseControl(sessionId, connectionId);
          socket.send(JSON.stringify({ type: "control.released" }));
          return;
        }
        if (message.type === "control.input" && typeof message.bytesBase64 === "string") {
          if (readOnly) throw relayError("live_session_control_conflict", "Viewer connections cannot send input");
          const bytes = Buffer.from(message.bytesBase64, "base64");
          if (bytes.byteLength > 0) router.writeInput(sessionId, connectionId, bytes);
        }
        if (message.type === "control.resize") {
          if (readOnly) throw relayError("live_session_control_conflict", "Viewer connections cannot resize");
          const rows = (message as { rows?: unknown }).rows;
          const cols = (message as { cols?: unknown }).cols;
          if (typeof rows !== "number" || typeof cols !== "number") throw new Error("invalid terminal size");
          router.resizeTerminal(sessionId, connectionId, { rows, cols });
        }
        if (message.type === "control.replay" && typeof (message as { afterSequence?: unknown }).afterSequence === "number") {
          // The relay keeps only a bounded tail. History further back must be
          // served by the execution side's journal instead of being dropped.
          const afterSequence = (message as { afterSequence: number }).afterSequence;
          router.requestReplay({
            sessionId,
            connectionId,
            requestId: randomConnectionId(),
            afterSequence: Math.max(0, Math.floor(afterSequence)),
          });
        }
      } catch {
        // A viewer that sends a control frame is closed with the same stable
        // code path as any other invalid control frame: it never gains control.
        socket.close(1008, "invalid_control_frame");
      }
    });
    socket.on("close", () => router.detachViewer(sessionId, connectionId));
  });

  execution.on("connection", (socket: WebSocket, _request: IncomingMessage, sessionId: string) => {
    const executionConnectionId = randomConnectionId();
    // Either side may arrive first: a Worker/Agent can open its outbound
    // execution socket before the browser page finishes attaching. Registering
    // the in-memory route here keeps the handshake order-independent.
    const existing = router.session(sessionId)
      ?? router.registerSession({ sessionId, firstSequence: 0, lastSequence: 0 });
    existing.executionConnectionId = executionConnectionId;
    router.publishState(sessionId, { targetOnline: true });
    router.attachControlSender(sessionId, (state) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: `control.${state}` }));
    });
    router.attachReplaySender(sessionId, (request) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "control.replay", ...request }));
    });
    router.attachInputSender(sessionId, (bytes) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "control.input", bytesBase64: Buffer.from(bytes).toString("base64") }));
      }
    });
    // Terminal geometry belongs to the session: a TUI laid out for 120 columns
    // and painted into a phone-sized viewport renders as a clipped strip along
    // the top instead of a usable conversation.
    router.attachResizeSender(sessionId, (size) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "control.resize", rows: size.rows, cols: size.cols }));
      }
    });
    // A viewer can claim control (and report geometry) before the Worker opens
    // its execution socket. Replaying both here keeps the late execution side
    // from silently dropping viewer input.
    if (existing.controllerConnectionId !== null) {
      socket.send(JSON.stringify({ type: "control.claimed" }));
    }
    if (existing.lastSize) {
      socket.send(JSON.stringify({ type: "control.resize", rows: existing.lastSize.rows, cols: existing.lastSize.cols }));
    }
    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        // Coordination frames travel as JSON text on the same socket. They are
        // display-only and must never advance the terminal output sequence.
        try {
          const message = JSON.parse(data.toString("utf8")) as { type?: string; phase?: unknown };
          if (message.type === "server.phase") router.publishPhase(sessionId, message.phase);
          if (message.type === "execution.replayChunk") {
            const chunk = message as unknown as { requestId?: unknown; sequence?: unknown; bytesBase64?: unknown };
            if (typeof chunk.requestId === "string" && typeof chunk.sequence === "number" && typeof chunk.bytesBase64 === "string") {
              router.routeReplayChunk(sessionId, {
                requestId: chunk.requestId,
                sequence: chunk.sequence,
                bytes: Buffer.from(chunk.bytesBase64, "base64"),
              });
            }
          }
          if (message.type === "execution.replayState") {
            const state = message as unknown as {
              requestId?: unknown;
              status?: unknown;
              firstSequence?: unknown;
              lastSequence?: unknown;
            };
            if (typeof state.requestId === "string" && (state.status === "ready" || state.status === "unavailable")) {
              router.routeReplayState(sessionId, {
                requestId: state.requestId,
                status: state.status,
                ...(typeof state.firstSequence === "number" ? { firstSequence: state.firstSequence } : {}),
                ...(typeof state.lastSequence === "number" ? { lastSequence: state.lastSequence } : {}),
              });
            }
          }
        } catch {
          // An invalid phase frame is dropped; it must not disrupt the TUI byte
          // stream that shares this connection.
        }
        return;
      }
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      try {
        const sequence = nextSequence(router, sessionId);
        router.publishOutput(sessionId, { sequence, bytes });
      } catch (error) {
        if (error instanceof Error && Reflect.get(error, "code") === "replay_unavailable") socket.close(1002, "sequence_gap");
      }
    });
    socket.on("close", () => {
      router.attachInputSender(sessionId, null);
      router.attachResizeSender(sessionId, null);
      router.attachControlSender(sessionId, null);
      router.attachReplaySender(sessionId, null);
      router.detachExecution(sessionId, executionConnectionId);
    });
  });

  return {
    router,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ port: input.port, host: input.host ?? "0.0.0.0" }, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address !== "object") throw relayError("live_session_gateway_unavailable", "Relay did not bind");
      return { port: address.port };
    },
    async close() {
      for (const client of [...control.clients, ...execution.clients]) {
        client.terminate();
      }
      await Promise.all([
        new Promise<void>((resolve) => control.close(() => resolve())),
        new Promise<void>((resolve) => execution.close(() => resolve())),
        new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
      ]);
    },
  };
}

function nextSequence(router: LiveRelayRouter, sessionId: string): number {
  const session = router.session(sessionId);
  if (!session) throw relayError("live_session_not_found", "Live session was not found");
  return session.lastSequence + 1;
}

function randomConnectionId(): string {
  return Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
}

export async function main(): Promise<void> {
  const port = Number(process.env.HUMANTHREAD_LIVE_RELAY_PORT ?? "3101");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("HUMANTHREAD_LIVE_RELAY_PORT is invalid");
  const secret = ticketSecret(process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET);
  if (!secret) throw new Error("HUMANTHREAD_DESKTOP_SESSION_SECRET is required for live relay tickets");
  const relay = createLiveRelayServer({
    port,
    authorize: ({ kind, sessionId, request }) => {
      const url = new URL(request.url ?? "/", "http://relay.local");
      const ticket = url.searchParams.get("ticket")?.trim() ?? "";
      return verifyTicket({ ticket, kind, sessionId, secret });
    },
  });
  const address = await relay.listen();
  process.stdout.write(`humanthread-live-relay listening on ${address.port}\n`);
  const shutdown = () => {
    void relay.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Live relay failed");
    process.exitCode = 1;
  });
}
