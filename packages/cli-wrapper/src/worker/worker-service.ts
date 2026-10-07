import { readdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, relative, sep } from "node:path";
import { createServer, type Server } from "node:http";

import { LiveSessionJournal } from "@humanthread/live-session-journal";

import { createCodexAppServerClient, modelProviderArguments } from "./app-server-client";
import { createBundledModelCatalogReader } from "./model-catalog";
import { createWorkerOutbox } from "./worker-outbox";
import { createWorkerPlatformApi } from "./worker-platform-api";
import { createWorkerRuntime, type WorkerRuntime } from "./worker-runtime";
import { createWorkerWorktreeManager } from "./worker-worktree";
import { createWorkerLiveSessionConnector } from "./live-session-connector";
import { createWorkerCodexTuiHost, createWorkerTuiSession } from "./live-session-tui";

function serviceError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

const REVIEW_ARTIFACT_DIRECTORY = "generated/reviews";
const REVIEW_ARTIFACT_FILE = /\.html?$/iu;
const REVIEW_ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Collects the review pages the Agent wrote under `generated/reviews/` so the
 * Worker can upload them as platform Artifacts before reporting its result.
 * Only relative HTML paths inside that directory are read; oversized files are
 * skipped so a stray large page cannot fail the whole assignment.
 */
export async function collectWorkerReviewArtifacts(
  cwd: string,
): Promise<Array<{ relativePath: string; content: string }>> {
  const root = join(cwd, REVIEW_ARTIFACT_DIRECTORY);
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  const collected: Array<{ relativePath: string; content: string }> = [];
  for (const entry of entries.sort()) {
    const normalized = entry.split(sep).join("/");
    if (!normalized || !REVIEW_ARTIFACT_FILE.test(normalized)) continue;
    const relativePath = `${REVIEW_ARTIFACT_DIRECTORY}/${normalized}`;
    try {
      const content = await readFile(join(root, entry), "utf8");
      if (!content.trim() || Buffer.byteLength(content, "utf8") > REVIEW_ARTIFACT_MAX_BYTES) continue;
      collected.push({ relativePath, content });
    } catch {
      // An unreadable review page must not fail the assignment; the platform
      // simply receives no Artifact reference for it.
    }
  }
  return collected;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 128) {
    throw serviceError("invalid_arguments", "Worker concurrency must be an integer between 1 and 128");
  }
  return parsed;
}

function parseHealthPort(value: number | undefined, environment: NodeJS.ProcessEnv): number {
  const candidate = value ?? Number(environment.HT_WORKER_HEALTH_PORT?.trim() || "8080");
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 65_535) {
    throw serviceError("invalid_arguments", "Worker health port must be an integer between 0 and 65535");
  }
  return candidate;
}

function parseResourceConcurrency(value: string | undefined): number {
  return parsePositiveInteger(value, 1);
}

function parseJournalRetentionDays(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 30;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3_650) {
    throw serviceError("invalid_arguments", "Session journal retention must be between 1 and 3650 days");
  }
  return parsed;
}

function parseCapabilities(value: string | undefined): Record<string, unknown> {
  if (value === undefined || value.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw serviceError("invalid_arguments", "HT_WORKER_CAPABILITIES must be a JSON object");
  }
}

export function workerRegistrationCapabilities(environment: NodeJS.ProcessEnv): Record<string, unknown> {
  const capabilities = parseCapabilities(environment.HT_WORKER_CAPABILITIES);
  const configurationVersion = environment.HT_ENVIRONMENT_CONFIG_VERSION?.trim();
  if (configurationVersion === undefined || configurationVersion === "") return capabilities;
  const parsedVersion = Number(configurationVersion);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    throw serviceError("invalid_arguments", "HT_ENVIRONMENT_CONFIG_VERSION must be a positive integer");
  }
  return { ...capabilities, humanthreadEnvironmentConfigurationVersion: parsedVersion };
}

export function workerRuntimeMetadata(environment: NodeJS.ProcessEnv): {
  runtime: "docker" | "kubernetes";
  taskGroupName?: string;
} {
  const runtime = environment.HT_WORKER_RUNTIME?.trim() === "kubernetes" ? "kubernetes" : "docker";
  const taskGroupName = runtime === "kubernetes"
    ? environment.HT_WORKER_TASK_GROUP_NAME?.trim() || environment.HT_WORKER_POOL_NAME?.trim()
    : undefined;
  return {
    runtime,
    ...(taskGroupName ? { taskGroupName } : {}),
  };
}

/**
 * A Worker multiplexes many live sessions onto one Node process. Any rejection
 * that escapes an async callback would otherwise terminate the process and take
 * every other session with it, leaving browser terminals permanently blank.
 * This guard converts such a rejection into structured evidence and keeps the
 * remaining sessions running.
 */
export function createWorkerRejectionGuard(input: {
  target?: {
    on(event: string, listener: (reason: unknown) => void): unknown;
    off(event: string, listener: (reason: unknown) => void): unknown;
  };
  log: (entry: {
    event: string;
    state: "degraded";
    timestamp: string;
    code: string;
    message: string;
  }) => void;
  now?: () => Date;
}): () => void {
  const target = input.target ?? process;
  const now = input.now ?? (() => new Date());
  const listener = (reason: unknown): void => {
    const code = reason && typeof reason === "object" && "code" in reason
      ? String(Reflect.get(reason, "code"))
      : "unhandled_rejection";
    input.log({
      event: "worker.unhandled_rejection",
      state: "degraded",
      timestamp: now().toISOString(),
      code,
      // Only Error messages are surfaced. Arbitrary rejection values may carry
      // credentials, so they are replaced with a fixed summary.
      message: reason instanceof Error
        ? reason.message.slice(0, 512)
        : "Worker encountered an unexpected rejection",
    });
  };
  target.on("unhandledRejection", listener);
  return () => {
    target.off("unhandledRejection", listener);
  };
}

export function createWorkerService(input: {
  platformUrl: string;
  poolToken: string;
  stateDirectory: string;
  pollIntervalMs?: number;
  healthPort?: number;
  environment?: NodeJS.ProcessEnv;
}, dependencies: {
  createRuntime?: () => WorkerRuntime;
  createRuntimeWithDependencies?: (
    dependencies: Parameters<typeof createWorkerRuntime>[0],
  ) => WorkerRuntime;
  log?: (entry: {
    event: string;
    state: ReturnType<WorkerRuntime["state"]>;
    timestamp: string;
    [key: string]: unknown;
  }) => void;
} = {}) {
  if (!input.poolToken.trim()) throw serviceError("authentication_required", "Worker Pool token is required");
  if (!input.stateDirectory.startsWith("/")) throw serviceError("invalid_arguments", "Worker state directory must be absolute");
  const environment = input.environment ?? process.env;
  const healthPort = parseHealthPort(input.healthPort, environment);
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 60_000) {
    throw serviceError("invalid_arguments", "Worker poll interval is invalid");
  }
  const log = dependencies.log ?? ((entry) => process.stdout.write(`${JSON.stringify(entry)}\n`));
  // A relay hiccup must degrade a single TUI session, never the worker process:
  // these callbacks replace unhandled rejections on the app-server notification
  // path with structured, operator-visible evidence.
  // A TUI that exits immediately is the difference between a working terminal
  // and a black one, so the exit code and the tail of its output are always
  // reported in a redacted, bounded form.
  const logLiveSessionExit = (sessionId: string, info: { exitCode: number | null; tail: string }) => log({
    event: info.exitCode === 0 ? "worker.live_session.exited" : "worker.live_session.failed",
    state: "degraded",
    timestamp: new Date().toISOString(),
    sessionId,
    code: info.exitCode === 0 ? "provider_tui_exited" : "provider_tui_start_failed",
    exitCode: info.exitCode,
    outputTail: redactLiveSessionTail(info.tail),
  });
  const logLiveSessionInputFailure = (sessionId: string, error: unknown) => log({
    event: "worker.live_session.input_failed",
    state: "degraded",
    timestamp: new Date().toISOString(),
    sessionId,
    code: error && typeof error === "object" && "code" in error ? String(error.code) : "provider_tui_input_failed",
    message: error instanceof Error ? error.message.slice(0, 512) : "Live session input failed",
  });
  // A retry means the TUI attached before the app-server persisted the thread
  // rollout. Repeated retries are still operator-visible, then the session is
  // reported as interrupted instead of relaunching forever.
  const logLiveSessionRetry = (sessionId: string, info: { attempt: number; exitCode: number | null; tail: string }) => log({
    event: "worker.live_session.retrying",
    state: "degraded",
    timestamp: new Date().toISOString(),
    sessionId,
    code: "provider_tui_retry",
    attempt: info.attempt,
    exitCode: info.exitCode,
    outputTail: redactLiveSessionTail(info.tail),
  });
  const logLiveSessionOutputFailure = (sessionId: string, error: unknown) => log({
    event: "worker.live_session.output_failed",
    state: "degraded",
    timestamp: new Date().toISOString(),
    sessionId,
    code: error && typeof error === "object" && "code" in error ? String(error.code) : "provider_tui_output_failed",
    message: error instanceof Error ? error.message.slice(0, 512) : "Live session output failed",
  });
  const liveSessionJournal = new LiveSessionJournal({
    rootDirectory: `${input.stateDirectory}/live-session-journal`,
    retentionDays: parseJournalRetentionDays(environment.HT_LIVE_SESSION_JOURNAL_RETENTION_DAYS),
  });
  let workerPoolSessionToken: string | null = null;
  // Terminal output can echo prompts or secrets; only control characters are
  // stripped here and callers must not treat this tail as a credential sink.
  const redactLiveSessionTail = (value: string) => value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/gu, "")
    .slice(-1_024);
  const runtimeDependencies: Parameters<typeof createWorkerRuntime>[0] = {
    config: {
      instanceId: environment.HT_WORKER_INSTANCE_ID?.trim() || hostname(),
      ...(environment.HT_WORKER_POOL_NAME?.trim() ? { poolName: environment.HT_WORKER_POOL_NAME.trim() } : {}),
      ...workerRuntimeMetadata(environment),
      capabilities: workerRegistrationCapabilities(environment),
      requestedConcurrency: parsePositiveInteger(environment.HT_MAX_CONCURRENT_RUNS, 1),
      resourceLimits: {
        gpuConcurrency: parseResourceConcurrency(environment.HT_GPU_CONCURRENCY),
        unityBuildConcurrency: parseResourceConcurrency(environment.HT_UNITY_BUILD_CONCURRENCY),
      },
      stateDirectory: input.stateDirectory,
      sessionJournalRetentionDays: parseJournalRetentionDays(environment.HT_LIVE_SESSION_JOURNAL_RETENTION_DAYS),
    },
    api: createWorkerPlatformApi({
      platformUrl: input.platformUrl,
      poolToken: input.poolToken,
      onRegistered: (session) => {
        workerPoolSessionToken = session.sessionToken;
      },
    }),
    outbox: createWorkerOutbox({
      directory: `${input.stateDirectory}/outbox`,
      maxRecords: 10_000,
      maxBytes: 64 * 1024 * 1024,
      maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
    }),
    prepareWorktree: createWorkerWorktreeManager({
      stateDirectory: input.stateDirectory,
      runtime: environment.HT_WORKER_RUNTIME?.trim() === "kubernetes" ? "kubernetes" : "docker",
      ...(environment.HT_WORKER_TASK_ROOT?.trim() ? { taskRoot: environment.HT_WORKER_TASK_ROOT.trim() } : {}),
    }).prepare,
    appServer: (options) => createCodexAppServerClient({
      readBundledModelCatalog: createBundledModelCatalogReader(),
      transport: options?.transport ?? "stdio",
    }),
    liveSessionJournal,
    createLiveSessionConnector: (liveSession) => {
      const sessionToken = workerPoolSessionToken;
      if (!sessionToken) throw serviceError("internal_connector_offline", "Worker pool session is not registered");
      return createWorkerLiveSessionConnector({
        relayUrl: liveSession.relayUrl,
        sessionId: liveSession.sessionId,
        workerPoolSessionToken: sessionToken,
        heartbeatMs: 15_000,
        now: () => new Date(),
        onInput: async () => {
          // TUI input is routed by the session's own connector; this factory is
          // only used for the early no-TUI phase window.
        },
        onInputError: (error) => logLiveSessionInputFailure(liveSession.sessionId, error),
      });
    },
    onLiveSession: async ({ assignment, appServer, threadId, cwd, codexHome, environment, connector: existingConnector }) => {
      const liveSession = assignment.liveSession;
      const sessionToken = workerPoolSessionToken;
      if (!liveSession || !appServer.endpoint || !sessionToken) return;
      let tui: ReturnType<typeof createWorkerTuiSession> | null = null;
      // The connector opened before worktree preparation keeps the same relay
      // session, so early Git phases and the TUI share one observation stream.
      const connector = existingConnector ?? createWorkerLiveSessionConnector({
        relayUrl: liveSession.relayUrl,
        sessionId: liveSession.sessionId,
        workerPoolSessionToken: sessionToken,
        heartbeatMs: 15_000,
        now: () => new Date(),
        onInput: async (bytes) => {
          if (!tui) throw serviceError("provider_tui_detached", "Worker TUI session is not running");
          await tui.handleInput(bytes);
        },
        onResize: async (size) => {
          if (!tui) throw serviceError("provider_tui_detached", "Worker TUI session is not running");
          await tui.resize(size);
        },
        onInputError: (error) => logLiveSessionInputFailure(liveSession.sessionId, error),
      });
      // The connector may have been opened before the PTY existed, when viewer
      // input had nowhere to go. Bind the real TUI handlers now so the same
      // relay session carries input once the terminal is running.
      connector.attachInputHandlers({
        onInput: async (bytes) => {
          if (!tui) throw serviceError("provider_tui_detached", "Worker TUI session is not running");
          await tui.handleInput(bytes);
        },
        onResize: async (size) => {
          if (!tui) throw serviceError("provider_tui_detached", "Worker TUI session is not running");
          await tui.resize(size);
        },
      });
      // The Worker journal is the only durable copy of this session's terminal
      // stream. A viewer that asks to replay from a cursor is served from that
      // journal instead of forcing the relay to keep every byte in memory.
      connector.attachReplayHandler(async ({ requestId, afterSequence }) => {
        const replay = await liveSessionJournal.read(liveSession.sessionId, afterSequence);
        if (replay.status === "replay_unavailable" || replay.chunks.length === 0) {
          connector.publishReplayState({
            requestId,
            status: replay.status === "replay_unavailable" ? "unavailable" : "ready",
            firstSequence: replay.firstSequence,
            lastSequence: replay.lastSequence,
          });
          return;
        }
        for (const chunk of replay.chunks) connector.publishReplayChunk(chunk);
        connector.publishReplayState({
          requestId,
          status: "ready",
          firstSequence: replay.firstSequence,
          lastSequence: replay.lastSequence,
        });
      });
      const host = createWorkerCodexTuiHost({
        client: {
          endpoint: appServer.endpoint.bind(appServer),
          request: appServer.request.bind(appServer),
          subscribe: appServer.subscribe.bind(appServer),
        },
        codexHome,
        environment,
        attachMode: "resume",
        model: assignment.executionSnapshot.model.model,
        reasoningEffort: assignment.executionSnapshot.model.reasoningEffort,
        providerArguments: modelProviderArguments(assignment.executionSnapshot.model.endpoint),
        onOutputError: (error) => logLiveSessionOutputFailure(liveSession.sessionId, error),
      });
      tui = createWorkerTuiSession({
        sessionId: liveSession.sessionId,
        journal: liveSessionJournal,
        connector,
        host,
        onRetry: (info) => logLiveSessionRetry(liveSession.sessionId, info),
        onOutputError: (error) => logLiveSessionOutputFailure(liveSession.sessionId, error),
        onExit: (info) => logLiveSessionExit(liveSession.sessionId, info),
      });
      await tui.start({ threadId, cwd });
      return {
        async close() {
          await tui?.stop();
        },
      };
    },
    onDirectLiveSession: async ({ session, appServer, threadId, cwd, codexHome }) => {
      const sessionToken = workerPoolSessionToken;
      if (!appServer.endpoint || !sessionToken) return;
      let tui: ReturnType<typeof createWorkerTuiSession> | null = null;
      const connector = createWorkerLiveSessionConnector({
        relayUrl: session.relayUrl,
        sessionId: session.sessionId,
        workerPoolSessionToken: sessionToken,
        heartbeatMs: 15_000,
        now: () => new Date(),
        onInput: async (bytes) => {
          if (!tui) throw serviceError("provider_tui_detached", "Worker TUI session is not running");
          await tui.handleInput(bytes);
        },
        onResize: async (size) => {
          if (!tui) throw serviceError("provider_tui_detached", "Worker TUI session is not running");
          await tui.resize(size);
        },
        onInputError: (error) => logLiveSessionInputFailure(session.sessionId, error),
      });
      const host = createWorkerCodexTuiHost({
        client: {
          endpoint: appServer.endpoint.bind(appServer),
          request: appServer.request.bind(appServer),
          subscribe: appServer.subscribe.bind(appServer),
        },
        codexHome,
        // A taskless direct session has no turn, so no rollout exists yet and
        // the TUI must create and own the thread itself.
        attachMode: "remote",
        model: session.runtime.model,
        reasoningEffort: session.runtime.reasoningEffort,
        providerArguments: modelProviderArguments(session.runtime.endpoint),
        onOutputError: (error) => logLiveSessionOutputFailure(session.sessionId, error),
      });
      tui = createWorkerTuiSession({
        sessionId: session.sessionId,
        journal: liveSessionJournal,
        connector,
        host,
        onRetry: (info) => logLiveSessionRetry(session.sessionId, info),
        onOutputError: (error) => logLiveSessionOutputFailure(session.sessionId, error),
        onExit: (info) => logLiveSessionExit(session.sessionId, info),
      });
      try {
        await tui.start({ threadId, cwd });
      } catch (error) {
        // Failing to start the PTY must not leave the execution socket open:
        // the Relay would report an online target while the terminal stays
        // blank. Tear the whole session down and surface the real cause.
        await tui.stop().catch(() => undefined);
        log({
          event: "worker.direct_session.failed",
          state: "degraded",
          timestamp: new Date().toISOString(),
          sessionId: session.sessionId,
          code: error && typeof error === "object" && "code" in error ? String(error.code) : "provider_tui_start_failed",
          message: error instanceof Error ? error.message.slice(0, 512) : "Direct Worker TUI failed to start",
        });
        throw error;
      }
      return {
        async close() {
          await tui?.stop();
        },
        async wait() {
          await tui?.wait();
        },
      };
    },
    collectReviewArtifacts: collectWorkerReviewArtifacts,
    onExecutionFailure: (failure) => log({
      event: "worker.assignment.failed",
      state: "degraded",
      timestamp: new Date().toISOString(),
      ...failure,
    }),
  };
  const runtime = dependencies.createRuntime?.()
    ?? (dependencies.createRuntimeWithDependencies
      ? dependencies.createRuntimeWithDependencies(runtimeDependencies)
      : createWorkerRuntime(runtimeDependencies));
  const emitLog = (event: string) => log({ event, state: runtime.state(), timestamp: new Date().toISOString() });
  let loggedState: ReturnType<WorkerRuntime["state"]> | null = null;
  const emitStateChange = () => {
    if (runtime.state() === loggedState) return;
    loggedState = runtime.state();
    emitLog("worker.service.state_changed");
  };
  let started = false;
  let stopping = false;
  let loop: Promise<void> | null = null;
  let wake: (() => void) | null = null;
  let healthServer: Server | null = null;
  let disposeRejectionGuard: (() => void) | null = null;

  const ready = () => {
    const state = runtime.state();
    return state !== "registering" && state !== "offline" && state !== "degraded" && state !== "draining";
  };

  const startHealthServer = async (): Promise<void> => {
    if (healthServer) return;
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      if (path === "/healthz") {
        response.writeHead(200);
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (path === "/readyz") {
        const state = runtime.state();
        response.writeHead(ready() ? 200 : 503);
        response.end(JSON.stringify({ ready: ready(), state }));
        return;
      }
      response.writeHead(404);
      response.end(JSON.stringify({ error: "not_found" }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "0.0.0.0", port: healthPort }, () => {
        server.off("error", reject);
        resolve();
      });
    });
    healthServer = server;
  };

  const stopHealthServer = async (): Promise<void> => {
    const server = healthServer;
    healthServer = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };

  const wait = () => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { wake = null; resolve(); }, pollIntervalMs);
    wake = () => { clearTimeout(timer); wake = null; resolve(); };
  });

  return {
    async start(): Promise<void> {
      if (started) return;
      started = true;
      disposeRejectionGuard = createWorkerRejectionGuard({
        log: (entry) => log({ ...entry, state: runtime.state() }),
      });
      await startHealthServer();
      emitLog("worker.service.started");
      loggedState = runtime.state();
      loop = (async () => {
        while (!stopping) {
          await runtime.tick();
          emitStateChange();
          if (!stopping) await wait();
        }
      })().catch(() => undefined);
    },
    async stop(): Promise<void> {
      if (!started || stopping) return;
      stopping = true;
      wake?.();
      await runtime.drain();
      await loop;
      await stopHealthServer();
      disposeRejectionGuard?.();
      disposeRejectionGuard = null;
      emitLog("worker.service.stopped");
    },
    state(): ReturnType<WorkerRuntime["state"]> { return runtime.state(); },
    healthAddress(): { port: number } | null {
      const address = healthServer?.address();
      return address && typeof address === "object" ? { port: address.port } : null;
    },
  };
}
