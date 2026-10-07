export const MAX_OUTPUT_QUEUE_BYTES = 4 * 1024 * 1024;
export const MAX_PHASE_FRAME_BYTES = 16 * 1024;

const MAX_PHASE_TEXT_LENGTH = 64;
const MAX_PHASE_SUMMARY_LENGTH = 512;

const PHASE_STATUSES = new Set(["pending", "running", "succeeded", "failed", "skipped"]);

export interface RelayPhaseFrame {
  phase: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string | null;
  code: string | null;
  summary: string | null;
  attemptNo: number;
  leaseGeneration: number;
}

const PHASE_FRAME_KEYS = new Set([
  "phase",
  "status",
  "startedAt",
  "finishedAt",
  "code",
  "summary",
  "attemptNo",
  "leaseGeneration",
]);

/**
 * Phase frames are display-only. Anything that could carry terminal control
 * bytes, credentials or a full repository URL is rejected here rather than
 * being forwarded to a browser.
 */
export function parseRelayPhaseFrame(value: unknown): RelayPhaseFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw relayError("live_session_invalid", "Phase frame must be an object");
  }
  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!PHASE_FRAME_KEYS.has(key)) throw relayError("live_session_invalid", "Phase frame contains unknown fields");
  }
  const phase = boundedPhaseText(candidate.phase, MAX_PHASE_TEXT_LENGTH, "Phase name");
  const status = candidate.status;
  if (typeof status !== "string" || !PHASE_STATUSES.has(status)) {
    throw relayError("live_session_invalid", "Phase status is invalid");
  }
  const startedAt = isoInstant(candidate.startedAt, "Phase start");
  const finishedAt = candidate.finishedAt === null ? null : isoInstant(candidate.finishedAt, "Phase finish");
  const code = candidate.code === null ? null : boundedPhaseText(candidate.code, MAX_PHASE_TEXT_LENGTH, "Phase code");
  const summary = candidate.summary === null
    ? null
    : boundedPhaseText(candidate.summary, MAX_PHASE_SUMMARY_LENGTH, "Phase summary");
  const attemptNo = positiveInteger(candidate.attemptNo, "Phase attempt number");
  const leaseGeneration = positiveInteger(candidate.leaseGeneration, "Phase lease generation");
  const frame: RelayPhaseFrame = {
    phase,
    status: status as RelayPhaseFrame["status"],
    startedAt,
    finishedAt,
    code,
    summary,
    attemptNo,
    leaseGeneration,
  };
  if (new TextEncoder().encode(JSON.stringify(frame)).byteLength > MAX_PHASE_FRAME_BYTES) {
    throw relayError("live_session_invalid", "Phase frame exceeds the size limit");
  }
  return frame;
}

function boundedPhaseText(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== "string") throw relayError("live_session_invalid", `${label} is invalid`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw relayError("live_session_invalid", `${label} is invalid`);
  if (/[\u0000-\u001F\u007F-\u009F]/u.test(text)) {
    throw relayError("live_session_invalid", `${label} contains control characters`);
  }
  if (/\u001B\[[0-9;]*[A-Za-z]/u.test(text)) {
    throw relayError("live_session_invalid", `${label} contains ANSI escapes`);
  }
  if (/(?:bearer|token|password|passwd|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/iu.test(text)) {
    throw relayError("live_session_invalid", `${label} contains a credential`);
  }
  if (/[a-z][a-z0-9+.-]*:\/\/[^\s]*[?&][^\s=]+=/iu.test(text)) {
    throw relayError("live_session_invalid", `${label} contains a URL query string`);
  }
  if (/[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/iu.test(text)) {
    throw relayError("live_session_invalid", `${label} contains URL credentials`);
  }
  return text;
}

function isoInstant(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw relayError("live_session_invalid", `${label} is invalid`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw relayError("live_session_invalid", `${label} is invalid`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw relayError("live_session_invalid", `${label} is invalid`);
  }
  return Number(value);
}

export type RelayControlState = "viewer" | "controller" | "detached";

export interface RelayViewer {
  connectionId: string;
  lastSequence: number;
  queuedBytes: number;
  /** Viewer-scoped connections may never claim control, write input or resize. */
  readOnly: boolean;
  send(chunk: { sequence: number; bytes: Uint8Array }): void;
  /**
   * Control-plane frames must remain text so a browser can never mistake a
   * JSON status update for terminal bytes.
   */
  sendText?(text: string): void;
  disconnect(reason: "backpressure"): void;
}

export interface RelaySession {
  sessionId: string;
  executionConnectionId: string | null;
  controllerConnectionId: string | null;
  viewers: Map<string, RelayViewer>;
  firstSequence: number;
  lastSequence: number;
  sendInput: ((bytes: Uint8Array) => void) | null;
  sendResize: ((size: { rows: number; cols: number }) => void) | null;
  /** Last geometry reported by the controller, replayed to late execution sockets. */
  lastSize: { rows: number; cols: number } | null;
  sendControl: ((state: "claimed" | "released") => void) | null;
  /** Asks the execution side to serve history from its own journal. */
  sendReplay: ((request: { requestId: string; afterSequence: number }) => void) | null;
  /**
   * Replay responses are addressed to the viewer that asked for them and never
   * consume the live output sequence, so a late viewer cannot disturb the
   * monotonic stream every other viewer is already following.
   */
  pendingReplay: Map<string, string>;
  /**
   * Bounded in-memory tail of recent output. A viewer that attaches after the
   * TUI has already started must receive this, otherwise the terminal stays
   * blank while the relay still reports the target online.
   */
  replay: Array<{ sequence: number; bytes: Uint8Array }>;
  replayBytes: number;
  /** Latest phase is display-only and never consumes an output sequence. */
  latestPhase: RelayPhaseFrame | null;
}

export class LiveRelayRouter {
  readonly #sessions = new Map<string, RelaySession>();

  registerSession(input: { sessionId: string; firstSequence: number; lastSequence: number }): RelaySession {
    const session: RelaySession = {
      sessionId: input.sessionId,
      executionConnectionId: null,
      controllerConnectionId: null,
      viewers: new Map(),
      firstSequence: input.firstSequence,
      lastSequence: input.lastSequence,
      sendInput: null,
      sendResize: null,
      lastSize: null,
      sendControl: null,
      sendReplay: null,
      pendingReplay: new Map(),
      replay: [],
      replayBytes: 0,
      latestPhase: null,
    };
    this.#sessions.set(input.sessionId, session);
    return session;
  }

  attachViewer(input: {
    sessionId: string;
    connectionId: string;
    lastSequence: number;
    readOnly?: boolean;
    send: RelayViewer["send"];
    sendText?: RelayViewer["sendText"];
    disconnect: RelayViewer["disconnect"];
  }): RelayViewer {
    const session = this.#requireSession(input.sessionId);
    const viewer: RelayViewer = {
      connectionId: input.connectionId,
      lastSequence: input.lastSequence,
      queuedBytes: 0,
      readOnly: input.readOnly ?? false,
      send: input.send,
      ...(input.sendText ? { sendText: input.sendText } : {}),
      disconnect: input.disconnect,
    };
    session.viewers.set(input.connectionId, viewer);
    // Replay before returning so the caller installs the live route only after
    // the backlog is queued; otherwise the gap between attach and first live
    // frame would be dropped.
    this.#replayTo(session, viewer);
    if (session.latestPhase) this.#sendPhase(session, viewer, session.latestPhase);
    return viewer;
  }

  #sendPhase(session: RelaySession, viewer: RelayViewer, phase: RelayPhaseFrame): void {
    const text = JSON.stringify({ type: "server.phase", ...phase });
    if (viewer.sendText) viewer.sendText(text);
    else viewer.send({ sequence: session.lastSequence, bytes: new TextEncoder().encode(text) });
  }

  #replayTo(session: RelaySession, viewer: RelayViewer): void {
    if (viewer.lastSequence >= session.lastSequence) return;
    for (const chunk of session.replay) {
      if (chunk.sequence <= viewer.lastSequence) continue;
      if (viewer.queuedBytes + chunk.bytes.byteLength > MAX_OUTPUT_QUEUE_BYTES) {
        // A viewer that cannot absorb the backlog is dropped rather than
        // silently shown a partial, misleading terminal history.
        viewer.disconnect("backpressure");
        session.viewers.delete(viewer.connectionId);
        return;
      }
      viewer.queuedBytes += chunk.bytes.byteLength;
      viewer.lastSequence = chunk.sequence;
      viewer.send(chunk);
    }
  }

  registerExecution(input: { sessionId: string; connectionId: string; firstSequence: number; lastSequence: number }): RelaySession {
    // Reuse the existing route so a Worker reconnect keeps the replay buffer
    // and output sequence instead of starting from an empty terminal.
    const session = this.#sessions.get(input.sessionId) ?? this.registerSession(input);
    session.executionConnectionId = input.connectionId;
    return session;
  }

  detachViewer(sessionId: string, connectionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.viewers.delete(connectionId);
    if (session.controllerConnectionId === connectionId) session.controllerConnectionId = null;
  }

  detachExecution(sessionId: string, connectionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session || session.executionConnectionId !== connectionId) return;
    for (const viewer of session.viewers.values()) viewer.send({
      sequence: session.lastSequence,
      bytes: new TextEncoder().encode(JSON.stringify({ type: "server.state", targetOnline: false })),
    });
    // Keep the route (and therefore the replay buffer plus the last sequence)
    // while the Worker reconnects. Deleting it here discarded the only copy of
    // the terminal history, so a short execution restart made every later
    // viewer render a blank terminal even though the TUI kept streaming.
    session.executionConnectionId = null;
    session.sendInput = null;
    session.sendResize = null;
    session.sendControl = null;
  }

  publishState(sessionId: string, state: { targetOnline: boolean }): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "server.state", ...state }));
    for (const viewer of session.viewers.values()) viewer.send({ sequence: session.lastSequence, bytes });
  }

  claimControl(sessionId: string, connectionId: string): RelayControlState {
    const session = this.#requireSession(sessionId);
    const viewer = session.viewers.get(connectionId);
    if (!viewer || viewer.readOnly) throw relayError("live_session_control_conflict", "Connection is not allowed to claim control");
    session.controllerConnectionId = connectionId;
    session.sendControl?.("claimed");
    return "controller";
  }

  releaseControl(sessionId: string, connectionId: string): RelayControlState {
    const session = this.#requireSession(sessionId);
    if (session.controllerConnectionId === connectionId) {
      session.controllerConnectionId = null;
      session.sendControl?.("released");
    }
    return "viewer";
  }

  writeInput(sessionId: string, connectionId: string, bytes: Uint8Array): void {
    const session = this.#requireSession(sessionId);
    if (session.controllerConnectionId !== connectionId) {
      throw relayError("live_session_control_conflict", "Controller lease is required");
    }
    if (bytes.length > 256 * 1024) throw relayError("live_session_backpressure", "Input frame exceeds the limit");
    session.sendInput?.(bytes);
  }

  attachInputSender(sessionId: string, send: ((bytes: Uint8Array) => void) | null): void {
    const session = this.#requireSession(sessionId);
    session.sendInput = send;
  }

  resizeTerminal(sessionId: string, connectionId: string, size: { rows: number; cols: number }): void {
    const session = this.#requireSession(sessionId);
    if (session.controllerConnectionId !== connectionId) {
      throw relayError("live_session_control_conflict", "Controller lease is required");
    }
    if (!Number.isSafeInteger(size.rows) || size.rows < 1 || size.rows > 500
      || !Number.isSafeInteger(size.cols) || size.cols < 1 || size.cols > 1_000) {
      throw relayError("live_session_invalid", "Terminal size is invalid");
    }
    session.sendResize?.(size);
    session.lastSize = size;
  }

  attachResizeSender(sessionId: string, send: ((size: { rows: number; cols: number }) => void) | null): void {
    const session = this.#requireSession(sessionId);
    session.sendResize = send;
  }

  attachControlSender(sessionId: string, send: ((state: "claimed" | "released") => void) | null): void {
    const session = this.#requireSession(sessionId);
    session.sendControl = send;
  }

  attachReplaySender(
    sessionId: string,
    send: ((request: { requestId: string; afterSequence: number }) => void) | null,
  ): void {
    const session = this.#requireSession(sessionId);
    session.sendReplay = send;
  }

  /**
   * Records that a viewer wants history before the relay's bounded window and
   * forwards the request to the execution side, which owns the journal.
   */
  requestReplay(input: {
    sessionId: string;
    connectionId: string;
    requestId: string;
    afterSequence: number;
  }): boolean {
    const session = this.#requireSession(input.sessionId);
    if (!session.viewers.has(input.connectionId) || !session.sendReplay) return false;
    session.pendingReplay.set(input.requestId, input.connectionId);
    session.sendReplay({ requestId: input.requestId, afterSequence: input.afterSequence });
    return true;
  }

  routeReplayChunk(sessionId: string, input: { requestId: string; sequence: number; bytes: Uint8Array }): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    const connectionId = session.pendingReplay.get(input.requestId);
    if (!connectionId) return;
    const viewer = session.viewers.get(connectionId);
    if (!viewer) {
      session.pendingReplay.delete(input.requestId);
      return;
    }
    viewer.send({ sequence: input.sequence, bytes: input.bytes });
  }

  routeReplayState(
    sessionId: string,
    input: { requestId: string; status: "ready" | "unavailable"; firstSequence?: number; lastSequence?: number },
  ): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    const connectionId = session.pendingReplay.get(input.requestId);
    session.pendingReplay.delete(input.requestId);
    if (!connectionId) return;
    const viewer = session.viewers.get(connectionId);
    if (!viewer?.sendText) return;
    viewer.sendText(JSON.stringify({ type: "server.replay", ...input }));
  }

  publishOutput(sessionId: string, chunk: { sequence: number; bytes: Uint8Array }): void {
    const session = this.#requireSession(sessionId);
    if (chunk.sequence <= session.lastSequence) return;
    if (chunk.sequence !== session.lastSequence + 1) {
      throw relayError("replay_unavailable", "Output sequence is discontinuous");
    }
    session.lastSequence = chunk.sequence;
    session.replay.push({ sequence: chunk.sequence, bytes: chunk.bytes });
    session.replayBytes += chunk.bytes.byteLength;
    while (session.replayBytes > MAX_OUTPUT_QUEUE_BYTES && session.replay.length > 1) {
      session.replayBytes -= session.replay.shift()!.bytes.byteLength;
    }
    for (const viewer of [...session.viewers.values()]) {
      if (viewer.lastSequence >= chunk.sequence) continue;
      if (viewer.queuedBytes + chunk.bytes.byteLength > MAX_OUTPUT_QUEUE_BYTES) {
        viewer.disconnect("backpressure");
        session.viewers.delete(viewer.connectionId);
        continue;
      }
      viewer.queuedBytes += chunk.bytes.byteLength;
      viewer.lastSequence = chunk.sequence;
      viewer.send(chunk);
    }
  }

  publishPhase(sessionId: string, value: unknown): RelayPhaseFrame {
    const session = this.#requireSession(sessionId);
    const phase = parseRelayPhaseFrame(value);
    session.latestPhase = phase;
    for (const viewer of session.viewers.values()) this.#sendPhase(session, viewer, phase);
    return phase;
  }

  latestPhase(sessionId: string): RelayPhaseFrame | null {
    return this.session(sessionId)?.latestPhase ?? null;
  }

  dropSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  session(sessionId: string): RelaySession | null {
    return this.#sessions.get(sessionId) ?? null;
  }

  #requireSession(sessionId: string): RelaySession {
    const session = this.#sessions.get(sessionId);
    if (!session) throw relayError("live_session_not_found", "Live session was not found");
    return session;
  }
}

export function relayError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
