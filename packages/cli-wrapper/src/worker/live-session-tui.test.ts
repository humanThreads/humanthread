import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSessionJournal } from "@humanthread/live-session-journal";

import {
  WORKER_TUI_NO_APPROVAL_ARGUMENT,
  buildWorkerCodexTuiCommand,
  createWorkerCodexTuiHost,
  createWorkerTuiSession,
} from "./live-session-tui";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Worker TUI session", () => {
  it("pins a retired approval flag so a future Codex cannot silently ignore it", () => {
    // Codex 0.159.2 rejects --dangerously-bypass-approvals-and-sandbox on
    // `resume ... --remote` with "Permission overrides are not supported when
    // resuming a remote task." The app-server session owns the policy, so this
    // constant is retained only as the tripwire that must not be re-attached
    // to the TUI command line.
    expect(WORKER_TUI_NO_APPROVAL_ARGUMENT).toBe("--dangerously-bypass-approvals-and-sandbox");
    expect(buildWorkerCodexTuiCommand({
      executable: "codex",
      attachMode: "resume",
      threadId: "thread_1",
      endpoint: "ws://127.0.0.1:1234",
      cwd: "/repo",
    })).not.toContain(WORKER_TUI_NO_APPROVAL_ARGUMENT);
  });

  it("builds one launch template for resume and remote attachment", () => {
    const resume = buildWorkerCodexTuiCommand({
      executable: "codex",
      attachMode: "resume",
      threadId: "thread_1",
      endpoint: "ws://127.0.0.1:1234",
      cwd: "/repo",
    });
    const remote = buildWorkerCodexTuiCommand({
      executable: "codex",
      attachMode: "remote",
      threadId: "thread_1",
      endpoint: "ws://127.0.0.1:1234",
    });

    // The app-server thread/start already carries approvalPolicy=never and
    // sandbox=danger-full-access; repeating a permission flag on the TUI command
    // line makes 0.159.2 abort the remote resume before painting.
    expect(resume).toEqual([
      "codex",
      "resume",
      "thread_1",
      "--remote",
      "ws://127.0.0.1:1234",
      "--cd",
      "/repo",
    ]);
    expect(remote).toEqual([
      "codex",
      "--remote",
      "ws://127.0.0.1:1234",
    ]);
  });

  it("forwards PTY output deltas from the app-server to the session", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const published: Uint8Array[] = [];
    const requests: string[] = [];
    const session = createWorkerTuiSession({
      sessionId: "c".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(async (bytes) => { published.push(bytes); }),
        publishPhase: vi.fn(async () => undefined),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: createWorkerCodexTuiHost({
        client: {
          endpoint: () => "ws://127.0.0.1:1234",
          request: vi.fn(async (method: string) => { requests.push(method); return {}; }),
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        codexHome: join(root, "codex"),
      }),
    });

    await session.start({ threadId: "thread_1", cwd: join(root, "cwd") });
    for (const listener of listeners) {
      listener({ method: "process/outputDelta", params: { processHandle: `worker-tui:${"c".repeat(32)}`, deltaBase64: Buffer.from("hello tui").toString("base64") } });
    }
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(Buffer.from(published[0]!).toString()).toBe("hello tui");
    expect(requests).toContain("process/spawn");
  });

  it("forwards the viewer geometry to the running PTY", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const session = createWorkerTuiSession({
      sessionId: "d".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(),
        publishPhase: vi.fn(),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: createWorkerCodexTuiHost({
        client: {
          endpoint: () => "ws://127.0.0.1:1234",
          request: vi.fn(async (method: string, params?: unknown) => {
            requests.push({ method, params: (params ?? {}) as Record<string, unknown> });
            return {};
          }),
        },
        codexHome: join(root, "codex"),
      }),
    });

    await session.start({ threadId: "thread_1", cwd: join(root, "cwd") });
    await session.resize({ rows: 24, cols: 80 });

    const resize = requests.find(({ method }) => method === "process/resizePty");
    // Without this the PTY keeps the 120x36 launch default and a phone-sized
    // viewer only ever sees a clipped strip of the TUI.
    expect(resize?.params).toMatchObject({ size: { rows: 24, cols: 80 } });
  });

  it("applies geometry that arrived before the PTY finished starting", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    // A holder object keeps TypeScript from narrowing the resolver to `never`
    // after the executor assignment.
    const spawnGateControl: { release: () => void } = { release: () => undefined };
    const spawnGate = new Promise<void>((resolve) => { spawnGateControl.release = resolve; });
    const session = createWorkerTuiSession({
      sessionId: "e".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(),
        publishPhase: vi.fn(),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: {
        async spawn() {
          await spawnGate;
          return {
            handle: `worker-tui:${"e".repeat(32)}`,
            threadId: "thread_1",
            cwd: join(root, "cwd"),
            kill: vi.fn(async () => undefined),
            exit: new Promise<void>(() => undefined),
          };
        },
        write: vi.fn(async () => undefined),
        resize: vi.fn(async (input: { handle: string; rows: number; cols: number }) => {
          requests.push({ method: "resize", params: input as unknown as Record<string, unknown> });
        }),
      },
    });

    const starting = session.start({ threadId: "thread_1", cwd: join(root, "cwd") });
    // The viewer attaches while the spawn is still in flight.
    await session.resize({ rows: 30, cols: 90 });
    spawnGateControl.release();
    await starting;

    expect(requests).toContainEqual({ method: "resize", params: expect.objectContaining({ rows: 30, cols: 90 }) });
  });

  it("journals before publishing output and keeps input behind the running PTY", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const published: Uint8Array[] = [];
    const written: Uint8Array[] = [];
    const outputHandlerRef: { current: ((bytes: Uint8Array) => void | Promise<void>) | null } = { current: null };
    const session = createWorkerTuiSession({
      sessionId: "a".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(async (bytes) => { published.push(bytes); }),
        publishPhase: vi.fn(async () => undefined),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: {
        spawn: vi.fn(async (input) => {
          outputHandlerRef.current = input.onOutput;
          return {
            handle: "process_1",
            threadId: input.threadId,
            cwd: input.cwd,
            kill: vi.fn(),
            exit: new Promise<void>(() => undefined),
          };
        }),
        write: vi.fn(async ({ bytes }) => { written.push(bytes); }),
        resize: vi.fn(),
      },
    });

    await session.start({ threadId: "thread_1", cwd: "/workspace/task" });
    await expect(session.handleInput(Buffer.from(""))).rejects.toMatchObject({ code: "worker_backpressure" });
    await session.handleInput(Buffer.from("hello"));
    const emitOutput = outputHandlerRef.current;
    if (emitOutput) await emitOutput(Buffer.from("output"));

    expect(session.state()).toBe("running");
    expect(written).toEqual([Buffer.from("hello")]);
    expect(published).toEqual([Buffer.from("output")]);
    await expect(session.journalState()).resolves.toMatchObject({ lastSequence: 1 });
  });

  it("keeps the TUI alive until its process exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    let finish: (() => void) | undefined;
    const exit = new Promise<void>((resolve) => { finish = resolve; });
    const session = createWorkerTuiSession({
      sessionId: "b".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(),
        publishPhase: vi.fn(),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: {
        spawn: vi.fn(async (input) => ({
          handle: "process_1",
          threadId: input.threadId,
          cwd: input.cwd,
          kill: vi.fn(),
          exit,
        })),
        write: vi.fn(),
        resize: vi.fn(),
      },
    });

    await session.start({ threadId: "thread_1", cwd: "/workspace/task" });
    let settled = false;
    const waiting = session.wait().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish?.();
    await waiting;
    expect(settled).toBe(true);
  });
});

describe("Worker TUI output safety", () => {
  it("keeps the session alive when one publish attempt fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const published: Uint8Array[] = [];
    const failures: unknown[] = [];
    let attempts = 0;
    const session = createWorkerTuiSession({
      sessionId: "f".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      onOutputError: (error) => { failures.push(error); },
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(async (bytes) => {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error("Relay connection is offline"), { code: "internal_connector_offline" });
          published.push(bytes);
        }),
        publishPhase: vi.fn(async () => undefined),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: createWorkerCodexTuiHost({
        client: {
          endpoint: () => "ws://127.0.0.1:1234",
          request: vi.fn(async () => ({})),
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        codexHome: join(root, "codex"),
      }),
    });

    await session.start({ threadId: "thread_1", cwd: join(root, "cwd") });
    const emit = (text: string) => {
      for (const listener of listeners) {
        listener({ method: "process/outputDelta", params: { processHandle: `worker-tui:${"f".repeat(32)}`, deltaBase64: Buffer.from(text).toString("base64") } });
      }
    };
    emit("first");
    emit("second");

    await vi.waitFor(() => expect(published).toHaveLength(1));
    // The line stays attached: a transient relay failure must never surface as
    // an unhandled rejection on the app-server notification callback.
    expect(session.state()).toBe("running");
    expect(failures).toHaveLength(1);
    expect(Buffer.from(published[0]!).toString()).toBe("second");
  });

  it("ends the session wait when the PTY exits so the relay is told the target is gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const started = [
      "\u001b[?2004h\u001b[6n",
    ].join("");
    const published: Uint8Array[] = [];
    const session = createWorkerTuiSession({
      sessionId: "b".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      // This case covers the terminal exit path; retry is covered separately.
      retry: { stabilizeMs: 0, retryDelayMs: 1, maxAttempts: 0 },
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(async (bytes) => { published.push(bytes); }),
        publishPhase: vi.fn(async () => undefined),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: createWorkerCodexTuiHost({
        client: {
          endpoint: () => "ws://127.0.0.1:1234",
          request: vi.fn(async () => ({})),
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        codexHome: join(root, "codex"),
      }),
    });

    await session.start({ threadId: "thread_1", cwd: join(root, "cwd") });
    let settled = false;
    const waiting = session.wait().then(() => { settled = true; });
    for (const listener of listeners) {
      listener({ method: "process/outputDelta", params: { processHandle: `worker-tui:${"b".repeat(32)}`, deltaBase64: Buffer.from(started).toString("base64") } });
    }
    await vi.waitFor(() => expect(published).toHaveLength(1));
    await Promise.resolve();
    expect(settled).toBe(false);

    for (const listener of listeners) {
      listener({ method: "process/exited", params: { processHandle: `worker-tui:${"b".repeat(32)}`, exitCode: 0 } });
    }
    await waiting;
    expect(settled).toBe(true);
    expect(session.state()).toBe("interrupted");
  });

  it("ignores output deltas from unrelated process handles", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const onOutput = vi.fn();
    const host = createWorkerCodexTuiHost({
      client: {
        endpoint: () => "ws://127.0.0.1:1234",
        request: vi.fn(async () => ({})),
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      },
      codexHome: join(root, "codex"),
    });
    await host.spawn({
      handle: "worker-tui:one",
      threadId: "thread_1",
      cwd: join(root, "cwd"),
      onOutput,
      onExit: vi.fn(),
    });

    for (const listener of listeners) {
      listener({ method: "process/outputDelta", params: { processHandle: "other-handle", deltaBase64: Buffer.from("nope").toString("base64") } });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onOutput).not.toHaveBeenCalled();
  });
});

describe("Worker TUI launch", () => {
  it("resumes the bound thread when the run already owns one", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const host = createWorkerCodexTuiHost({
      client: {
        endpoint: () => "ws://127.0.0.1:1234",
        request: vi.fn(async (method: string, params?: unknown) => {
          requests.push({ method, params: (params ?? {}) as Record<string, unknown> });
          return {};
        }),
      },
      codexHome: join(root, "codex"),
    });

    await host.spawn({
      handle: `worker-tui:${"a".repeat(32)}`,
      threadId: "01a0d948-06e0-7ce0-b51d-23c0dcefee0b",
      cwd: join(root, "cwd"),
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    const spawn = requests.find(({ method }) => method === "process/spawn");
    expect(spawn).toBeTruthy();
    const command = spawn!.params.command as string[];
    // A Loop run must observe the agent's own thread, so the TUI reattaches to
    // that thread instead of creating a second one.
    expect(command.slice(0, 3)).toEqual(["codex", "resume", "01a0d948-06e0-7ce0-b51d-23c0dcefee0b"]);
    expect(command).toEqual(expect.arrayContaining(["--remote"]));
    expect(command).not.toContain(WORKER_TUI_NO_APPROVAL_ARGUMENT);
  });

  it("lets the TUI own the thread for a taskless direct session", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const host = createWorkerCodexTuiHost({
      client: {
        endpoint: () => "ws://127.0.0.1:1234",
        request: vi.fn(async (method: string, params?: unknown) => {
          requests.push({ method, params: (params ?? {}) as Record<string, unknown> });
          return {};
        }),
      },
      codexHome: join(root, "codex"),
      attachMode: "remote",
    });

    await host.spawn({
      handle: `worker-tui:${"b".repeat(32)}`,
      threadId: "01a0d948-06e0-7ce0-b51d-23c0dcefee0b",
      cwd: join(root, "cwd"),
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    const command = requests.find(({ method }) => method === "process/spawn")!.params.command as string[];
    // No turn has run yet, so there is no rollout to resume. Resuming would
    // abort with "no rollout found" and leave the terminal blank.
    expect(command).not.toContain("resume");
    expect(command.slice(0, 2)).toEqual(["codex", "--remote"]);
    expect(command).not.toContain(WORKER_TUI_NO_APPROVAL_ARGUMENT);
  });

  it("launches the TUI with the selected model instead of Codex's built-in default", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const host = createWorkerCodexTuiHost({
      client: {
        endpoint: () => "ws://127.0.0.1:1234",
        request: vi.fn(async (method: string, params?: unknown) => {
          requests.push({ method, params: (params ?? {}) as Record<string, unknown> });
          return {};
        }),
      },
      codexHome: join(root, "codex"),
      attachMode: "remote",
      model: "deepseek-v4.1-flash",
      reasoningEffort: "max",
    });

    await host.spawn({
      handle: `worker-tui:${"f".repeat(32)}`,
      threadId: "01a0d948-06e0-7ce0-b51d-23c0dcefee0b",
      cwd: join(root, "cwd"),
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    const command = requests.find(({ method }) => method === "process/spawn")!.params.command as string[];
    // Without an explicit model the TUI silently falls back to Codex's own
    // default (`gpt-6-astra`), so the terminal shows a different model than the
    // one the user selected on the platform.
    expect(command).toEqual(expect.arrayContaining(["-m", "deepseek-v4.1-flash"]));
    expect(command).toEqual(expect.arrayContaining(["-c", 'model_reasoning_effort="max"']));
    expect(command).toEqual(expect.arrayContaining(["-c", 'model_reasoning_summary="none"']));
  });

  it("keeps the selected model when resuming a bound thread", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const host = createWorkerCodexTuiHost({
      client: {
        endpoint: () => "ws://127.0.0.1:1234",
        request: vi.fn(async (method: string, params?: unknown) => {
          requests.push({ method, params: (params ?? {}) as Record<string, unknown> });
          return {};
        }),
      },
      codexHome: join(root, "codex"),
      model: "deepseek-v4.1-flash",
      reasoningEffort: "high",
    });

    await host.spawn({
      handle: `worker-tui:${"a".repeat(32)}`,
      threadId: "01a0d948-06e0-7ce0-b51d-23c0dcefee0b",
      cwd: join(root, "cwd"),
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    const command = requests.find(({ method }) => method === "process/spawn")!.params.command as string[];
    expect(command.slice(0, 3)).toEqual(["codex", "resume", "01a0d948-06e0-7ce0-b51d-23c0dcefee0b"]);
    expect(command).toEqual(expect.arrayContaining(["-m", "deepseek-v4.1-flash"]));
    expect(command).toEqual(expect.arrayContaining(["-c", 'model_reasoning_summary="none"']));
  });

  it("retries the TUI while the app-server has not persisted the thread rollout yet", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const handle = `worker-tui:${"e".repeat(32)}`;
    const spawns: string[][] = [];
    const exits: Array<{ exitCode: number | null }> = [];
    const session = createWorkerTuiSession({
      sessionId: "e".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      retry: { stabilizeMs: 5_000, retryDelayMs: 1, maxAttempts: 4 },
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(async () => undefined),
        publishPhase: vi.fn(async () => undefined),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: createWorkerCodexTuiHost({
        client: {
          endpoint: () => "ws://127.0.0.1:1234",
          request: vi.fn(async (method: string, params?: unknown) => {
            if (method === "process/spawn") spawns.push((params as { command: string[] }).command);
            return {};
          }),
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        codexHome: join(root, "codex"),
        onExit: ({ exitCode }) => { exits.push({ exitCode }); },
      }),
    });

    await session.start({ threadId: "01a0d950-5489-7c81-8363-316c7ceeeee2", cwd: join(root, "cwd") });
    // First attempt fails exactly like production: the thread has no rollout yet.
    for (const listener of listeners) {
      listener({ method: "process/outputDelta", params: { processHandle: handle, deltaBase64: Buffer.from("Failed to resume session: no rollout found for thread id\r\n").toString("base64") } });
    }
    for (const listener of listeners) {
      listener({ method: "process/exited", params: { processHandle: handle, exitCode: 1 } });
    }

    await vi.waitFor(() => expect(spawns).toHaveLength(2), { timeout: 2_000 });
    expect(session.state()).toBe("running");
    expect(exits).toHaveLength(1);
  });

  it("gives up and reports the exit when the TUI keeps failing", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const handle = `worker-tui:${"a".repeat(32)}`;
    let spawns = 0;
    const terminalExits: Array<{ exitCode: number | null }> = [];
    const retries: number[] = [];
    const session = createWorkerTuiSession({
      sessionId: "a".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      // maxAttempts counts retries, so one retry means two PTY launches.
      retry: { stabilizeMs: 5_000, retryDelayMs: 1, maxAttempts: 1 },
      onExit: ({ exitCode }) => { terminalExits.push({ exitCode }); },
      onRetry: ({ attempt }) => { retries.push(attempt); },
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(async () => undefined),
        publishPhase: vi.fn(async () => undefined),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: createWorkerCodexTuiHost({
        client: {
          endpoint: () => "ws://127.0.0.1:1234",
          request: vi.fn(async (method: string) => { if (method === "process/spawn") spawns += 1; return {}; }),
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        codexHome: join(root, "codex"),
      }),
    });

    await session.start({ threadId: "thread_1", cwd: join(root, "cwd") });
    const failOnce = () => {
      for (const listener of listeners) {
        listener({ method: "process/outputDelta", params: { processHandle: handle, deltaBase64: Buffer.from("Failed to resume session: no rollout found\r\n").toString("base64") } });
      }
      for (const listener of listeners) {
        listener({ method: "process/exited", params: { processHandle: handle, exitCode: 1 } });
      }
    };

    failOnce();
    await vi.waitFor(() => expect(spawns).toBe(2), { timeout: 2_000 });
    failOnce();

    // Retries are reported individually, and the session reports one terminal
    // exit once the retry budget is exhausted instead of relaunching forever.
    expect(retries).toEqual([1]);
    expect(terminalExits).toEqual([{ exitCode: 1 }]);
    expect(spawns).toBe(2);
    expect(session.state()).toBe("interrupted");
  });

  it("reports the captured TUI output when the PTY exits so operators see the real reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const exits: Array<{ exitCode: number | null; tail: string }> = [];
    const handle = `worker-tui:${"d".repeat(32)}`;
    const session = createWorkerTuiSession({
      sessionId: "d".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      // Terminal-exit reporting only applies when retry is exhausted.
      retry: { stabilizeMs: 0, retryDelayMs: 1, maxAttempts: 0 },
      connector: {
        start: vi.fn(),
        heartbeat: vi.fn(),
        close: vi.fn(),
        state: () => "online",
        publish: vi.fn(async () => undefined),
        publishPhase: vi.fn(async () => undefined),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: createWorkerCodexTuiHost({
        client: {
          endpoint: () => "ws://127.0.0.1:1234",
          request: vi.fn(async () => ({})),
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        codexHome: join(root, "codex"),
        onExit: (info) => { exits.push(info); },
      }),
    });

    await session.start({ threadId: "thread_1", cwd: join(root, "cwd") });
    for (const listener of listeners) {
      listener({ method: "process/outputDelta", params: { processHandle: handle, deltaBase64: Buffer.from("Error: failed to launch TUI\r\n").toString("base64") } });
    }
    for (const listener of listeners) {
      listener({ method: "process/exited", params: { processHandle: handle, exitCode: 1, stderr: "Error: failed to launch TUI" } });
    }

    await vi.waitFor(() => expect(exits).toHaveLength(1));
    expect(exits[0]!.exitCode).toBe(1);
    expect(exits[0]!.tail).toContain("failed to launch TUI");
  });
});

describe("Worker TUI retry wait semantics", () => {
  it("keeps wait pending while a retry is in flight so the session is not torn down", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-worker-tui-"));
    roots.push(root);
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const handle = `worker-tui:${"c".repeat(32)}`;
    const session = createWorkerTuiSession({
      sessionId: "c".repeat(32),
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      retry: { stabilizeMs: 5_000, retryDelayMs: 30, maxAttempts: 3 },
      connector: {
        start: vi.fn(async () => undefined),
        heartbeat: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        state: () => "online",
        publish: vi.fn(async () => undefined),
        publishPhase: vi.fn(async () => undefined),
        attachInputHandlers: vi.fn(),
      attachReplayHandler: vi.fn(),
      publishReplayChunk: vi.fn(),
      publishReplayState: vi.fn(),
      },
      host: createWorkerCodexTuiHost({
        client: {
          endpoint: () => "ws://127.0.0.1:1234",
          request: vi.fn(async () => ({})),
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        codexHome: join(root, "codex"),
      }),
    });

    await session.start({ threadId: "thread_1", cwd: join(root, "cwd") });
    let settled = false;
    const waiting = session.wait().then(() => { settled = true; });

    for (const listener of listeners) {
      listener({ method: "process/exited", params: { processHandle: handle, exitCode: 1 } });
    }
    // The PTY is gone but a relaunch is pending: tearing the session down here
    // would stop the terminal the user is waiting for.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    await vi.waitFor(() => expect(session.state()).toBe("running"));
    await session.stop();
    await waiting;
  });
});
