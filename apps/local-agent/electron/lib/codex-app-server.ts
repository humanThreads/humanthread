import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  buildCodexCommandWithOverrides,
  resolveCodexExecutable,
  validateEnvironmentOverrides,
} from "./agent-runtime";
import {
  createCodexAppServerTransport,
  parseAppServerListeningEndpoint,
  type CodexAppServerTransport,
} from "./codex-app-server-transport";
import { validateEnvironmentRefs } from "./core";
import {
  prepareIsolatedCodexHome,
  readAgentCredential,
  writeIsolatedChecklistMcpConfig,
  type CredentialContext,
  type IsolationContext,
} from "./local-model";
import { resolveWorkspacePathImpl } from "./workspace";

export const MAX_JSON_RPC_LINE_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 4 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const STARTUP_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;
const INDEPENDENT_AUTH_REFS = new Set([
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
]);

export interface CodexAppServerState {
  processKey: string;
  generation: number;
  pid: number;
  bindingFingerprint: string;
  model: string | null;
  reasoningEffort: string | null;
  transport: "websocket" | "unix" | "stdio";
  endpoint: string | null;
  protocolVersion: string | null;
  status: string;
  lastNotificationAt: number | null;
  pendingRequestCount: number;
  stderrSummary: string | null;
  lastErrorCode: string | null;
}

export interface CodexAppServerNotification {
  processKey: string;
  generation: number;
  method: string;
  params: unknown;
  requestId: string | number | null;
  receivedAtMs: number;
}

export interface StartCodexAppServerInput {
  processKey: string;
  cwd: string;
  executable: string;
  transport?: "websocket" | "unix";
  model?: string | null;
  reasoningEffort?: string | null;
  environmentRefs?: string[];
  environmentOverrides?: Record<string, string>;
  credentialContext?: CredentialContext | null;
  isolationContext?: IsolationContext | null;
  checklistMcp?: { url: string; headers: Record<string, string> } | null;
}

export interface CodexAppServerHost {
  send(event: string, payload: unknown): void;
  spawn?: typeof spawn;
  resolveExecutable?: (command: string) => string;
  transportFactory?: (input: {
    kind: "websocket" | "unix";
    endpoint: string;
    timeoutMs: number;
  }) => CodexAppServerTransport;
  socketDirectory?: string;
}

interface PendingEntry {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface HandleState {
  status: string;
  lastNotificationAt: number | null;
  stderrSummary: string | null;
  lastErrorCode: string | null;
}

interface AppServerHandle {
  processKey: string;
  generation: number;
  pid: number;
  bindingFingerprint: string;
  model: string | null;
  reasoningEffort: string | null;
  transportKind: "websocket" | "unix";
  endpoint: string | null;
  protocolVersion: string | null;
  child: ChildProcess;
  transport: CodexAppServerTransport | null;
  endpointPromise: Promise<CodexAppServerTransport>;
  resolveEndpoint(transport: CodexAppServerTransport): void;
  rejectEndpoint(error: Error): void;
  endpointSettled: boolean;
  pending: Map<number, PendingEntry>;
  nextId: number;
  state: HandleState;
}

type RpcFailure = Error & { code: string; rpcCode?: number };

export function nowMs(): number {
  return Date.now();
}

export function boundedErrorMessage(message: string): string {
  const redacted = message
    .split(/\s+/u)
    .map((token) => {
      const lower = token.toLowerCase();
      if (["key=", "token=", "secret=", "password=", "authorization="].some((prefix) => lower.startsWith(prefix))) {
        const separator = token.indexOf("=");
        return separator >= 0 ? `${token.slice(0, separator + 1)}[redacted]` : "[redacted]";
      }
      return token;
    })
    .join(" ");
  return [...redacted].slice(0, 512).join("");
}

function providerError(code: string, message: string, rpcCode?: number): RpcFailure {
  return Object.assign(new Error(`${code}: ${boundedErrorMessage(message)}`), {
    code,
    ...(rpcCode === undefined ? {} : { rpcCode }),
  });
}

export function validateJsonRpcLine(line: string): unknown {
  if (line.length > MAX_JSON_RPC_LINE_BYTES) {
    throw new Error("Codex app-server message size exceeds the limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new Error("Codex app-server message is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Codex app-server message must be an object");
  }
  const object = value as Record<string, unknown>;
  if (object.jsonrpc !== undefined && object.jsonrpc !== "2.0") {
    throw new Error("Codex app-server message has an unsupported JSON-RPC version");
  }
  const hasMethod = "method" in object;
  const hasResult = "result" in object;
  const hasError = "error" in object;
  if (hasMethod) {
    if (hasResult || hasError) {
      throw new Error("Codex app-server message cannot be both a request and a response");
    }
    const method = object.method;
    if (
      typeof method !== "string" ||
      method.length === 0 ||
      method.length > 256 ||
      /[\u0000-\u001F\u007F]/u.test(method)
    ) {
      throw new Error("Codex app-server method is invalid");
    }
    if (
      object.id !== undefined &&
      !(
        (typeof object.id === "number" && Number.isSafeInteger(object.id)) ||
        (typeof object.id === "string" && object.id.length > 0 && object.id.length <= 128)
      )
    ) {
      throw new Error("Codex app-server request id is invalid");
    }
    return value;
  }
  const validId = typeof object.id === "number" && Number.isSafeInteger(object.id);
  if (!validId || hasResult === hasError) {
    throw new Error("Codex app-server response id or result is invalid");
  }
  if (object.error !== undefined) {
    const error = object.error;
    if (
      !error ||
      typeof error !== "object" ||
      !Number.isSafeInteger((error as Record<string, unknown>).code) ||
      typeof (error as Record<string, unknown>).message !== "string"
    ) {
      throw new Error("Codex app-server response error is invalid");
    }
  }
  return value;
}

export function buildServerResponse(
  requestId: unknown,
  result: unknown,
  error: unknown,
): string {
  const validId =
    (typeof requestId === "string" && requestId.length > 0) ||
    (typeof requestId === "number" && Number.isSafeInteger(requestId));
  if (!validId || (result !== undefined) === (error !== undefined)) {
    throw new Error("Codex app-server response is invalid");
  }
  if (error !== undefined) {
    const errorObject = error as Record<string, unknown> | null;
    if (
      !errorObject ||
      typeof errorObject !== "object" ||
      !Number.isSafeInteger(errorObject.code) ||
      typeof errorObject.message !== "string"
    ) {
      throw new Error("Codex app-server response error is invalid");
    }
  }
  const response: Record<string, unknown> = { jsonrpc: "2.0", id: requestId };
  if (result !== undefined) response.result = result;
  if (error !== undefined) response.error = error;
  const serialized = JSON.stringify(response);
  if (serialized.length > MAX_JSON_RPC_LINE_BYTES) {
    throw new Error("Codex app-server response size exceeds the limit");
  }
  return serialized;
}

export function sanitizeEnvironmentRefs(refs: string[], independentCredentials: boolean): string[] {
  return refs.filter((reference) => !independentCredentials || !INDEPENDENT_AUTH_REFS.has(reference));
}

function validateProcessKey(value: string): void {
  if (
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9_:.-]+$/u.test(value)
  ) {
    throw new Error("Codex app-server process key is invalid");
  }
}

function validateModelSiteUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Codex local model site URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error("Codex local model site URL is invalid");
  }
}

function modelProviderArgs(baseUrl: string | null): string[] {
  if (baseUrl === null) return [];
  validateModelSiteUrl(baseUrl);
  return [
    "--config",
    'model_provider="humanthread_local"',
    "--config",
    'model_providers.humanthread_local.name="HumanThread Desktop"',
    "--config",
    `model_providers.humanthread_local.base_url=${JSON.stringify(baseUrl)}`,
    "--config",
    'model_providers.humanthread_local.env_key="OPENAI_API_KEY"',
    "--config",
    'model_providers.humanthread_local.wire_api="responses"',
    "--config",
    "model_providers.humanthread_local.requires_openai_auth=false",
  ];
}

function buildAppServerArgs(input: {
  transport: "websocket" | "unix";
  endpoint: string;
  baseUrl: string | null;
}): string[] {
  return ["app-server", "--listen", input.endpoint, ...modelProviderArgs(input.baseUrl)];
}

function validateRuntimeModel(model: string | null | undefined, independentCredentials: boolean): void {
  if (independentCredentials && (model === null || model === undefined)) {
    throw new Error("Independent Codex execution requires an explicit model");
  }
  if (model !== null && model !== undefined) {
    if (model.length === 0 || model.length > 512 || /[\u0000-\u001F\u007F]/u.test(model)) {
      throw new Error("Selected Codex model is invalid");
    }
  }
}

function validateRuntimeEffort(effort: string | null | undefined): void {
  if (effort !== null && effort !== undefined) {
    if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)) {
      throw new Error("Selected Codex reasoning effort is invalid");
    }
  }
}

function bindingFingerprint(input: StartCodexAppServerInput, baseUrl: string | null): string {
  const digest = createHash("sha256");
  digest.update(input.credentialContext?.deploymentOrigin ?? "environment");
  digest.update("\0");
  digest.update(input.credentialContext?.userId ?? "environment");
  digest.update("\0");
  digest.update(input.credentialContext?.credentialRef ?? "environment");
  digest.update("\0");
  digest.update(baseUrl ?? "environment");
  digest.update("\0");
  digest.update(input.model ?? "environment");
  digest.update("\0");
  digest.update(input.reasoningEffort ?? "environment");
  return digest.digest("hex");
}

function unixSocketPath(directory: string, fingerprint: string): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${fingerprint}.sock`);
  try {
    if (statSync(path).isSocket()) unlinkSync(path);
  } catch {
    // A missing socket is the normal fresh-start path.
  }
  return path;
}

function isMethodNotFound(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "rpcCode") === -32601;
}

export class CodexAppServerRegistry {
  private readonly servers = new Map<string, AppServerHandle>();
  private readonly notificationHandlers = new Set<(notification: CodexAppServerNotification) => void>();
  private readonly host: CodexAppServerHost;

  constructor(host: CodexAppServerHost) {
    this.host = host;
  }

  private snapshot(handle: AppServerHandle): CodexAppServerState {
    return {
      processKey: handle.processKey,
      generation: handle.generation,
      pid: handle.pid,
      bindingFingerprint: handle.bindingFingerprint,
      model: handle.model,
      reasoningEffort: handle.reasoningEffort,
      transport: handle.transportKind,
      endpoint: handle.endpoint,
      protocolVersion: handle.protocolVersion,
      status: handle.state.status,
      lastNotificationAt: handle.state.lastNotificationAt,
      pendingRequestCount: handle.pending.size,
      stderrSummary: handle.state.stderrSummary,
      lastErrorCode: handle.state.lastErrorCode,
    };
  }

  private emitState(handle: AppServerHandle): void {
    this.host.send("codex_app_server_state", this.snapshot(handle));
  }

  private rejectPending(handle: AppServerHandle, error: Error): void {
    for (const [id, entry] of handle.pending) {
      handle.pending.delete(id);
      entry.reject(error);
    }
  }

  private markFailed(handle: AppServerHandle, code: string, message: string): void {
    const bounded = boundedErrorMessage(message);
    handle.state.status = code === "provider_process_exit" ? "stopped" : "failed";
    handle.state.lastErrorCode = code;
    handle.state.stderrSummary = bounded;
    this.rejectPending(handle, providerError(code, bounded));
    this.emitState(handle);
  }

  private handleRpcLine(handle: AppServerHandle, line: string): void {
    let value: unknown;
    try {
      value = validateJsonRpcLine(line);
    } catch (error) {
      this.markFailed(handle, "provider_protocol_error", (error as Error).message);
      return;
    }
    const object = value as Record<string, unknown>;
    if (typeof object.method === "string") {
      handle.state.lastNotificationAt = nowMs();
      const notification: CodexAppServerNotification = {
        processKey: handle.processKey,
        generation: handle.generation,
        method: object.method,
        params: object.params ?? null,
        requestId: typeof object.id === "number" || typeof object.id === "string" ? object.id : null,
        receivedAtMs: nowMs(),
      };
      this.host.send("codex_app_server_notification", notification);
      for (const handler of this.notificationHandlers) handler(notification);
      this.emitState(handle);
      return;
    }
    if (typeof object.id !== "number" || !Number.isSafeInteger(object.id)) return;
    const entry = handle.pending.get(object.id);
    if (!entry) return;
    handle.pending.delete(object.id);
    if (object.error !== undefined) {
      const errorObject = object.error as Record<string, unknown>;
      const rpcCode = typeof errorObject.code === "number" ? errorObject.code : undefined;
      const message = typeof errorObject.message === "string" ? errorObject.message : "Codex app-server request failed";
      entry.reject(providerError("provider_rpc_error", message, rpcCode));
    } else if (object.result !== undefined) {
      entry.resolve(object.result);
    } else {
      entry.reject(providerError("provider_protocol_error", "Codex app-server response has no result"));
    }
  }

  private attachEndpoint(handle: AppServerHandle, endpoint: string): void {
    if (handle.transport || handle.endpointSettled) return;
    handle.endpoint = endpoint;
    let transport: CodexAppServerTransport;
    try {
      const factory = this.host.transportFactory ?? createCodexAppServerTransport;
      transport = factory({
        kind: handle.transportKind,
        endpoint,
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
    } catch (error) {
      const failure = providerError("provider_transport_error", (error as Error).message);
      handle.endpointSettled = true;
      handle.rejectEndpoint(failure);
      this.markFailed(handle, failure.code, failure.message);
      return;
    }
    handle.transport = transport;
    transport.onMessage((line) => this.handleRpcLine(handle, line));
    transport.onClose((error) => {
      if (handle.state.status !== "stopped") {
        this.markFailed(
          handle,
          "provider_process_exit",
          error?.message ?? "Codex app-server daemon connection closed",
        );
      }
    });
    void transport.ready().then(() => {
      if (handle.endpointSettled) return;
      handle.endpointSettled = true;
      handle.resolveEndpoint(transport);
      this.emitState(handle);
    }).catch((error: Error) => {
      if (handle.endpointSettled) return;
      handle.endpointSettled = true;
      handle.rejectEndpoint(providerError("provider_transport_error", error.message));
      this.markFailed(handle, "provider_transport_error", error.message);
    });
  }

  private spawnReaders(handle: AppServerHandle): void {
    if (!handle.child.stdout || !handle.child.stderr) return;
    const stdoutReader = createInterface({ input: handle.child.stdout });
    stdoutReader.on("line", (line) => {
      const endpoint = parseAppServerListeningEndpoint(line);
      if (endpoint) this.attachEndpoint(handle, endpoint);
    });
    stdoutReader.on("close", () => {
      if (!handle.endpointSettled) {
        handle.endpointSettled = true;
        handle.rejectEndpoint(providerError("provider_transport_error", "Codex app-server stdout closed"));
      }
    });
    let summary = "";
    const stderrReader = createInterface({ input: handle.child.stderr });
    stderrReader.on("line", (line) => {
      if (summary.length < MAX_STDERR_BYTES) summary += `${line}\n`;
    });
    stderrReader.on("close", () => {
      if (summary.trim().length > 0) {
        handle.state.stderrSummary = boundedErrorMessage(summary);
        this.emitState(handle);
      }
    });
  }

  private removeIfGeneration(processKey: string, generation: number): void {
    const existing = this.servers.get(processKey);
    if (existing?.generation === generation) this.servers.delete(processKey);
  }

  private get(processKey: string): AppServerHandle {
    const handle = this.servers.get(processKey);
    if (!handle) throw providerError("provider_transport_error", "Codex app-server process is not running");
    return handle;
  }

  private async transportFor(handle: AppServerHandle): Promise<CodexAppServerTransport> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        handle.endpointPromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(providerError(
            "provider_start_timeout",
            "Codex app-server endpoint is unavailable",
          )), STARTUP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  start(input: StartCodexAppServerInput): CodexAppServerState {
    validateProcessKey(input.processKey);
    validateEnvironmentRefs(input.environmentRefs ?? []);
    validateEnvironmentOverrides(input.environmentOverrides ?? {});
    const baseUrl = input.environmentOverrides?.OPENAI_BASE_URL ?? null;
    validateRuntimeModel(input.model, input.credentialContext !== undefined && input.credentialContext !== null);
    validateRuntimeEffort(input.reasoningEffort);
    if (input.credentialContext && baseUrl === null) {
      throw new Error("Independent Codex credentials require the selected local model provider");
    }
    const binding = bindingFingerprint(input, baseUrl);
    const existing = this.servers.get(input.processKey);
    if (existing) {
      if (existing.bindingFingerprint === binding) return this.snapshot(existing);
      throw new Error("Codex app-server process key is already bound to another model site");
    }

    const transportKind = input.transport ?? "websocket";
    const resolution = resolveWorkspacePathImpl(input.cwd, input.cwd);
    const executable = (this.host.resolveExecutable ?? resolveCodexExecutable)(input.executable);
    let environmentRefs = sanitizeEnvironmentRefs(input.environmentRefs ?? [], Boolean(input.credentialContext));
    const environmentOverrides = { ...(input.environmentOverrides ?? {}) };
    if (input.credentialContext) {
      const context = input.credentialContext;
      const apiKey = readAgentCredential(context.deploymentOrigin, context.userId, context.credentialRef);
      const codexHome = prepareIsolatedCodexHome(context.deploymentOrigin, context.userId);
      if (input.checklistMcp) {
        writeIsolatedChecklistMcpConfig(codexHome, input.checklistMcp.url, input.checklistMcp.headers);
      }
      environmentRefs = sanitizeEnvironmentRefs(environmentRefs, true);
      environmentOverrides.OPENAI_API_KEY = apiKey;
      environmentOverrides.CODEX_HOME = codexHome;
    } else if (input.isolationContext && input.checklistMcp) {
      const codexHome = prepareIsolatedCodexHome(
        input.isolationContext.deploymentOrigin,
        input.isolationContext.userId,
      );
      writeIsolatedChecklistMcpConfig(codexHome, input.checklistMcp.url, input.checklistMcp.headers);
      environmentRefs = sanitizeEnvironmentRefs(environmentRefs, true);
      environmentOverrides.CODEX_HOME = codexHome;
    }

    const endpoint = transportKind === "unix"
      ? `unix://${unixSocketPath(
        this.host.socketDirectory ?? join(resolution.targetRealpath, ".humanthread", "codex-daemon"),
        binding,
      )}`
      : "ws://127.0.0.1:0";
    const args = buildAppServerArgs({ transport: transportKind, endpoint, baseUrl });
    const spec = buildCodexCommandWithOverrides({
      executable,
      cwd: resolution.targetRealpath,
      args,
      inheritedPath: process.env.PATH,
      environmentRefs,
      environmentOverrides,
    });

    let resolveEndpoint!: (transport: CodexAppServerTransport) => void;
    let rejectEndpoint!: (error: Error) => void;
    const endpointPromise = new Promise<CodexAppServerTransport>((resolve, reject) => {
      resolveEndpoint = resolve;
      rejectEndpoint = reject;
    });
    const child = (this.host.spawn ?? spawn)(spec.program, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const handle: AppServerHandle = {
      processKey: input.processKey,
      generation: nowMs(),
      pid: child.pid ?? 0,
      bindingFingerprint: binding,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      transportKind,
      endpoint: null,
      protocolVersion: null,
      child,
      transport: null,
      endpointPromise,
      resolveEndpoint,
      rejectEndpoint,
      endpointSettled: false,
      pending: new Map(),
      nextId: 1,
      state: {
        status: "starting",
        lastNotificationAt: null,
        stderrSummary: null,
        lastErrorCode: null,
      },
    };
    this.servers.set(input.processKey, handle);
    this.spawnReaders(handle);
    child.once("exit", (code, signal) => {
      const label = code !== null ? String(code) : signal ?? "signal";
      if (!handle.endpointSettled) {
        handle.endpointSettled = true;
        handle.rejectEndpoint(providerError("provider_process_exit", label));
      }
      this.markFailed(handle, "provider_process_exit", `Codex app-server exited with ${label}`);
      this.removeIfGeneration(input.processKey, handle.generation);
    });
    child.once("error", (error) => {
      if (!handle.endpointSettled) {
        handle.endpointSettled = true;
        handle.rejectEndpoint(providerError("provider_process_wait_failed", error.message));
      }
      this.markFailed(handle, "provider_process_wait_failed", error.message);
      this.removeIfGeneration(input.processKey, handle.generation);
    });
    this.emitState(handle);
    return this.snapshot(handle);
  }

  async request(processKey: string, method: string, params: unknown): Promise<unknown> {
    if (method.length === 0 || method.length > 256 || /[\u0000-\u001F\u007F]/u.test(method)) {
      throw new Error("Codex app-server method is invalid");
    }
    const handle = this.get(processKey);
    const transport = await this.transportFor(handle);
    const id = handle.nextId;
    handle.nextId += 1;
    const serialized = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    if (serialized.length > MAX_JSON_RPC_LINE_BYTES) {
      throw new Error("Codex app-server request size exceeds the limit");
    }
    const responsePromise = new Promise<unknown>((resolvePromise, rejectPromise) => {
      handle.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    });
    try {
      await transport.write(`${serialized}\n`);
    } catch (error) {
      handle.pending.delete(id);
      throw providerError("provider_transport_error", (error as Error).message);
    }
    const timeoutMs = method === "initialize" ? STARTUP_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    let result: unknown;
    try {
      result = await Promise.race([
        responsePromise,
        new Promise<never>((_resolvePromise, rejectPromise) => {
          timer = setTimeout(() => rejectPromise(providerError(
            "provider_request_timeout",
            method === "initialize"
              ? "Codex app-server initialize timed out"
              : "Codex app-server request timed out",
          )), timeoutMs);
        }),
      ]);
    } catch (error) {
      handle.pending.delete(id);
      if (error instanceof Error && error.message.startsWith("provider_request_timeout:") && method === "initialize") {
        this.markFailed(handle, "provider_start_timeout", error.message);
        try { handle.child.kill("SIGKILL"); } catch { /* already gone */ }
        this.removeIfGeneration(processKey, handle.generation);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (method === "initialize") {
      const response = result && typeof result === "object" && !Array.isArray(result)
        ? result as Record<string, unknown>
        : null;
      handle.protocolVersion = typeof response?.userAgent === "string"
        ? boundedErrorMessage(response.userAgent)
        : null;
      handle.state.status = "ready";
      this.emitState(handle);
    }
    return result;
  }

  async notify(processKey: string, method: string, params: unknown): Promise<void> {
    if (method.length === 0 || method.length > 256 || /[\u0000-\u001F\u007F]/u.test(method)) {
      throw new Error("Codex app-server method is invalid");
    }
    const handle = this.get(processKey);
    const transport = await this.transportFor(handle);
    const request: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== null && params !== undefined) request.params = params;
    const serialized = JSON.stringify(request);
    if (serialized.length > MAX_JSON_RPC_LINE_BYTES) {
      throw new Error("Codex app-server notification size exceeds the limit");
    }
    try {
      await transport.write(`${serialized}\n`);
    } catch (error) {
      throw providerError("provider_transport_error", (error as Error).message);
    }
  }

  async respond(processKey: string, requestId: unknown, result: unknown, error: unknown): Promise<void> {
    const handle = this.get(processKey);
    const transport = await this.transportFor(handle);
    const serialized = buildServerResponse(requestId, result, error);
    try {
      await transport.write(`${serialized}\n`);
    } catch (writeError) {
      throw providerError("provider_transport_error", (writeError as Error).message);
    }
  }

  async cancel(processKey: string, threadId: string, turnId?: string): Promise<void> {
    const params: Record<string, unknown> = { threadId };
    if (turnId !== undefined) params.turnId = turnId;
    await this.request(processKey, "turn/interrupt", params);
  }

  subscribe(handler: (notification: CodexAppServerNotification) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  state(processKey: string): CodexAppServerState | null {
    const handle = this.servers.get(processKey);
    return handle ? this.snapshot(handle) : null;
  }

  async probeCapabilities(processKey: string, executable: string): Promise<void> {
    const processHandle = `probe:${processKey}:${nowMs()}`;
    const resolvedExecutable = (this.host.resolveExecutable ?? resolveCodexExecutable)(executable);
    try {
      await this.request(processKey, "process/spawn", {
        command: [resolvedExecutable, "--version"],
        processHandle,
        cwd: process.cwd(),
        tty: false,
        streamStdin: false,
        streamStdoutStderr: false,
        outputBytesCap: 4_096,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
    } catch (error) {
      if (isMethodNotFound(error)) {
        throw providerError("provider_tui_unsupported", "Codex app-server does not support process/spawn");
      }
      throw error;
    } finally {
      await this.request(processKey, "process/kill", { processHandle }).catch(() => undefined);
    }
  }

  stop(processKey: string): void {
    const handle = this.servers.get(processKey);
    if (!handle) return;
    this.servers.delete(processKey);
    this.rejectPending(handle, providerError("provider_transport_error", "Codex app-server stopped"));
    void handle.transport?.close().catch(() => undefined);
    try { handle.child.kill("SIGKILL"); } catch { /* already gone */ }
    handle.state.status = "stopped";
    this.emitState(handle);
  }

  states(): CodexAppServerState[] {
    return [...this.servers.values()].map((handle) => this.snapshot(handle));
  }

  hasRunning(): boolean {
    return this.servers.size > 0;
  }

  stopAll(): void {
    for (const processKey of [...this.servers.keys()]) this.stop(processKey);
  }
}
