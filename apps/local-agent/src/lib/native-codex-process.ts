import type {
  ProviderProcess,
  ProviderSpawn,
  StructuredProviderExecutionInput,
} from "./providers/provider-adapter";

export type NativeCodexOutput = {
  processKey: string;
  processId: number;
  stream: "stdout" | "stderr";
  chunk: string;
};

type NativeCodexExit = {
  processKey: string;
  processId: number;
  code: number | null;
  signal: string | null;
};

type NativeCodexInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const INDEPENDENT_CREDENTIAL_ENVIRONMENT_REFS = new Set([
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
]);

export type NativeCodexEventListener = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

class AsyncChunkQueue implements AsyncIterable<string> {
  private values: string[] = [];
  private waiting: Array<(value: IteratorResult<string>) => void> = [];
  private ended = false;

  push(value: string): void {
    const resolve = this.waiting.shift();
    if (resolve) resolve({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    this.ended = true;
    for (const resolve of this.waiting.splice(0)) resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.ended) return { done: true, value: undefined };
        return new Promise<IteratorResult<string>>((resolve) => this.waiting.push(resolve));
      },
    };
  }
}

function isOutput(value: unknown): value is NativeCodexOutput {
  if (!value || typeof value !== "object") return false;
  return typeof Reflect.get(value, "processKey") === "string"
    && typeof Reflect.get(value, "processId") === "number"
    && (Reflect.get(value, "stream") === "stdout" || Reflect.get(value, "stream") === "stderr")
    && typeof Reflect.get(value, "chunk") === "string";
}

function isExit(value: unknown): value is NativeCodexExit {
  if (!value || typeof value !== "object") return false;
  return typeof Reflect.get(value, "processKey") === "string"
    && typeof Reflect.get(value, "processId") === "number"
    && (typeof Reflect.get(value, "code") === "number" || Reflect.get(value, "code") === null)
    && (typeof Reflect.get(value, "signal") === "string" || Reflect.get(value, "signal") === null);
}

function nativeStartErrorMessage(error: unknown): string {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : error && typeof error === "object" && typeof Reflect.get(error, "message") === "string"
        ? String(Reflect.get(error, "message"))
        : "Failed to start Codex";
  return message.trim().slice(0, 512) || "Failed to start Codex";
}

export function createNativeCodexSpawn(dependencies: {
  invoke: NativeCodexInvoke;
  listen: NativeCodexEventListener;
  onOutput?: (output: NativeCodexOutput) => void;
  executable?: string;
  environmentRefs?: string[];
  credentialContext?: StructuredProviderExecutionInput["credentialContext"];
  environmentOverrides?: Record<string, string>;
  createProcessKey?: () => string;
}): ProviderSpawn {
  return (command, args, options): ProviderProcess => {
    if (command !== "codex") throw new Error("Only Codex may use the native provider bridge");
    const processKey = dependencies.createProcessKey?.()
      ?? `codex:${crypto.randomUUID()}`;
    const stdout = new AsyncChunkQueue();
    const stderr = new AsyncChunkQueue();
    let processId: number | null = null;
    let cancelRequested = false;
    let settled = false;
    const cleanup: Array<() => void> = [];
    let resolveExit: (exit: { code: number | null; signal: string | null }) => void;
    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      resolveExit = resolve;
    });

    const finish = (exit: { code: number | null; signal: string | null }) => {
      if (settled) return;
      settled = true;
      stdout.end();
      stderr.end();
      for (const unlisten of cleanup.splice(0)) unlisten();
      options.signal?.removeEventListener("abort", cancel);
      resolveExit(exit);
    };

    const cancel = () => {
      cancelRequested = true;
      if (processId !== null) {
        void dependencies.invoke("cancel_codex_process", { processId });
      }
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();

    void Promise.all([
      dependencies.listen<NativeCodexOutput>("codex_process_output", ({ payload }) => {
        if (!isOutput(payload) || payload.processKey !== processKey) return;
        try {
          dependencies.onOutput?.(payload);
        } catch {
          // Log observers are isolated from the provider stream.
        }
        (payload.stream === "stdout" ? stdout : stderr).push(payload.chunk);
      }),
      dependencies.listen<NativeCodexExit>("codex_process_exit", ({ payload }) => {
        if (!isExit(payload) || payload.processKey !== processKey) return;
        finish({ code: payload.code, signal: payload.signal });
      }),
    ]).then((unlisteners) => {
      cleanup.push(...unlisteners);
      const credentialContext = options.credentialContext !== undefined
        ? options.credentialContext
        : dependencies.credentialContext;
      return dependencies.invoke("start_codex_process", {
        processKey,
        cwd: options.cwd,
        executable: dependencies.executable ?? "codex",
        args,
        environmentRefs: credentialContext
          ? (dependencies.environmentRefs ?? []).filter(
            (key) => !INDEPENDENT_CREDENTIAL_ENVIRONMENT_REFS.has(key),
          )
          : dependencies.environmentRefs ?? [],
        ...(options.environmentOverrides ? { environmentOverrides: options.environmentOverrides } : {}),
        ...(credentialContext !== undefined
          ? { credentialContext }
          : {}),
      });
    }).then(async (value) => {
      if (typeof value !== "number") throw new Error("Native Codex process ID is invalid");
      processId = value;
      if (cancelRequested) {
        await dependencies.invoke("cancel_codex_process", { processId });
      }
    }).catch((error: unknown) => {
      stderr.push(`${nativeStartErrorMessage(error)}\n`);
      finish({ code: null, signal: "spawn_failed" });
    });

    return {
      stdout,
      stderr,
      wait: () => exitPromise,
      cancel,
    };
  };
}
