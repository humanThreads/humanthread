import { DEFAULT_REASONING_EFFORT, reasoningEffortSchema, type ReasoningEffort } from "@humanthread/shared";
import {
  assertPathInsideWorkspace,
  type CodexExecutionPolicy,
  type NativeWorkspacePathResolver,
} from "../workspace-policy";
import type {
  AgentProviderAdapter,
  NormalizedRunEvent,
  StructuredProviderExecutionInput,
} from "./provider-adapter";
import {
  type CodexAppServerResponseError,
  type CodexAppServerClient,
  type CodexAppServerNotification,
} from "./codex-app-server-client";
import { projectCodexStructuredOutputSchema } from "./codex-schema";

type AdapterInput = {
  cwd: string;
  prompt: string;
  resultSchemaPath: string;
  executionPolicy: CodexExecutionPolicy;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  environmentOverrides?: Record<string, string>;
  credentialContext?: StructuredProviderExecutionInput["credentialContext"];
  isolationContext?: StructuredProviderExecutionInput["isolationContext"];
  checklistMcp?: StructuredProviderExecutionInput["checklistMcp"];
  signal?: AbortSignal;
  runId?: string;
};

/** Lowest Codex CLI version this adapter is validated against. */
export const SUPPORTED_CODEX_VERSION_FLOOR = "0.159.2";

function codexVersion(value: string | null): [number, number, number] | null {
  const match = /(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/u.exec(value ?? "");
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * A runtime below the validated floor has different app-server semantics, so
 * fail closed instead of silently producing a different execution contract.
 */
export function assertSupportedCodexVersion(value: string | null): void {
  const reported = codexVersion(value);
  const floor = codexVersion(SUPPORTED_CODEX_VERSION_FLOOR)!;
  if (!reported || reported[0] < floor[0]
    || (reported[0] === floor[0] && reported[1] < floor[1])
    || (reported[0] === floor[0] && reported[1] === floor[1] && reported[2] < floor[2])) {
    throw Object.assign(
      new Error(`Codex runtime ${value ?? "unknown"} is below the supported floor ${SUPPORTED_CODEX_VERSION_FLOOR}`),
      { code: "provider_version_unsupported" },
    );
  }
}

function runIdForInput(input: AdapterInput): string {
  const runId = input.runId?.trim();
  if (!runId || runId.length > 256 || /[\u0000-\u001F\u007F]/u.test(runId)) {
    // Standalone adapter callers (tests, manual provider probes) may not have a
    // platform AgentRun id. The production runner always supplies one; the
    // fallback keeps the adapter usable without weakening that identity check.
    return `local:${input.cwd}`;
  }
  return runId;
}

type ResumeInput = AdapterInput & {
  providerSessionId: string;
  providerBindingFingerprint?: string;
  providerTransport?: "codex_app_server" | "codex_cli";
  providerGeneration?: number;
  providerTurnId?: string;
};

export type CodexSessionBinding = {
  runId: string;
  processKey: string;
  threadId: string;
  turnId: string | null;
  generation: number;
  bindingFingerprint: string;
  cwd: string;
  model: string | null;
};

type SchemaReader = (workspaceRoot: string, path: string) => Promise<string | null | unknown>;

type NotificationRecord = Record<string, unknown>;

function record(value: unknown): NotificationRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as NotificationRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function providerError(error: unknown, fallbackCode = "provider_error"): { code: string; message: string } {
  if (error && typeof error === "object") {
    const code = Reflect.get(error, "code");
    const message = Reflect.get(error, "message");
    if (typeof code === "string" && typeof message === "string") {
      return { code, message: message.slice(0, 512) || code };
    }
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message.slice(0, 512) : "Codex app-server request failed",
  };
}

function validateModel(model: string | undefined, independent: boolean): string | undefined {
  if (model === undefined) {
    if (independent) throw Object.assign(new Error("Independent Codex execution requires an explicit model"), { code: "local_model_invalid" });
    return undefined;
  }
  const normalized = model.trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw Object.assign(new Error("Selected model is invalid"), { code: "local_model_invalid" });
  }
  return normalized;
}

function validateEffort(value: ReasoningEffort | undefined): ReasoningEffort {
  const parsed = reasoningEffortSchema.safeParse(value ?? DEFAULT_REASONING_EFFORT);
  if (!parsed.success) throw Object.assign(new Error("Selected reasoning effort is invalid"), { code: "reasoning_effort_invalid" });
  return parsed.data;
}

function bindingKey(input: AdapterInput): string {
  const context = input.credentialContext;
  return [
    context?.deploymentOrigin ?? "environment",
    context?.userId ?? "environment",
    context?.credentialRef ?? "environment",
    input.environmentOverrides?.OPENAI_BASE_URL ?? "environment",
  ].join("\u0000");
}

async function bindingFingerprint(input: AdapterInput): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(bindingKey(input)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sandboxMode(policy: CodexExecutionPolicy): "read-only" | "danger-full-access" {
  return policy.mode === "workspace_full" ? "danger-full-access" : "read-only";
}

function isThreadScopedNotification(method: string): boolean {
  return method.startsWith("turn/")
    || method.startsWith("item/")
    || method.startsWith("thread/tokenUsage/")
    || method.endsWith("/requestApproval")
    || method === "error"
    || method === "turn/failed"
    || method === "turn/usage/updated";
}

function extractThreadId(value: unknown): string {
  const response = record(value);
  const thread = record(response?.thread);
  const id = text(thread?.id);
  if (!id || id.length > 256 || /[\u0000-\u001F\u007F]/u.test(id)) {
    throw Object.assign(new Error("Codex app-server thread response is invalid"), { code: "provider_protocol_error" });
  }
  return id;
}

function extractTurnId(value: unknown): string | undefined {
  const response = record(value);
  const turn = record(response?.turn);
  const id = text(turn?.id);
  return id && id.length <= 256 && !/[\u0000-\u001F\u007F]/u.test(id) ? id : undefined;
}

function parseResult(message: string | null, fallback: unknown): unknown {
  if (message === null) return fallback ?? {};
  try { return JSON.parse(message); } catch { return message; }
}

function itemEvent(item: NotificationRecord, lifecycle: "started" | "completed"): NormalizedRunEvent | null {
  const type = text(item.type);
  if (!type) return null;
  if (type === "agentMessage") {
    const message = text(item.text);
    return lifecycle === "completed" && message !== null
      ? { type: "agent.message.completed", text: message }
      : null;
  }
  if (type === "fileChange" || type === "imageGeneration") {
    return lifecycle === "completed" ? { type: "artifact.produced", payload: item } : null;
  }
  if (
    type === "commandExecution"
    || type === "mcpToolCall"
    || type === "dynamicToolCall"
    || type === "collabAgentToolCall"
  ) {
    return {
      type: lifecycle === "started" ? "tool.started" : "tool.completed",
      tool: type,
      payload: item,
    };
  }
  return null;
}

function notificationEvent(
  notification: CodexAppServerNotification,
  state: { lastMessage: string | null; usage: unknown },
): NormalizedRunEvent | null {
  const params = record(notification.params);
  if (!params) return null;
  if (notification.method.endsWith("/requestApproval")) {
    return {
      type: "approval.requested",
      payload: notification.requestId === undefined || notification.requestId === null
        ? params
        : { ...params, requestId: notification.requestId },
    };
  }
  if (notification.method === "item/agentMessage/delta") {
    const delta = text(params.delta);
    if (delta !== null) state.lastMessage = `${state.lastMessage ?? ""}${delta}`;
    return null;
  }
  if (notification.method === "item/started") {
    return itemEvent(record(params.item) ?? {}, "started");
  }
  if (notification.method === "item/completed") {
    const item = record(params.item) ?? {};
    const message = text(item.text);
    if (text(item.type) === "agentMessage" && message !== null) state.lastMessage = message;
    return itemEvent(item, "completed");
  }
  if (notification.method === "thread/tokenUsage/updated") {
    // Codex reports a cumulative thread snapshot: `total` already includes all
    // turns, so replace instead of adding it again for every TUI turn.
    const tokenUsage = record(params.tokenUsage);
    state.usage = tokenUsage?.total ?? params.total ?? params;
    return null;
  }
  if (notification.method === "turn/usage/updated") {
    state.usage = mergeUsage(state.usage, params);
    return null;
  }
  if (notification.method === "turn/completed") {
    const turn = record(params.turn) ?? {};
    const status = text(turn.status);
    if (status === "interrupted") return { type: "run.cancelled" };
    if (status === "failed") {
      const error = record(turn.error);
      const code = text(error?.codexErrorInfo) ?? "provider_error";
      const message = text(error?.message) ?? "Codex turn failed";
      return { type: "run.failed", errorCode: code, message: message.slice(0, 512) };
    }
    if (status === "completed") {
      return {
        type: "run.completed",
        result: parseResult(state.lastMessage, turn.result),
        ...(state.usage === undefined ? {} : { usage: state.usage }),
      };
    }
    return null;
  }
  if (notification.method === "turn/failed") {
    const error = record(params.error) ?? params;
    return {
      type: "run.failed",
      errorCode: text(error.code) ?? "provider_error",
      message: (text(error.message) ?? "Codex app-server reported an error").slice(0, 512),
    };
  }
  if (notification.method === "error") {
    // Codex 0.159.2+ sets willRetry=true for a transient sampling failure and
    // keeps retrying the same turn; only willRetry=false is terminal.
    if (params.willRetry === true) return null;
    const error = record(params.error) ?? params;
    return {
      type: "run.failed",
      errorCode: text(error.code) ?? "provider_error",
      message: (text(error.message) ?? "Codex app-server reported an error").slice(0, 512),
    };
  }
  return null;
}

function mergeUsage(base: unknown, next: unknown): unknown {
  if (typeof base === "number" && typeof next === "number") return base + next;
  if (Array.isArray(base) && Array.isArray(next)) return [...base, ...next];
  const baseRecord = record(base);
  const nextRecord = record(next);
  if (baseRecord && nextRecord) {
    const merged: Record<string, unknown> = { ...baseRecord };
    for (const [key, value] of Object.entries(nextRecord)) {
      merged[key] = key in baseRecord ? mergeUsage(baseRecord[key], value) : value;
    }
    return merged;
  }
  return next;
}

function hasQueuedTurn(value: unknown): boolean {
  const response = record(value);
  if (!response || !Array.isArray(response.data)) {
    throw Object.assign(new Error("Codex app-server queue response is invalid"), { code: "provider_protocol_error" });
  }
  return response.data.length > 0 || (typeof response.nextCursor === "string" && response.nextCursor.length > 0);
}

function isActiveThread(value: unknown): boolean {
  const response = record(value);
  const thread = record(response?.thread);
  const status = record(thread?.status);
  const type = text(status?.type);
  if (!type) {
    throw Object.assign(new Error("Codex app-server thread response is invalid"), { code: "provider_protocol_error" });
  }
  return type === "active";
}

async function isThreadQuiescent(client: CodexAppServerClient, threadId: string): Promise<boolean> {
  const [queue, read] = await Promise.all([
    client.request("thread/queue/list", { threadId, limit: 1 }),
    client.request("thread/read", { threadId }),
  ]);
  return !hasQueuedTurn(queue) && !isActiveThread(read);
}

function serverRequestResponse(notification: CodexAppServerNotification): {
  result?: unknown;
  error?: CodexAppServerResponseError;
} {
  switch (notification.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { result: { decision: "decline" } };
    case "item/permissions/requestApproval":
      return { result: { permissions: { fileSystem: null, network: null }, scope: "turn" } };
    case "applyPatchApproval":
      return { result: { decision: { denied: { rejection: "HumanThread Desktop does not support interactive patch approval" } } } };
    case "item/tool/requestUserInput":
      return { result: { answers: {} } };
    case "mcpServer/elicitation/request":
      return { result: { action: "decline" } };
    case "item/tool/call":
      return { result: { success: false, contentItems: [{ type: "inputText", text: "Dynamic Codex tools are unavailable in Local Agent" }] } };
    default:
      return {
        error: {
          code: -32601,
          message: "HumanThread Desktop does not support this Codex app-server request",
        },
      };
  }
}

class NotificationQueue {
  private readonly values: CodexAppServerNotification[] = [];
  private readonly waiters: Array<(value: CodexAppServerNotification) => void> = [];

  push(value: CodexAppServerNotification): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  next(signal?: AbortSignal): Promise<CodexAppServerNotification> {
    const value = this.values.shift();
    if (value) return Promise.resolve(value);
    if (signal?.aborted) return Promise.reject(Object.assign(new Error("Codex turn was cancelled"), { code: "cancelled" }));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(Object.assign(new Error("Codex turn was cancelled"), { code: "cancelled" }));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const waiter = (notification: CodexAppServerNotification) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(notification);
      };
      this.waiters.push(waiter);
    });
  }

  drain(): CodexAppServerNotification[] {
    return this.values.splice(0, this.values.length);
  }

}

export function createCodexAppServerAdapter(dependencies: {
  client: CodexAppServerClient;
  resolveNativePath: NativeWorkspacePathResolver;
  readSchema?: SchemaReader;
  executable?: string;
  environmentRefs?: string[];
  onSessionBinding?: (binding: CodexSessionBinding) => void | Promise<void>;
  onSessionEnd?: (binding: CodexSessionBinding) => void | Promise<void>;
}): AgentProviderAdapter {
  const bindings = new Map<string, string>();
  let activeThreadId: string | undefined;
  let activeTurnId: string | undefined;
  let cancelPromise: Promise<void> | null = null;

  async function resolveInput(input: AdapterInput, structured: boolean): Promise<{
    cwd: string;
    resultSchema?: unknown;
    model?: string;
    effort: ReasoningEffort;
  }> {
    const cwd = await assertPathInsideWorkspace({
      workspaceRoot: input.cwd,
      requestedPath: input.cwd,
      resolveNativePath: dependencies.resolveNativePath,
    });
    const resultSchemaPath = await assertPathInsideWorkspace({
      workspaceRoot: cwd,
      requestedPath: input.resultSchemaPath,
      resolveNativePath: dependencies.resolveNativePath,
    });
    const model = validateModel(input.model, input.credentialContext !== undefined && input.credentialContext !== null);
    const effort = validateEffort(input.reasoningEffort);
    if (!structured) return { cwd, effort, ...(model === undefined ? {} : { model }) };
    if (!dependencies.readSchema) throw Object.assign(new Error("Codex app-server schema reader is unavailable"), { code: "provider_schema_error" });
    const raw = await dependencies.readSchema(cwd, resultSchemaPath);
    if (raw === null || raw === undefined) throw Object.assign(new Error("Codex app-server output schema is unavailable"), { code: "provider_schema_error" });
    let schema: unknown = raw;
    if (typeof raw === "string") {
      try { schema = JSON.parse(raw); } catch { throw Object.assign(new Error("Codex app-server output schema is invalid"), { code: "provider_schema_error" }); }
    }
    return {
      cwd,
      effort,
      ...(model === undefined ? {} : { model }),
      resultSchema: projectCodexStructuredOutputSchema(schema),
    };
  }

  async function* run(input: AdapterInput | ResumeInput, mode: "start" | "resume", structured: boolean): AsyncIterable<NormalizedRunEvent> {
    const resolved = await resolveInput(input, structured);
    if (input.signal?.aborted) return;
    const modelProvider = input.environmentOverrides?.OPENAI_BASE_URL ? "humanthread_local" : undefined;
    const currentBinding = await bindingFingerprint(input);
    let threadId: string | undefined;
    let legacyReadOnlyResume = false;
    if (mode === "resume") {
      const resumeInput = input as ResumeInput;
      const previousBinding = bindings.get(resumeInput.providerSessionId);
      if (
        (resumeInput.providerBindingFingerprint !== undefined && resumeInput.providerBindingFingerprint !== currentBinding)
        || (resumeInput.providerBindingFingerprint === undefined && previousBinding === undefined)
        || (previousBinding !== undefined && previousBinding !== currentBinding)
      ) {
        throw Object.assign(new Error("Codex app-server resume binding does not match the selected local model"), { code: "provider_resume_binding_mismatch" });
      }
      if (
        resumeInput.providerTransport !== undefined
        && resumeInput.providerTransport !== "codex_app_server"
        && resumeInput.providerTransport !== "codex_cli"
      ) {
        throw Object.assign(new Error("Codex app-server resume transport does not match the checkpoint"), { code: "provider_resume_transport_mismatch" });
      }
      // A checkpoint written by the retired CLI transport cannot launch a new
      // CLI turn. It can still be inspected through a read-only app-server
      // resume so the user keeps the historical thread instead of losing it.
      legacyReadOnlyResume = resumeInput.providerTransport === "codex_cli";
      threadId = resumeInput.providerSessionId;
    }
    const serverState = await dependencies.client.start({
      cwd: resolved.cwd,
      ...(resolved.model === undefined ? {} : { model: resolved.model }),
      reasoningEffort: resolved.effort,
      ...(dependencies.executable ? { executable: dependencies.executable } : {}),
      ...(dependencies.environmentRefs ? { environmentRefs: dependencies.environmentRefs } : {}),
      ...(input.environmentOverrides ? { environmentOverrides: input.environmentOverrides } : {}),
      ...(input.credentialContext === undefined ? {} : { credentialContext: input.credentialContext }),
      ...(input.isolationContext === undefined ? {} : { isolationContext: input.isolationContext }),
      ...(input.checklistMcp === undefined ? {} : { checklistMcp: input.checklistMcp }),
    });
    assertSupportedCodexVersion(serverState.protocolVersion ?? null);
    if (mode === "resume") {
      const resumeInput = input as ResumeInput;
      if (resumeInput.providerGeneration !== undefined && resumeInput.providerGeneration !== serverState.generation) {
        throw Object.assign(new Error("Codex app-server resume generation does not match the checkpoint"), { code: "provider_resume_generation_mismatch" });
      }
    }
    if (mode === "resume") {
      await dependencies.client.request("thread/resume", {
        threadId,
        cwd: resolved.cwd,
        ...(resolved.model === undefined ? {} : { model: resolved.model }),
        ...(modelProvider ? { modelProvider } : {}),
        sandbox: legacyReadOnlyResume ? "read-only" : sandboxMode(input.executionPolicy),
        approvalPolicy: legacyReadOnlyResume
          ? "on-request"
          : input.executionPolicy.mode === "workspace_full" ? "never" : "on-request",
      });
    } else {
      const response = await dependencies.client.request("thread/start", {
        cwd: resolved.cwd,
        ...(resolved.model === undefined ? {} : { model: resolved.model }),
        ...(modelProvider ? { modelProvider } : {}),
        sandbox: sandboxMode(input.executionPolicy),
        approvalPolicy: input.executionPolicy.mode === "workspace_full" ? "never" : "on-request",
      });
      threadId = extractThreadId(response);
    }
    if (threadId === undefined) {
      throw Object.assign(new Error("Codex app-server thread response is invalid"), { code: "provider_protocol_error" });
    }
    const state = { lastMessage: null as string | null, usage: undefined as unknown };
    bindings.set(threadId, currentBinding);
    activeThreadId = threadId;
    const queue = new NotificationQueue();
    const unsubscribe = await dependencies.client.subscribe((notification) => {
      const params = record(notification.params);
      const notificationThreadId = text(params?.threadId);
      // A daemon is shared by every AgentRun bound to the same credential.
      // Never let another thread's turn, item, usage or approval events leak
      // into this run's result.
      if (notificationThreadId !== null && notificationThreadId !== threadId) return;
      // Turn-scoped notifications must name a thread. Without one we cannot
      // attribute the event on a shared daemon, so fail closed rather than
      // risk cross-run contamination.
      if (notificationThreadId === null && isThreadScopedNotification(notification.method)) return;
      queue.push(notification);
    });
    const sessionBinding: CodexSessionBinding = {
      runId: runIdForInput(input),
      processKey: dependencies.client.processKey,
      threadId,
      turnId: null,
      generation: serverState.generation,
      bindingFingerprint: currentBinding,
      cwd: resolved.cwd,
      model: resolved.model ?? null,
    };
    try {
      const turnResponse = await dependencies.client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt }],
        cwd: resolved.cwd,
        ...(resolved.model === undefined ? {} : { model: resolved.model }),
        effort: resolved.effort,
        ...(resolved.resultSchema === undefined ? {} : { outputSchema: resolved.resultSchema }),
      });
      activeTurnId = extractTurnId(turnResponse);
      sessionBinding.turnId = activeTurnId ?? null;
      await dependencies.onSessionBinding?.(sessionBinding);
      yield {
        type: "run.started",
        providerSessionId: threadId,
        providerBindingFingerprint: currentBinding,
        providerTransport: "codex_app_server",
        providerGeneration: serverState.generation,
        ...(activeTurnId ? { providerTurnId: activeTurnId } : {}),
      };
      while (true) {
        const notification = await queue.next(input.signal);
        if (notification.method === "turn/started") {
          const params = record(notification.params);
          const turn = record(params?.turn);
          const startedTurnId = text(turn?.id);
          if (startedTurnId) {
            activeTurnId = startedTurnId;
            sessionBinding.turnId = startedTurnId;
          }
        }
        const event = notificationEvent(notification, state);
        if (notification.requestId !== undefined && notification.requestId !== null) {
          const response = serverRequestResponse(notification);
          await dependencies.client.respond(notification.requestId, response.result, response.error);
        }
        if (!event) continue;
        if (event.type === "run.completed") {
          // Drain events that already arrived for a queued TUI turn before
          // deciding whether the thread is still active or quiet.
          for (const pending of queue.drain()) {
            if (pending.method === "thread/tokenUsage/updated") {
              const pendingParams = record(pending.params);
              const pendingUsage = record(pendingParams?.tokenUsage);
              if (pendingUsage?.total) state.usage = pendingUsage.total;
            }
            if (pending.method === "item/completed") {
              const item = record(record(pending.params)?.item);
              if (item?.type === "agentMessage" && typeof item.text === "string") {
                state.lastMessage = item.text;
              }
            }
          }
          // Queued TUI turns may not have emitted a notification yet. Poll
          // quiescence for a bounded window before declaring the run final.
          const quiescence = await waitForThreadQuiescence(dependencies.client, threadId, state, queue);
          if (quiescence === "timeout") {
            yield {
              type: "run.failed",
              errorCode: "provider_quiescence_timeout",
              message: "Codex thread did not become quiescent before the run deadline",
            };
            return;
          }
          yield {
            type: "run.completed",
            result: parseResult(state.lastMessage, record(record(notification.params)?.turn)?.result),
            ...(state.usage === undefined ? {} : { usage: state.usage }),
          };
          return;
        }
        yield event;
        if (event.type === "run.failed" || event.type === "run.cancelled") return;
      }
    } catch (error) {
      const failure = providerError(error);
      if (failure.code === "cancelled" || input.signal?.aborted) {
        if (!cancelPromise) cancelPromise = dependencies.client.cancel(threadId, activeTurnId).catch(() => undefined);
        await cancelPromise;
        yield { type: "run.cancelled" };
      } else if (failure.code === "provider_resume_binding_mismatch") {
        throw error;
      } else {
        yield { type: "run.failed", errorCode: failure.code, message: failure.message };
      }
    } finally {
      unsubscribe();
      try {
        await dependencies.onSessionEnd?.(sessionBinding);
      } catch {
        // Local session cleanup cannot mask the provider result.
      }
      cancelPromise = null;
      if (activeThreadId === threadId) {
        activeThreadId = undefined;
        activeTurnId = undefined;
      }
    }
  }

  return {
    capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
    projectStructuredOutputSchema: projectCodexStructuredOutputSchema,
    executeStructured(input) {
      const executionPolicy = input.mode === "router"
        ? { mode: "read_only" as const, workspaceRealpath: input.executionPolicy.workspaceRealpath }
        : input.executionPolicy;
      return run({ ...input, executionPolicy }, input.providerSessionId ? "resume" : "start", true);
    },
    start(input) {
      return run(input, "start", true);
    },
    resume(input) {
      return run(input, "resume", true);
    },
    async cancel() {
      if (!activeThreadId) return;
      if (!cancelPromise) cancelPromise = dependencies.client.cancel(activeThreadId, activeTurnId).catch(() => undefined);
      await cancelPromise;
      cancelPromise = null;
    },
  };
}

export async function waitForThreadQuiescence(
  client: CodexAppServerClient,
  threadId: string,
  state: { lastMessage: string | null; usage: unknown },
  queue: NotificationQueue,
  timeoutMs = 30_000,
  intervalMs = 250,
): Promise<"quiet" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveQuiet = 0;
  while (Date.now() < deadline) {
    const quiet = await isThreadQuiescent(client, threadId);
    let sawTerminalEvent = false;
    for (const pending of queue.drain()) {
      const event = notificationEvent(pending, state);
      if (event?.type === "run.completed") sawTerminalEvent = true;
    }
    if (!quiet || sawTerminalEvent) {
      consecutiveQuiet = 0;
    } else {
      consecutiveQuiet += 1;
      // Two consecutive quiet reads with no intervening terminal event guard
      // against the queued-turn race right after the first turn completes.
      if (consecutiveQuiet >= 2) return "quiet";
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return "timeout";
}
