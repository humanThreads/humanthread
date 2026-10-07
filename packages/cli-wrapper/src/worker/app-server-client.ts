import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import WebSocket from "ws";

import {
  createRelayModelCatalog,
  patchModelCatalogForDirectTools,
  type BundledModelCatalogReader,
} from "./model-catalog";

const MAX_JSON_RPC_LINE_BYTES = 4 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const OPENCODE_SESSION_ENVIRONMENT_KEY = "HT_OPENCODE_SESSION";
const MODEL_CATALOG_FILE = "codex-models.json";

type JsonRpcResponse = {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string; type?: string; requestId?: string; httpStatus?: number };
};

export type CodexAppServerStartInput = {
  cwd: string;
  codexHome: string;
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
  sessionId?: string;
  gitEnvironment?: Record<string, string>;
  runtimeEnvironment?: Record<string, string>;
  checklistMcp?: {
    url: string;
    headers: Record<string, string>;
  };
  executable?: string;
};

type ChildProcessLike = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr" | "pid" | "kill" | "on" | "once">;

type SpawnLike = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; stdio: "pipe" },
) => ChildProcessLike;

type CreateDirectoryLike = (
  path: string,
  options: { recursive: true; mode: number },
) => Promise<string | undefined>;

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

interface CodexAppServerSocket {
  readyState: number;
  send(value: string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

type ConnectLike = (url: string) => CodexAppServerSocket;

function workerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function providerDiagnostic(error: JsonRpcResponse["error"]): Record<string, unknown> | undefined {
  if (!error) return undefined;
  const diagnostic: Record<string, unknown> = {};
  if (typeof error.code === "number" && Number.isFinite(error.code)) diagnostic.code = error.code;
  if (typeof error.type === "string" && error.type.trim()) diagnostic.type = error.type.slice(0, 128);
  if (typeof error.requestId === "string" && error.requestId.trim()) diagnostic.requestId = error.requestId.slice(0, 256);
  if (typeof error.httpStatus === "number" && Number.isFinite(error.httpStatus)) diagnostic.httpStatus = error.httpStatus;
  if (typeof error.message === "string" && error.message.trim()) diagnostic.message = error.message.slice(0, 512);
  return Object.keys(diagnostic).length === 0 ? undefined : diagnostic;
}

function buildEnvironment(
  input: CodexAppServerStartInput,
  ambient: NodeJS.ProcessEnv,
): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: input.codexHome,
    CODEX_HOME: input.codexHome,
    OPENAI_BASE_URL: input.endpoint,
    OPENAI_API_KEY: input.apiKey,
    CODEX_MODEL: input.model,
    CODEX_REASONING_EFFORT: input.reasoningEffort,
  };
  if (input.sessionId) environment[OPENCODE_SESSION_ENVIRONMENT_KEY] = input.sessionId;
  if (ambient.PATH) environment.PATH = ambient.PATH;
  if (ambient.LANG) environment.LANG = ambient.LANG;
  if (ambient.TZ) environment.TZ = ambient.TZ;
  if (input.gitEnvironment) {
    // The Worker container is the isolation boundary. Agent commands run
    // inside it with the scoped task credentials so Git fetch/push can reach
    // the repository; worker runtime secrets are redacted from reported events.
    const allowedGitKeys = new Set([
      "GIT_ASKPASS",
      "GIT_CONFIG_GLOBAL",
      "GIT_TERMINAL_PROMPT",
      "GIT_AUTHOR_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_NAME",
      "GIT_COMMITTER_EMAIL",
      "HT_GIT_USERNAME",
      "HT_GIT_TOKEN",
      "HT_GIT_SECRET",
    ]);
    for (const [key, value] of Object.entries(input.gitEnvironment)) {
      if (allowedGitKeys.has(key)) environment[key] = value;
    }
  }
  if (input.runtimeEnvironment) {
    const reserved = new Set(["HOME", "CODEX_HOME", "PATH", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_MODEL", "CODEX_REASONING_EFFORT"]);
    for (const [key, value] of Object.entries(input.runtimeEnvironment)) {
      if (/^[A-Z][A-Z0-9_]{0,190}$/u.test(key) && !reserved.has(key) && typeof value === "string" && value.length <= 32_768) {
        environment[key] = value;
      }
    }
  }
  return environment;
}

/**
 * The TUI is a separate `codex` process. It must be started with the same
 * provider configuration as the app-server, otherwise it falls back to the
 * built-in ChatGPT login screen. The API key is deliberately not included: the
 * app-server owns credentials and the TUI only talks to it over the endpoint.
 */
export function modelProviderArguments(endpoint: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw workerError("configuration_required", "Worker model site endpoint is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw workerError("configuration_required", "Worker model site endpoint is invalid");
  }
  return [
    "--config", 'model_provider="humanthread_linux_worker"',
    "--config", 'model_providers.humanthread_linux_worker.name="HumanThread Linux Worker"',
    "--config", `model_providers.humanthread_linux_worker.base_url=${JSON.stringify(endpoint)}`,
    "--config", 'model_providers.humanthread_linux_worker.env_key="OPENAI_API_KEY"',
    "--config", 'model_providers.humanthread_linux_worker.wire_api="responses"',
    "--config", "model_providers.humanthread_linux_worker.requires_openai_auth=false",
    // The relayed Codex build shows an interactive "Update available" banner on
    // startup that swallows the first keystrokes. Inside a shared session that
    // looks like a frozen cursor, so the update check is disabled explicitly.
    "--config", "check_for_update_on_startup=false",
    // Sub2API relay implementations reject the Responses `summary` field. Codex
    // otherwise emits it from model metadata, which makes an unlisted relayed
    // model fail before its first turn even starts.
    "--config", 'model_reasoning_summary="none"',
    // OpenCode-compatible gateways require a stable per-conversation session
    // header for routing and prompt caching. The value is omitted when the
    // environment variable is absent, so other providers are unaffected.
    "--config", `model_providers.humanthread_linux_worker.env_http_headers={ "x-opencode-session" = "${OPENCODE_SESSION_ENVIRONMENT_KEY}" }`,
  ];
}

function checklistMcpConfig(input: CodexAppServerStartInput["checklistMcp"]): string {
  if (!input) return "";
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw workerError("configuration_required", "Worker checklist MCP endpoint is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw workerError("configuration_required", "Worker checklist MCP endpoint is invalid");
  }
  const headers = Object.entries(input.headers);
  if (headers.length === 0 || headers.length > 8 || headers.some(([name, value]) => (
    !/^[a-z0-9-]{1,128}$/iu.test(name)
    || !value.trim()
    || value.length > 4_096
    || /[\r\n\0]/u.test(value)
  ))) {
    throw workerError("configuration_required", "Worker checklist MCP headers are invalid");
  }
  const serializedHeaders = headers.map(([name, value]) => `${JSON.stringify(name)} = ${JSON.stringify(value)}`).join(", ");
  return [
    "[mcp_servers.humanthread_checklist]",
    `url = ${JSON.stringify(url.toString())}`,
    `http_headers = { ${serializedHeaders} }`,
    "",
  ].join("\n");
}

function codexConfigToml(input: CodexAppServerStartInput, catalogPath: string | null): string {
  const sections: string[] = ['model_reasoning_summary = "none"'];
  if (catalogPath) sections.unshift(`model_catalog_json = ${JSON.stringify(catalogPath)}`);
  const mcpConfig = checklistMcpConfig(input.checklistMcp);
  if (mcpConfig) sections.push(mcpConfig.trimEnd());
  return `${sections.join("\n\n")}\n`;
}

/**
 * Writes a relay-compatible model catalog into the isolated Codex home. The
 * bundled catalog supplies a complete template when available; otherwise the
 * generator supplies a self-contained fallback so an unlisted leased model
 * never falls back to incompatible Codex metadata.
 */
async function modelCatalogArguments(
  readBundledModelCatalog: BundledModelCatalogReader | undefined,
  input: CodexAppServerStartInput,
  executable: string,
): Promise<{ arguments: string[]; path: string | null }> {
  if (!readBundledModelCatalog || !input.model) return { arguments: [], path: null };
  let catalog: string | null = null;
  try {
    catalog = await readBundledModelCatalog?.(executable, input.codexHome) ?? null;
  } catch {
    catalog = null;
  }
  const patched = catalog === null
    ? createRelayModelCatalog(input.model, input.reasoningEffort)
    : patchModelCatalogForDirectTools(catalog, input.model, input.reasoningEffort)
      ?? createRelayModelCatalog(input.model, input.reasoningEffort);
  const catalogPath = join(input.codexHome, MODEL_CATALOG_FILE);
  await writeFile(catalogPath, patched, { encoding: "utf8", mode: 0o600 });
  return {
    arguments: ["--config", `model_catalog_json=${JSON.stringify(catalogPath)}`],
    path: catalogPath,
  };
}

function parseMessage(line: string): unknown {
  if (Buffer.byteLength(line, "utf8") > MAX_JSON_RPC_LINE_BYTES) {
    throw workerError("provider_protocol_error", "Codex app-server message exceeds the size limit");
  }
  try {
    return JSON.parse(line);
  } catch {
    throw workerError("provider_protocol_error", "Codex app-server emitted invalid JSON");
  }
}

function isResponse(value: unknown): value is JsonRpcResponse {
  if (!value || typeof value !== "object") return false;
  return Number.isSafeInteger(Reflect.get(value, "id"))
    && (Object.prototype.hasOwnProperty.call(value, "result") !== Object.prototype.hasOwnProperty.call(value, "error"));
}

export function createCodexAppServerClient(dependencies: {
  spawn?: SpawnLike;
  ambientEnvironment?: NodeJS.ProcessEnv;
  createDirectory?: CreateDirectoryLike;
  requestTimeoutMs?: number;
  readBundledModelCatalog?: BundledModelCatalogReader;
  transport?: "stdio" | "websocket";
  connect?: ConnectLike;
}) {
  const spawn = dependencies.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const ambientEnvironment = dependencies.ambientEnvironment ?? process.env;
  const createDirectory = dependencies.createDirectory ?? mkdir;
  const notifications = new Set<(message: { method: string; params: unknown }) => void>();
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000) {
    throw workerError("invalid_arguments", "Codex app-server request timeout is invalid");
  }
  const pending = new Map<number, PendingRequest>();
  let child: ChildProcessLike | null = null;
  let socket: CodexAppServerSocket | null = null;
  let listeningEndpoint: string | null = null;
  let nextRequestId = 1;
  let bufferedStdout = "";
  const transport = dependencies.transport ?? "stdio";
  const connect = dependencies.connect ?? ((url: string) => new WebSocket(url) as unknown as CodexAppServerSocket);

  const rejectPending = (error: Error): void => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  };

  const handleMessage = (line: string): void => {
    const message = parseMessage(line);
    if (isResponse(message)) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) {
        const failure = workerError("provider_error", String(message.error.message ?? "Codex app-server request failed").slice(0, 512));
        const diagnostic = providerDiagnostic(message.error);
        if (diagnostic) Object.assign(failure, { providerDiagnostic: diagnostic });
        request.reject(failure);
      } else {
        request.resolve(message.result);
      }
      return;
    }
    if (!message || typeof message !== "object" || typeof Reflect.get(message, "method") !== "string") {
      throw workerError("provider_protocol_error", "Codex app-server emitted an invalid JSON-RPC envelope");
    }
    const notification = { method: String(Reflect.get(message, "method")), params: Reflect.get(message, "params") };
    for (const listener of notifications) listener(notification);
  };

  const request = (method: string, params?: unknown): Promise<unknown> => {
    if (transport === "stdio" && !child?.stdin.writable) {
      return Promise.reject(workerError("provider_transport_error", "Codex app-server is not running"));
    }
    if (transport === "websocket" && socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(workerError("provider_transport_error", "Codex app-server websocket is not connected"));
    }
    const id = nextRequestId++;
    const serialized = `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_RPC_LINE_BYTES) {
      return Promise.reject(workerError("provider_protocol_error", "Codex app-server request exceeds the size limit"));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!pending.delete(id)) return;
        const code = method === "initialize" ? "provider_start_timeout" : "provider_transport_timeout";
        reject(workerError(code, `Codex app-server ${method} request timed out`));
        child?.kill("SIGTERM");
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timeout });
      const writeError = (error: unknown) => {
        const pendingRequest = pending.get(id);
        pending.delete(id);
        if (pendingRequest) clearTimeout(pendingRequest.timeout);
        reject(workerError("provider_transport_error", error instanceof Error ? error.message : "Codex app-server transport write failed"));
      };
      if (transport === "stdio") {
        child?.stdin.write(serialized, (error) => {
          if (!error) return;
          writeError(error);
        });
      } else {
        socket?.send(serialized, (error?: Error) => {
          if (!error) return;
          writeError(error);
        });
      }
    });
  };

  const notify = (method: string, params?: unknown): Promise<void> => {
    if (transport === "stdio" && !child?.stdin.writable) {
      return Promise.reject(workerError("provider_transport_error", "Codex app-server is not running"));
    }
    if (transport === "websocket" && socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(workerError("provider_transport_error", "Codex app-server websocket is not connected"));
    }
    const serialized = `${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_RPC_LINE_BYTES) {
      return Promise.reject(workerError("provider_protocol_error", "Codex app-server notification exceeds the size limit"));
    }
    return new Promise((resolve, reject) => {
      if (transport === "stdio") {
        child?.stdin.write(serialized, (error) => {
          if (error) reject(workerError("provider_transport_error", "Codex app-server stdin is unavailable"));
          else resolve();
        });
        return;
      }
      socket?.send(serialized, (error?: Error) => {
        if (error) reject(workerError("provider_transport_error", error.message));
        else resolve();
      });
    });
  };

  return {
    async start(input: CodexAppServerStartInput): Promise<void> {
      if (child) return;
      const executable = input.executable ?? "codex";
      // The Worker speaks JSON-RPC over the child stdin/stdout pipes. Keep the
      // transport explicit because Codex app-server also supports daemon and
      // websocket transports, and the CLI default may change between releases.
      const arguments_ = transport === "websocket"
        ? ["app-server", "--listen", "ws://127.0.0.1:0", ...modelProviderArguments(input.endpoint)]
        : ["app-server", "--stdio", ...modelProviderArguments(input.endpoint)];
      try {
        await createDirectory(input.codexHome, { recursive: true, mode: 0o700 });
        const catalog = await modelCatalogArguments(dependencies.readBundledModelCatalog, input, executable);
        arguments_.push(...catalog.arguments);
        if (catalog.path || input.checklistMcp) {
          await writeFile(
            join(input.codexHome, "config.toml"),
            codexConfigToml(input, catalog.path),
            { encoding: "utf8", mode: 0o600 },
          );
        }
      } catch {
        throw workerError("worker_state_unavailable", "Unable to create the isolated Codex home directory");
      }
      child = spawn(executable, arguments_, {
        cwd: input.cwd,
        env: buildEnvironment(input, ambientEnvironment),
        stdio: "pipe",
      });
      const handleRemoteLine = (line: string): void => {
        const match = /listening on:\s+(ws:\/\/[^\s]+)/u.exec(line);
        if (match?.[1]) listeningEndpoint = match[1];
      };
      child.stdout.on("data", (chunk: Buffer | string) => {
        bufferedStdout += String(chunk);
        const lines = bufferedStdout.split("\n");
        bufferedStdout = lines.pop() ?? "";
        try {
          for (const line of lines) {
            if (!line.trim()) continue;
            if (transport === "websocket") handleRemoteLine(line);
            else handleMessage(line);
          }
        } catch (error) {
          rejectPending(error instanceof Error ? error : workerError("provider_protocol_error", "Codex app-server protocol failed"));
          child?.kill();
        }
      });
      child.once("error", () => rejectPending(workerError("provider_transport_error", "Codex app-server failed to start")));
      child.once("exit", () => {
        child = null;
        socket = null;
        rejectPending(workerError("provider_transport_error", "Codex app-server stopped"));
      });
      if (transport === "websocket") {
        child.stderr?.on("data", (chunk: Buffer | string) => {
          for (const line of String(chunk).split(/\r?\n/u)) handleRemoteLine(line);
        });
        const endpoint = await new Promise<string>((resolve, reject) => {
          const startedAt = Date.now();
          const timer = setInterval(() => {
            if (listeningEndpoint) {
              clearInterval(timer);
              resolve(listeningEndpoint);
            } else if (Date.now() - startedAt >= 15_000) {
              clearInterval(timer);
              reject(workerError("provider_start_timeout", "Codex app-server websocket endpoint did not become ready"));
            }
          }, 10);
          timer.unref?.();
        });
        socket = connect(endpoint);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(workerError("provider_start_timeout", "Codex app-server websocket did not connect")), 15_000);
          const onOpen = () => {
            clearTimeout(timeout);
            resolve();
          };
          const onError = (error: unknown) => {
            clearTimeout(timeout);
            reject(workerError("provider_transport_error", error instanceof Error ? error.message : "Codex app-server websocket failed"));
          };
          socket?.on("open", onOpen);
          socket?.on("error", onError);
        });
        socket.on("message", (data, isBinary) => {
          if (isBinary) return;
          try {
            handleMessage(String(data));
          } catch (error) {
            rejectPending(error instanceof Error ? error : workerError("provider_protocol_error", "Codex app-server protocol failed"));
            socket?.close();
          }
        });
        socket.on("close", () => {
          socket = null;
          rejectPending(workerError("provider_transport_error", "Codex app-server websocket stopped"));
        });
      }
      await request("initialize", {
        clientInfo: { name: "humanthread-linux-worker", version: "0.1.3" },
        // `process/spawn` drives the attachable TUI PTY and is gated behind the
        // experimental API flag. Worker TUI sessions depend on it, so the
        // capability is advertised for every Worker app-server start.
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      await notify("initialized");
    },
    request,
    subscribe(listener: (message: { method: string; params: unknown }) => void): () => void {
      notifications.add(listener);
      return () => notifications.delete(listener);
    },
    endpoint(): string | null {
      return listeningEndpoint;
    },
    async stop(): Promise<void> {
      if (!child) return;
      socket?.close();
      socket = null;
      child.kill("SIGTERM");
      child = null;
    },
  };
}
