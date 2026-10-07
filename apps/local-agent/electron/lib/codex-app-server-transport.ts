import { isAbsolute } from "node:path";
import { URL } from "node:url";

import WebSocket from "ws";

export const DEFAULT_TRANSPORT_TIMEOUT_MS = 15_000;

export type CodexAppServerTransportKind = "websocket" | "unix" | "stdio";

export interface CodexAppServerTransport {
  kind: Exclude<CodexAppServerTransportKind, "stdio">;
  endpoint: string;
  ready(): Promise<void>;
  write(line: string): Promise<void>;
  close(): Promise<void>;
  onMessage(handler: (line: string) => void): () => void;
  onClose(handler: (error: Error | null) => void): () => void;
}

function transportError(message: string, code = "provider_transport_error"): Error {
  return Object.assign(new Error(message), { code });
}

function parseLoopbackWebSocket(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw transportError("Codex app-server endpoint is invalid");
  }
  if (endpoint.protocol !== "ws:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw transportError("Codex app-server endpoint is invalid");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw transportError("Codex app-server endpoint must be loopback");
  }
  if (!endpoint.port) {
    throw transportError("Codex app-server endpoint is invalid");
  }
  return endpoint;
}

function parseUnixEndpoint(value: string): string {
  const prefix = "unix://";
  if (!value.startsWith(prefix)) {
    throw transportError("Codex app-server Unix endpoint is invalid");
  }
  const path = value.slice(prefix.length);
  if (!path || !isAbsolute(path) || /[\u0000-\u001F\u007F]/u.test(path)) {
    throw transportError("Codex app-server Unix endpoint is invalid");
  }
  return path;
}

export function parseAppServerListeningEndpoint(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /listening on:\s+(ws:\/\/[^\s]+|unix:\/\/[^\s]+)/u.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function codexWebSocketUrl(endpoint: string): string {
  if (endpoint.startsWith("unix://")) {
    return `ws+unix://${parseUnixEndpoint(endpoint)}`;
  }
  return parseLoopbackWebSocket(endpoint).toString().replace(/\/$/u, "");
}

export function createCodexAppServerTransport(input: {
  kind: Exclude<CodexAppServerTransportKind, "stdio">;
  endpoint: string;
  timeoutMs?: number;
}): CodexAppServerTransport {
  const endpoint = input.kind === "unix"
    ? `unix://${parseUnixEndpoint(input.endpoint)}`
    : parseLoopbackWebSocket(input.endpoint).toString().replace(/\/$/u, "");
  const socket = new WebSocket(codexWebSocketUrl(endpoint));
  const messageHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<(error: Error | null) => void>();
  let readyPromise: Promise<void> | null = null;
  let closed = false;
  let closeError: Error | null = null;

  const notifyClose = (error: Error | null) => {
    if (closeError === null && error) closeError = error;
    for (const handler of closeHandlers) handler(error);
  };

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      const error = transportError("Codex app-server transport received binary data");
      closeError = error;
      socket.close(1003, "binary data is not supported");
      notifyClose(error);
      return;
    }
    const line = typeof data === "string" ? data : data.toString("utf8");
    for (const handler of messageHandlers) handler(line);
  });
  socket.on("close", () => {
    closed = true;
    notifyClose(closeError);
  });
  socket.on("error", (error) => {
    const normalized = transportError(error.message || "Codex app-server socket failed");
    closeError = normalized;
    notifyClose(normalized);
  });

  return {
    kind: input.kind,
    endpoint,
    ready() {
      if (readyPromise) return readyPromise;
      readyPromise = new Promise<void>((resolve, reject) => {
        const timeoutMs = input.timeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
        const timer = setTimeout(() => {
          reject(transportError("Codex app-server transport did not become ready", "provider_start_timeout"));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          socket.off("open", onOpen);
          socket.off("error", onError);
        };
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = (error: Error) => {
          cleanup();
          reject(transportError(error.message || "Codex app-server socket failed"));
        };
        socket.once("open", onOpen);
        socket.once("error", onError);
      });
      return readyPromise;
    },
    write(line: string) {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(transportError("Codex app-server transport is closed"));
      }
      return new Promise<void>((resolve, reject) => {
        socket.send(line, (error) => {
          if (error) reject(transportError(error.message || "Codex app-server write failed"));
          else resolve();
        });
      });
    },
    close() {
      if (closed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.close();
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.terminate();
          resolve();
        }
      });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
  };
}
