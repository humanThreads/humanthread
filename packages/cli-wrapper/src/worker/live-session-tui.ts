import type { LiveSessionJournal } from "@humanthread/live-session-journal";

import type { WorkerLiveSessionConnector } from "./live-session-connector";

export interface WorkerCodexProcessHost {
  endpoint(): string | null;
  request(method: string, params?: unknown): Promise<unknown>;
  subscribe?(listener: (message: { method: string; params: unknown }) => void): () => void;
}

export interface WorkerTuiProcess {
  handle: string;
  threadId: string;
  cwd: string;
  kill(): Promise<void>;
  exit: Promise<void>;
}

export interface WorkerTuiExit {
  handle: string;
  exitCode: number | null;
  /** Tail of captured PTY output, used to surface why a TUI stopped. */
  tail: string;
}

export interface WorkerTuiHost {
  spawn(input: {
    handle: string;
    threadId: string;
    cwd: string;
    onOutput(bytes: Uint8Array): void | Promise<void>;
    onExit(info: { handle: string; exitCode: number | null }): void | Promise<void>;
  }): Promise<WorkerTuiProcess>;
  write(input: { handle: string; bytes: Uint8Array }): Promise<void>;
  resize(input: { handle: string; rows: number; cols: number }): Promise<void>;
}

export interface WorkerTuiSession {
  sessionId: string;
  start(input: { threadId: string; cwd: string }): Promise<void>;
  handleInput(bytes: Uint8Array): Promise<void>;
  resize(size: { rows: number; cols: number }): Promise<void>;
  wait(): Promise<void>;
  stop(): Promise<void>;
  state(): "detached" | "running" | "interrupted";
  journalState(): ReturnType<LiveSessionJournal["state"]>;
}

function tuiError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/**
 * Retired approval flag, kept as a named tripwire.
 *
 * Codex 0.159.2 rejects `--dangerously-bypass-approvals-and-sandbox` on
 * `resume <thread> --remote <endpoint>` with "Permission overrides are not
 * supported when resuming a remote task.", aborting before the TUI paints.
 * The execution authority is the app-server session the Worker starts, whose
 * `thread/start` already carries `approvalPolicy: "never"` and
 * `sandbox: "danger-full-access"`; the TUI only mirrors that session.
 * Re-adding this flag here would silently break every remote attach.
 */
export const WORKER_TUI_NO_APPROVAL_ARGUMENT = "--dangerously-bypass-approvals-and-sandbox";

export function buildWorkerCodexTuiCommand(input: {
  executable: string;
  attachMode: "resume" | "remote";
  threadId: string;
  endpoint: string;
  cwd?: string;
  modelArguments?: readonly string[];
  providerArguments?: readonly string[];
}): string[] {
  const prefix = input.attachMode === "resume" && input.threadId.trim()
    ? [input.executable, "resume", input.threadId, "--remote", input.endpoint]
    : [input.executable, "--remote", input.endpoint];
  return [
    ...prefix,
    // Codex 0.159 requires an explicit workspace for a remote resume; without
    // it the TUI aborts before painting and the terminal stays blank.
    ...(input.cwd?.trim() ? ["--cd", input.cwd.trim()] : []),
    ...(input.modelArguments ?? []),
    ...(input.providerArguments ?? []),
  ];
}

/**
 * Bridges one leased Worker Loop attempt to the public relay without making
 * terminal bytes an execution authority. The app-server result remains the
 * source of truth; this host only mirrors the PTY surface.
 */
export function createWorkerTuiSession(input: {
  sessionId: string;
  journal: LiveSessionJournal;
  connector: WorkerLiveSessionConnector;
  host: WorkerTuiHost;
  processHandlePrefix?: string;
  onOutputError?: (error: unknown) => void;
  onExit?: (info: WorkerTuiExit) => void;
  onRetry?: (info: { attempt: number; exitCode: number | null; tail: string }) => void;
  /**
   * A thread opened through the app-server only persists its rollout once the
   * first turn starts. A TUI that attaches before then exits immediately, so an
   * early exit is retried inside this window instead of blanking the terminal.
   */
  retry?: { stabilizeMs: number; retryDelayMs: number; maxAttempts: number };
}): WorkerTuiSession {
  if (!/^[a-f0-9]{32}$/u.test(input.sessionId)) throw tuiError("live_session_invalid", "Worker TUI session id is invalid");
  const retryPolicy = input.retry ?? { stabilizeMs: 10_000, retryDelayMs: 750, maxAttempts: 20 };
  let status: ReturnType<WorkerTuiSession["state"]> = "detached";
  let process: WorkerTuiProcess | null = null;
  let exited: Promise<void> | null = null;
  let attempts = 0;
  let binding: { threadId: string; cwd: string } | null = null;
  // The viewer usually reports its geometry before the PTY exists. Remembering
  // it makes the first paint match the viewer instead of the launch default.
  let pendingSize: { rows: number; cols: number } | null = null;
  // Resolves when the session reaches a terminal state. A PTY exit during a
  // pending retry must not end `wait()`, or the caller tears the session down
  // while it is still relaunching.
  let finish: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  // A bounded tail of PTY output is retained so an unexpected exit can be
  // explained to operators instead of leaving a silent black terminal.
  let tail = "";
  let launchedAt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const onOutput = async (bytes: Uint8Array): Promise<void> => {
    tail = `${tail}${Buffer.from(bytes).toString("utf8")}`.slice(-4_096);
    // Journaling first keeps a relay outage from losing terminal history.
    // A publish failure must never escape this callback: it runs on the
    // app-server notification path, where a rejection has no catcher and would
    // take down the whole worker process.
    await input.journal.append(input.sessionId, bytes);
    try {
      await input.connector.publish(bytes);
    } catch (error) {
      input.onOutputError?.(error);
    }
  };

  // Retry is deliberate and bounded: a persistently failing TUI must surface as
  // an interrupted session rather than an infinite relaunch loop.
  const launch = async (): Promise<void> => {
    if (status === "detached" || !binding) return;
    const spawned = await input.host.spawn({
      handle: `${input.processHandlePrefix ?? "worker-tui"}:${input.sessionId}`,
      threadId: binding.threadId,
      cwd: binding.cwd,
      onOutput,
      onExit: (info) => {
        process = null;
        const diedDuringStartup = Date.now() - launchedAt < retryPolicy.stabilizeMs;
        if (status === "detached" || !diedDuringStartup || attempts >= retryPolicy.maxAttempts) {
          // Terminal exit: report it once, with the output tail that explains
          // why the terminal stopped.
          input.onExit?.({ handle: info.handle, exitCode: info.exitCode, tail });
          if (status !== "detached") status = "interrupted";
          finish?.();
          finish = null;
          return;
        }
        attempts += 1;
        input.onRetry?.({ attempt: attempts, exitCode: info.exitCode, tail });
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void launch().catch((error: unknown) => input.onOutputError?.(error));
        }, retryPolicy.retryDelayMs);
        retryTimer.unref?.();
      },
    });
    process = spawned;
    exited = spawned.exit;
    launchedAt = Date.now();
    status = "running";
    if (pendingSize) {
      const size = pendingSize;
      pendingSize = null;
      await input.host.resize({ handle: spawned.handle, rows: size.rows, cols: size.cols }).catch((error) => {
        input.onOutputError?.(error);
      });
    }
    // A host resolves the exit promise for every PTY stop. Only treat it as the
    // end of the session when no relaunch has been scheduled for it, otherwise
    // the caller would tear the session down mid-retry.
    void spawned.exit.then(() => {
      if (status !== "running" || retryTimer || process !== spawned) return;
      status = "interrupted";
      finish?.();
      finish = null;
    });
  };

  return {
    sessionId: input.sessionId,
    async start({ threadId, cwd }) {
      if (status === "running" && process) return;
      if (!cwd.trim()) throw tuiError("provider_tui_invalid", "Worker TUI binding is incomplete");
      await input.connector.start();
      binding = { threadId, cwd };
      status = "running";
      attempts = 0;
      await launch();
    },
    async handleInput(bytes) {
      if (status !== "running" || !process) throw tuiError("provider_tui_detached", "Worker TUI session is not running");
      if (bytes.byteLength === 0 || bytes.byteLength > 256 * 1024) {
        throw tuiError("worker_backpressure", "Worker TUI input is invalid");
      }
      await input.host.write({ handle: process.handle, bytes });
    },
    async resize(size) {
      if (!Number.isSafeInteger(size.rows) || size.rows < 1 || size.rows > 500
        || !Number.isSafeInteger(size.cols) || size.cols < 1 || size.cols > 1_000) {
        throw tuiError("provider_tui_invalid", "TUI terminal size is invalid");
      }
      if (status !== "running" || !process) {
        // A viewer can attach while the TUI is still starting; the size applies
        // to the next spawn instead of failing the viewer's input path.
        pendingSize = size;
        return;
      }
      await input.host.resize({ handle: process.handle, rows: size.rows, cols: size.cols });
    },
    async wait() {
      await finished;
    },
    async stop() {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      const active = process;
      process = null;
      status = "detached";
      binding = null;
      finish?.();
      finish = null;
      await active?.kill().catch(() => undefined);
      await input.connector.close().catch(() => undefined);
    },
    state() {
      return status;
    },
    journalState() {
      return input.journal.state(input.sessionId);
    },
  };
}

export function createWorkerCodexTuiHost(input: {
  client: WorkerCodexProcessHost;
  executable?: string;
  codexHome: string;
  environment?: Record<string, string>;
  onOutputError?: (error: unknown) => void;
  onExit?: (info: WorkerTuiExit) => void;
  providerArguments?: string[];
  /**
   * The model the platform leased for this session. Codex TUI falls back to its
   * own built-in default (which is unrelated to the relay's catalogue) when no
   * model is passed, so the terminal would display and run a different model
   * than the user selected.
   */
  model?: string;
  reasoningEffort?: string;
  /**
   * `resume` reattaches the TUI to an existing provider thread, which is what a
   * Loop run needs so the user watches the agent's own thread. `remote` lets the
   * TUI own a fresh thread, which is the only option before any turn has run —
   * a taskless direct session has no persisted rollout to resume.
   */
  attachMode?: "resume" | "remote";
}): WorkerTuiHost {
  const executable = input.executable ?? "codex";
  const handles = new Set<string>();
  const outputHandlers = new Map<string, (bytes: Uint8Array) => void | Promise<void>>();
  const exitHandlers = new Map<string, (info: { handle: string; exitCode: number | null }) => void | Promise<void>>();
  const exitSignals = new Map<string, () => void>();
  const outputTails = new Map<string, string>();

  // PTY bytes only arrive as `process/outputDelta` notifications; without this
  // subscription the Relay reports an online target while the terminal stays
  // permanently blank.
  input.client.subscribe?.((message) => {
    if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)) return;
    const params = message.params as Record<string, unknown>;
    if (typeof params.processHandle !== "string") return;
    if (message.method === "process/outputDelta") {
      if (typeof params.deltaBase64 !== "string") return;
      const handler = outputHandlers.get(params.processHandle);
      if (!handler) return;
      const bytes = Buffer.from(params.deltaBase64, "base64");
      if (bytes.byteLength === 0) return;
      outputTails.set(
        params.processHandle,
        `${outputTails.get(params.processHandle) ?? ""}${bytes.toString("utf8")}`.slice(-4_096),
      );
      void Promise.resolve(handler(bytes)).catch((error) => {
        input.onOutputError?.(error);
      });
      return;
    }
    if (message.method !== "process/exited") return;
    const handle = params.processHandle;
    outputHandlers.delete(handle);
    const signal = exitSignals.get(handle);
    exitSignals.delete(handle);
    signal?.();
    const exitCode = typeof params.exitCode === "number" ? params.exitCode : null;
    const tail = outputTails.get(handle) ?? "";
    outputTails.delete(handle);
    const onExit = exitHandlers.get(handle);
    exitHandlers.delete(handle);
    input.onExit?.({ handle, exitCode, tail });
    void Promise.resolve(onExit?.({ handle, exitCode })).catch((error) => { input.onOutputError?.(error); });
  });

  return {
    async spawn({ handle, threadId, cwd, onOutput, onExit }) {
      const endpoint = input.client.endpoint();
      if (!endpoint) throw tuiError("provider_tui_unavailable", "Codex worker app-server endpoint is unavailable");
      handles.add(handle);
      let fallback: () => void = () => undefined;
      const exited = new Promise<void>((resolve) => { fallback = resolve; });
      exitSignals.set(handle, fallback);
      outputHandlers.set(handle, onOutput);
      exitHandlers.set(handle, onExit);
      // `codex resume <id> --remote <endpoint>` aborts with "no rollout found for
      // thread id" whenever the app-server has not persisted that thread yet,
      // which kills the TUI and leaves the browser on a blank terminal. The
      // session retries such an early exit, so a Loop run still ends up attached
      // to its own thread once the first turn has written the rollout.
      const attachMode = input.attachMode ?? (threadId.trim() ? "resume" : "remote");
      const modelArguments: string[] = [];
      if (input.model?.trim()) modelArguments.push("-m", input.model.trim());
      if (input.reasoningEffort?.trim()) {
        modelArguments.push("-c", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort.trim())}`);
      }
      if (!(input.providerArguments ?? []).some((argument) => argument.startsWith("model_reasoning_summary="))) {
        modelArguments.push("-c", 'model_reasoning_summary="none"');
      }
      const command = buildWorkerCodexTuiCommand({
        executable,
        attachMode,
        threadId,
        endpoint,
        cwd,
        modelArguments,
        ...(input.providerArguments ? { providerArguments: input.providerArguments } : {}),
      });
      try {
        await input.client.request("process/spawn", {
          command,
          processHandle: handle,
          cwd,
          tty: true,
          streamStdin: true,
          streamStdoutStderr: true,
          outputBytesCap: 1024 * 1024,
          timeoutMs: null,
          env: {
            CODEX_HOME: input.codexHome,
            OPENAI_API_KEY: null,
            OPENAI_BASE_URL: null,
            OPENAI_ORGANIZATION: null,
            OPENAI_PROJECT: null,
            TERM: "xterm-256color",
            ...(input.environment ?? {}),
          },
          size: { rows: 36, cols: 120 },
        });
      } catch (error) {
        handles.delete(handle);
        outputHandlers.delete(handle);
        exitHandlers.delete(handle);
        exitSignals.delete(handle);
        outputTails.delete(handle);
        throw error;
      }
      return {
        handle,
        threadId,
        cwd,
        async kill() {
          handles.delete(handle);
          outputHandlers.delete(handle);
          exitHandlers.delete(handle);
          exitSignals.delete(handle);
          outputTails.delete(handle);
          fallback();
          await input.client.request("process/kill", { processHandle: handle }).catch(() => undefined);
          await onExit({ handle, exitCode: null });
        },
        exit: exited,
      };
    },
    async write({ handle, bytes }) {
      if (!handles.has(handle)) throw tuiError("provider_tui_detached", "Worker TUI process is not running");
      await input.client.request("process/writeStdin", {
        processHandle: handle,
        deltaBase64: Buffer.from(bytes).toString("base64"),
      });
    },
    async resize({ handle, rows, cols }) {
      if (!handles.has(handle)) throw tuiError("provider_tui_detached", "Worker TUI process is not running");
      await input.client.request("process/resizePty", {
        processHandle: handle,
        size: { rows, cols },
      });
    },
  };
}
