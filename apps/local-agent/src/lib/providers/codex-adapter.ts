import type {
  AgentProviderAdapter,
  NormalizedRunEvent,
  ProviderProcess,
  ProviderSpawn,
  StructuredProviderExecutionInput,
} from "./provider-adapter";
import { DEFAULT_REASONING_EFFORT, reasoningEffortSchema, type ReasoningEffort } from "@humanthread/shared";
import {
  assertPathInsideWorkspace,
  type CodexExecutionPolicy,
  type NativeWorkspacePathResolver,
} from "../workspace-policy";
import { projectCodexStructuredOutputSchema } from "./codex-schema";

function codexExecutionArgs(cwd: string, policy: CodexExecutionPolicy): string[] {
  if (policy.workspaceRealpath !== cwd) {
    throw Object.assign(
      new Error("Codex execution root must match the resolved project Workspace"),
      { code: "workspace_scope_denied" },
    );
  }
  return policy.mode === "workspace_full"
    ? ["--dangerously-bypass-approvals-and-sandbox"]
    : ["--sandbox", "read-only"];
}

function modelArgs(model: string | undefined): string[] {
  if (model === undefined) return [];
  const normalized = model.trim();
  if (!normalized || /[\u0000-\u001F\u007F]/u.test(normalized) || normalized.length > 512) {
    throw Object.assign(new Error("Selected model is invalid"), { code: "local_model_invalid" });
  }
  return ["--model", normalized];
}

function reasoningEffortArgs(value: ReasoningEffort | undefined): string[] {
  const parsed = reasoningEffortSchema.safeParse(value === undefined ? DEFAULT_REASONING_EFFORT : value);
  if (!parsed.success) {
    throw Object.assign(new Error("Selected reasoning effort is invalid"), { code: "reasoning_effort_invalid" });
  }
  return ["--config", `model_reasoning_effort=${JSON.stringify(parsed.data)}`];
}

function modelAndReasoningArgs(model: string | undefined, reasoningEffort: ReasoningEffort | undefined): string[] {
  return [...modelArgs(model), ...reasoningEffortArgs(reasoningEffort)];
}

function localModelProviderArgs(environmentOverrides: Record<string, string> | undefined): string[] {
  const baseUrl = environmentOverrides?.OPENAI_BASE_URL;
  if (baseUrl === undefined) return [];
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw Object.assign(new Error("Selected model site URL is invalid"), { code: "local_model_invalid" });
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw Object.assign(new Error("Selected model site URL is invalid"), { code: "local_model_invalid" });
  }
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

function normalizeCodexEvent(
  event: Record<string, unknown>,
  lastStructuredMessage: unknown,
): NormalizedRunEvent | null {
  if (event.type === "thread.started") return { type: "run.started", ...(typeof event.thread_id === "string" ? { providerSessionId: event.thread_id } : {}) };
  if (event.type === "item.completed" && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    if (item.type === "agent_message") return { type: "agent.message.completed", text: typeof item.text === "string" ? item.text : "" };
    if (typeof item.type === "string" && item.type.includes("tool")) return { type: "tool.completed", tool: item.type, payload: item };
  }
  if (event.type === "turn.completed") return {
    type: "run.completed",
    result: event.result ?? lastStructuredMessage ?? {},
    ...(event.usage === undefined ? {} : { usage: event.usage }),
  };
  if (event.type === "turn.failed") {
    const nestedError = event.error && typeof event.error === "object"
      ? Reflect.get(event.error, "message")
      : undefined;
    const message = typeof event.message === "string"
      ? event.message
      : typeof nestedError === "string"
        ? nestedError
        : "Codex turn failed";
    return { type: "run.failed", errorCode: "provider_error", message: message.slice(0, 512) };
  }
  return null;
}

async function* consumeProcess(process: ProviderProcess): AsyncIterable<NormalizedRunEvent> {
  let lastStructuredMessage: unknown;
  try {
    for await (const chunk of process.stdout) {
      for (const line of chunk.split("\n").filter(Boolean)) {
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { yield { type: "run.failed", errorCode: "provider_protocol_error", message: "Codex emitted malformed JSONL" }; process.cancel(); return; }
        if (!parsed || typeof parsed !== "object") continue;
        const record = parsed as Record<string, unknown>;
        if (record.type === "item.completed" && record.item && typeof record.item === "object") {
          const item = record.item as Record<string, unknown>;
          if (item.type === "agent_message" && typeof item.text === "string") {
            try { lastStructuredMessage = JSON.parse(item.text); } catch { lastStructuredMessage = undefined; }
          }
        }
        const event = normalizeCodexEvent(record, lastStructuredMessage);
        if (event) yield event;
      }
    }
    let stderrText = "";
    for await (const chunk of process.stderr) {
      if (stderrText.length < 4_096) stderrText += chunk.slice(0, 4_096 - stderrText.length);
    }
    const exit = await process.wait();
    if (exit.code !== 0) {
      const stderrMessage = stderrText.replace(/\s+/gu, " ").trim().slice(0, 512);
      const message = exit.signal === "spawn_failed"
        ? stderrMessage || "Codex failed to start"
        : exit.code === null
          ? `Codex exited due to ${exit.signal ?? "an unknown signal"}`
          : `Codex exited with code ${exit.code}`;
      yield { type: "run.failed", errorCode: "provider_error", message };
    }
  } catch (error) {
    yield { type: "run.failed", errorCode: "provider_error", message: error instanceof Error ? error.message.slice(0, 512) : "Codex process failed" };
  }
}

export function createCodexAdapter(dependencies: {
  spawn: ProviderSpawn;
  resolveNativePath: NativeWorkspacePathResolver;
}): AgentProviderAdapter {
  let activeProcess: ProviderProcess | null = null;

  async function* startResolvedProcess(input: {
    cwd: string;
    resultSchemaPath: string;
    executionPolicy: CodexExecutionPolicy;
    signal?: AbortSignal;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    environmentOverrides?: Record<string, string>;
    credentialContext?: StructuredProviderExecutionInput["credentialContext"];
    buildArgs: (sandboxArgs: string[], resultSchemaPath: string) => string[];
  }): AsyncIterable<NormalizedRunEvent> {
    if (input.signal?.aborted) return;
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
    if (input.signal?.aborted) return;
    const hasCredentialOverride = input.credentialContext !== undefined;
    activeProcess = dependencies.spawn(
      "codex",
      input.buildArgs(codexExecutionArgs(cwd, input.executionPolicy), resultSchemaPath),
      {
        cwd,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.environmentOverrides ? { environmentOverrides: input.environmentOverrides } : {}),
        ...(hasCredentialOverride ? { credentialContext: input.credentialContext } : {}),
      },
    );
    yield* consumeProcess(activeProcess);
  }

  return {
    capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
    projectStructuredOutputSchema: projectCodexStructuredOutputSchema,
    executeStructured(input: StructuredProviderExecutionInput) {
      const executionPolicy = input.mode === "router"
        ? { mode: "read_only" as const, workspaceRealpath: input.executionPolicy.workspaceRealpath }
        : input.executionPolicy;
      return startResolvedProcess({
        ...input,
        executionPolicy,
        buildArgs: (sandboxArgs, resultSchemaPath) => input.providerSessionId
          ? ["exec", ...localModelProviderArgs(input.environmentOverrides), ...sandboxArgs, "resume", input.providerSessionId, "--json", ...modelAndReasoningArgs(input.model, input.reasoningEffort), "--output-schema", resultSchemaPath, input.prompt]
          : ["exec", ...localModelProviderArgs(input.environmentOverrides), "--json", ...sandboxArgs, ...modelAndReasoningArgs(input.model, input.reasoningEffort), "--output-schema", resultSchemaPath, input.prompt],
      });
    },
    start(input) {
      return startResolvedProcess({
        ...input,
        buildArgs: (sandboxArgs, resultSchemaPath) => ["exec", ...localModelProviderArgs(input.environmentOverrides), "--json", ...sandboxArgs, ...modelAndReasoningArgs(input.model, input.reasoningEffort), "--output-schema", resultSchemaPath, input.prompt],
      });
    },
    resume(input) {
      return startResolvedProcess({
        ...input,
        buildArgs: (sandboxArgs, resultSchemaPath) => ["exec", ...localModelProviderArgs(input.environmentOverrides), ...sandboxArgs, "resume", input.providerSessionId, "--json", ...modelAndReasoningArgs(input.model, input.reasoningEffort), "--output-schema", resultSchemaPath, input.prompt],
      });
    },
    async cancel() { activeProcess?.cancel(); activeProcess = null; },
  };
}
