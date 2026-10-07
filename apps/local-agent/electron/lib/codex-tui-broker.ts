import { isAbsolute } from "node:path";

import type { LiveSessionJournal } from "@humanthread/live-session-journal";

import type {
  CodexAppServerNotification,
  CodexAppServerState,
} from "./codex-app-server";

const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
/**
 * Controlled TUIs run inside the user's own project workspace, so they must
 * not stop on interactive approval prompts. Keep the flag in one place: the
 * Worker runtime and the Desktop broker must launch the same template.
 */
/**
 * Retired approval flag, kept as a named tripwire.
 *
 * Codex 0.159.2 rejects `resume <thread> --remote <endpoint>` combined with
 * `--dangerously-bypass-approvals-and-sandbox` ("Permission overrides are not
 * supported when resuming a remote task.") and exits before painting. The
 * no-approval authority is the app-server thread itself, which is opened with
 * `approvalPolicy`/`sandbox` from the execution policy; the viewer TUI only
 * mirrors it. Re-adding this flag here silently breaks every Desktop attach.
 */
export const CODEX_TUI_NO_APPROVAL_ARGUMENT = "--dangerously-bypass-approvals-and-sandbox";

export interface CodexTuiSessionInput {
  sessionId: string;
  runId: string;
  taskId: string | null;
  projectId: string | null;
  nodeKey: string | null;
  processKey: string;
  threadId: string;
  cwd: string;
  model: string | null;
  windowId: number;
}

export type CodexTuiControlState = "viewer" | "controller" | "detached";

export interface CodexTuiSessionView {
  sessionId: string;
  runId: string;
  taskId: string | null;
  projectId: string | null;
  nodeKey: string | null;
  processKey: string;
  threadId: string;
  cwd: string;
  model: string | null;
  status: "starting" | "running" | "detached" | "interrupted" | "completed";
  controlState: CodexTuiControlState;
  controllerWindowId: number | null;
  attachedCount: number;
  lastActivityAtMs: number | null;
  bufferBytes: number;
  generation: number | null;
}

type CodexTuiAppServer = {
  state(processKey: string): CodexAppServerState | null;
  request(processKey: string, method: string, params: unknown): Promise<unknown>;
  subscribe(handler: (notification: CodexAppServerNotification) => void): () => void;
  probeCapabilities?(processKey: string, executable: string): Promise<void>;
};

export interface CodexTuiBroker {
  register(input: Omit<CodexTuiSessionInput, "windowId">): void;
  unregister(sessionId: string): void;
  freeze(sessionId: string): Promise<void>;
  list(): CodexTuiSessionView[];
  start(input: Omit<CodexTuiSessionInput, "windowId">): Promise<CodexTuiSessionView>;
  spawn(input: CodexTuiSessionInput): Promise<CodexTuiSessionView>;
  attach(sessionId: string, windowId: number): { session: CodexTuiSessionView; replayBase64: string };
  reattach(sessionId: string, windowId: number): Promise<CodexTuiSessionView>;
  detach(sessionId: string, windowId: number): CodexTuiSessionView;
  write(sessionId: string, windowId: number, deltaBase64: string): Promise<void>;
  resize(sessionId: string, windowId: number, rows: number, cols: number): Promise<void>;
  acquire(sessionId: string, windowId: number): CodexTuiSessionView;
  release(sessionId: string, windowId: number): CodexTuiSessionView;
  close(sessionId: string): Promise<void>;
  closeAll(): Promise<void>;
  dispose(): void;
  session(sessionId: string): CodexTuiSessionView | null;
}

type CodexTuiSession = Omit<CodexTuiSessionInput, "windowId"> & {
  generation: number | null;
  finished: boolean;
  processHandle: string | null;
  status: CodexTuiSessionView["status"];
  controllerWindowId: number | null;
  attachedWindows: Set<number>;
  chunks: Buffer[];
  bufferBytes: number;
  lastActivityAtMs: number | null;
};

function providerError(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

function validateIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.length > 256 || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw providerError("provider_tui_invalid", `${label} is invalid`);
  }
}

function validateSessionInput(input: Omit<CodexTuiSessionInput, "windowId">): void {
  validateIdentifier(input.sessionId, "TUI session id");
  validateIdentifier(input.runId, "AgentRun id");
  validateIdentifier(input.processKey, "Codex daemon key");
  validateIdentifier(input.threadId, "Codex thread id");
  if (!isAbsolute(input.cwd) || /[\u0000-\u001F\u007F]/u.test(input.cwd)) {
    throw providerError("provider_tui_invalid", "TUI working directory is invalid");
  }
  for (const value of [input.taskId, input.projectId, input.nodeKey, input.model]) {
    if (value !== null) validateIdentifier(value, "TUI session metadata");
  }
}

function validateWindowId(windowId: number): void {
  if (!Number.isSafeInteger(windowId) || windowId <= 0) {
    throw providerError("provider_tui_invalid", "Desktop window id is invalid");
  }
}

function decodeBase64(value: string, maxBytes = MAX_WRITE_BYTES): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil(maxBytes * 4 / 3) + 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) {
    throw providerError("provider_tui_invalid", "TUI input is invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw providerError("provider_tui_invalid", "TUI input is invalid");
  }
  return bytes;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createCodexTuiBroker(options: {
  appServer: CodexTuiAppServer;
  executable: string;
  viewerHome: string;
  maxBufferBytes?: number;
  emit?: (event: string, payload: unknown) => void;
  now?: () => number;
  createProcessHandle?: (sessionId: string) => string;
  journal?: LiveSessionJournal;
  onSessionOutput?: (input: { sessionId: string; bytes: Uint8Array }) => void | Promise<void>;
}): CodexTuiBroker {
  const executable = options.executable.trim();
  if (!executable || /[\u0000-\u001F\u007F]/u.test(executable)) {
    throw providerError("provider_tui_invalid", "Codex executable is invalid");
  }
  if (!isAbsolute(options.viewerHome)) {
    throw providerError("provider_tui_invalid", "Codex viewer home is invalid");
  }
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 1) {
    throw providerError("provider_tui_invalid", "Codex TUI buffer limit is invalid");
  }
  const now = options.now ?? Date.now;
  let handleCounter = 0;
  const probedGenerations = new Set<string>();
  const sessions = new Map<string, CodexTuiSession>();
  const unsubscribe = options.appServer.subscribe((notification) => {
    const params = record(notification.params);
    if (!params || typeof params.processHandle !== "string") return;
    const session = [...sessions.values()].find((entry) => entry.processHandle === params.processHandle);
    if (!session) return;
    if (
      notification.processKey !== session.processKey
      || (session.generation !== null && notification.generation !== session.generation)
    ) {
      // Output from another daemon generation cannot belong to this session.
      session.processHandle = null;
      session.controllerWindowId = null;
      session.status = "interrupted";
      options.emit?.("codex_tui_state", view(session));
      return;
    }
    session.lastActivityAtMs = notification.receivedAtMs;
    if (notification.method === "process/outputDelta") {
      const deltaBase64 = typeof params.deltaBase64 === "string" ? params.deltaBase64 : null;
      if (!deltaBase64) return;
      const decoded = Buffer.from(deltaBase64, "base64");
      if (decoded.length === 0) return;
      void options.journal?.append(session.sessionId, decoded).catch(() => undefined);
      void options.onSessionOutput?.({ sessionId: session.sessionId, bytes: decoded });
      session.chunks.push(decoded);
      session.bufferBytes += decoded.length;
      while (session.bufferBytes > maxBufferBytes && session.chunks.length > 1) {
        const removed = session.chunks.shift();
        session.bufferBytes -= removed?.length ?? 0;
      }
      if (session.bufferBytes > maxBufferBytes && session.chunks.length === 1) {
        const only = session.chunks[0]!;
        session.chunks[0] = only.subarray(only.length - maxBufferBytes);
        session.bufferBytes = session.chunks[0]!.length;
      }
      options.emit?.("codex_tui_output", {
        sessionId: session.sessionId,
        stream: params.stream === "stderr" ? "stderr" : "stdout",
        deltaBase64,
        receivedAtMs: notification.receivedAtMs,
      });
      options.emit?.("codex_tui_state", view(session));
      return;
    }
    if (notification.method === "process/exited") {
      const exitCode = typeof params.exitCode === "number" ? params.exitCode : null;
      session.processHandle = null;
      session.controllerWindowId = null;
      session.status = exitCode === 0 ? "detached" : "interrupted";
      options.emit?.("codex_tui_state", view(session));
    }
  });

  function sessionOrThrow(sessionId: string): CodexTuiSession {
    const session = sessions.get(sessionId);
    if (!session) throw providerError("provider_tui_not_found", "Codex TUI session was not found");
    return session;
  }

  function view(session: CodexTuiSession): CodexTuiSessionView {
    return {
      sessionId: session.sessionId,
      runId: session.runId,
      taskId: session.taskId,
      projectId: session.projectId,
      nodeKey: session.nodeKey,
      processKey: session.processKey,
      threadId: session.threadId,
      cwd: session.cwd,
      model: session.model,
      status: session.status,
      controlState: session.status === "running"
        ? session.controllerWindowId === null ? "viewer" : "controller"
        : "detached",
      controllerWindowId: session.controllerWindowId,
      attachedCount: session.attachedWindows.size,
      lastActivityAtMs: session.lastActivityAtMs,
      bufferBytes: session.bufferBytes,
      generation: session.generation,
    };
  }

  function replay(session: CodexTuiSession): string {
    return Buffer.concat(session.chunks, session.bufferBytes).toString("base64");
  }

  return {
    register(input) {
      validateSessionInput(input);
      const existing = sessions.get(input.sessionId);
      if (existing?.processHandle) {
        throw providerError("provider_tui_conflict", "Codex TUI session is already running");
      }
      sessions.set(input.sessionId, {
        ...input,
        generation: null,
        finished: false,
        processHandle: null,
        status: "detached",
        controllerWindowId: null,
        attachedWindows: new Set(),
        chunks: [],
        bufferBytes: 0,
        lastActivityAtMs: null,
      });
    },
    unregister(sessionId) {
      sessions.delete(sessionId);
    },
    async freeze(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return;
      const processHandle = session.processHandle;
      session.processHandle = null;
      session.controllerWindowId = null;
      session.finished = true;
      session.status = "completed";
      if (processHandle) {
        await options.appServer.request(session.processKey, "process/kill", { processHandle }).catch(() => undefined);
      }
      options.emit?.("codex_tui_state", view(session));
    },
    list() {
      return [...sessions.values()]
        .sort((left, right) => (right.lastActivityAtMs ?? 0) - (left.lastActivityAtMs ?? 0))
        .map(view);
    },
    session(sessionId) {
      const session = sessions.get(sessionId);
      return session ? view(session) : null;
    },
    async start(input) {
      validateSessionInput(input);
      if (!sessions.has(input.sessionId)) {
        sessions.set(input.sessionId, {
          ...input,
          generation: null,
          finished: false,
          processHandle: null,
          status: "detached",
          controllerWindowId: null,
          attachedWindows: new Set(),
          chunks: [],
          bufferBytes: 0,
          lastActivityAtMs: null,
        });
      }
      const session = sessionOrThrow(input.sessionId);
      if (session.finished) {
        throw providerError(
          "provider_tui_completed",
          "Codex TUI session is complete and cannot be resumed",
        );
      }
      if (session.processHandle && session.status === "running") return view(session);
      return this.spawn({ ...input, windowId: 1 });
    },
    async spawn(input) {
      validateWindowId(input.windowId);
      const session = sessionOrThrow(input.sessionId);
      if (
        session.runId !== input.runId
        || session.processKey !== input.processKey
        || session.threadId !== input.threadId
        || session.cwd !== input.cwd
      ) {
        throw providerError("provider_tui_conflict", "Codex TUI session binding changed");
      }
      if (session.processHandle && session.status === "running") return view(session);
      const state = options.appServer.state(session.processKey);
      if (!state?.endpoint || !["websocket", "unix"].includes(state.transport)) {
        throw providerError("provider_tui_unavailable", "Codex daemon endpoint is unavailable");
      }
      if (session.generation !== null && session.generation !== state.generation) {
        session.status = "interrupted";
        session.processHandle = null;
        session.controllerWindowId = null;
        throw providerError(
          "provider_tui_generation_stale",
          "Codex daemon generation changed after this TUI session was created",
        );
      }
      const capabilityKey = `${session.processKey}:${state.generation}`;
      if (!probedGenerations.has(capabilityKey) && options.appServer.probeCapabilities) {
        await options.appServer.probeCapabilities(session.processKey, executable);
        probedGenerations.add(capabilityKey);
      }
      const processHandle = (options.createProcessHandle ?? ((sessionId: string) => (
        `tui:${sessionId}:${++handleCounter}`
      )))(session.sessionId);
      validateIdentifier(processHandle, "TUI process handle");
      session.status = "starting";
      session.controllerWindowId = null;
      const modelArguments = session.model?.trim() ? ["-m", session.model.trim()] : [];
      await options.appServer.request(session.processKey, "process/spawn", {
        // The TUI is a second `codex` process and does not inherit the
        // app-server's model, so it must be told explicitly; otherwise it shows
        // Codex's own default instead of the model the user selected.
        command: [
          executable,
          "resume",
          session.threadId,
          "--remote",
          state.endpoint,
          "--cd",
          session.cwd,
          ...modelArguments,
        ],
        processHandle,
        cwd: session.cwd,
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
        outputBytesCap: maxBufferBytes,
        timeoutMs: null,
        env: {
          CODEX_HOME: options.viewerHome,
          OPENAI_API_KEY: null,
          OPENAI_BASE_URL: null,
          OPENAI_ORGANIZATION: null,
          OPENAI_PROJECT: null,
          TERM: "xterm-256color",
        },
        size: { rows: 30, cols: 100 },
      });
      session.processHandle = processHandle;
      session.generation = state.generation;
      session.status = "running";
      session.lastActivityAtMs = now();
      const current = view(session);
      options.emit?.("codex_tui_state", current);
      return current;
    },
    attach(sessionId, windowId) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      const state = options.appServer.state(session.processKey);
      if (!state || (session.generation !== null && session.generation !== state.generation)) {
        session.status = "interrupted";
        session.processHandle = null;
        session.controllerWindowId = null;
      }
      session.attachedWindows.add(windowId);
      return { session: view(session), replayBase64: replay(session) };
    },
    detach(sessionId, windowId) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      session.attachedWindows.delete(windowId);
      if (session.controllerWindowId === windowId) session.controllerWindowId = null;
      const current = view(session);
      options.emit?.("codex_tui_state", current);
      return current;
    },
    async write(sessionId, windowId, deltaBase64) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      if (!session.processHandle || session.status !== "running") {
        throw providerError("provider_tui_detached", "Codex TUI session is not running");
      }
      if (session.controllerWindowId !== windowId) {
        throw providerError("provider_tui_control_required", "Codex TUI control lease is required");
      }
      decodeBase64(deltaBase64);
      await options.appServer.request(session.processKey, "process/writeStdin", {
        processHandle: session.processHandle,
        deltaBase64,
      });
    },
    async resize(sessionId, windowId, rows, cols) {
      validateWindowId(windowId);
      if (!Number.isSafeInteger(rows) || rows < 1 || rows > 500 || !Number.isSafeInteger(cols) || cols < 1 || cols > 1000) {
        throw providerError("provider_tui_invalid", "TUI terminal size is invalid");
      }
      const session = sessionOrThrow(sessionId);
      if (!session.processHandle || session.status !== "running") {
        throw providerError("provider_tui_detached", "Codex TUI session is not running");
      }
      if (session.controllerWindowId !== windowId) {
        throw providerError("provider_tui_control_required", "Codex TUI control lease is required");
      }
      await options.appServer.request(session.processKey, "process/resizePty", {
        processHandle: session.processHandle,
        size: { rows, cols },
      });
    },
    acquire(sessionId, windowId) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      session.controllerWindowId = windowId;
      const current = view(session);
      options.emit?.("codex_tui_state", current);
      return current;
    },
    release(sessionId, windowId) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      if (session.controllerWindowId === windowId) session.controllerWindowId = null;
      const current = view(session);
      options.emit?.("codex_tui_state", current);
      return current;
    },
    async close(sessionId) {
      const session = sessionOrThrow(sessionId);
      const processHandle = session.processHandle;
      session.processHandle = null;
      session.controllerWindowId = null;
      session.status = "detached";
      if (processHandle) {
        await options.appServer.request(session.processKey, "process/kill", { processHandle }).catch(() => undefined);
      }
      options.emit?.("codex_tui_state", view(session));
    },
    async reattach(sessionId, windowId) {
      const session = sessionOrThrow(sessionId);
      if (session.finished) {
        throw providerError(
          "provider_tui_completed",
          "Codex TUI session is complete and cannot be resumed",
        );
      }
      const state = options.appServer.state(session.processKey);
      if (!state?.endpoint || !["websocket", "unix"].includes(state.transport)) {
        throw providerError("provider_tui_unavailable", "Codex daemon endpoint is unavailable");
      }
      if (session.generation !== null && session.generation !== state.generation) {
        session.status = "interrupted";
        session.processHandle = null;
        session.controllerWindowId = null;
        throw providerError(
          "provider_tui_generation_stale",
          "Codex daemon generation changed after this TUI session was created",
        );
      }
      return this.spawn({
        sessionId,
        runId: session.runId,
        taskId: session.taskId,
        projectId: session.projectId,
        nodeKey: session.nodeKey,
        processKey: session.processKey,
        threadId: session.threadId,
        cwd: session.cwd,
        model: session.model,
        windowId,
      });
    },
    async closeAll() {
      await Promise.all([...sessions.keys()].map((sessionId) => this.close(sessionId)));
    },
    dispose() {
      unsubscribe();
      sessions.clear();
    },
  };
}
