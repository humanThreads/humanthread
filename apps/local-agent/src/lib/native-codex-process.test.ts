import { describe, expect, it, vi } from "vitest";

import { createNativeCodexSpawn, type NativeCodexEventListener } from "./native-codex-process";

describe("native Codex process bridge", () => {
  it("streams only events for its stable process key and waits for exit", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen: NativeCodexEventListener = vi.fn(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("start_codex_process");
      const processKey = String(args?.processKey);
      queueMicrotask(() => {
        handlers.get("codex_process_output")?.({
          payload: { processKey: "another", processId: 8, stream: "stdout", chunk: "ignored\n" },
        });
        handlers.get("codex_process_output")?.({
          payload: { processKey, processId: 42, stream: "stdout", chunk: "event\n" },
        });
        handlers.get("codex_process_exit")?.({
          payload: { processKey, processId: 42, code: 0, signal: null },
        });
      });
      return 42;
    });
    const onOutput = vi.fn();
    const spawn = createNativeCodexSpawn({ invoke, listen, onOutput, createProcessKey: () => "loop:attempt_1" });

    const process = spawn("codex", ["exec", "--json", "prompt"], { cwd: "/work/project" });
    const chunks: string[] = [];
    for await (const chunk of process.stdout) chunks.push(chunk);

    expect(chunks).toEqual(["event\n"]);
    expect(onOutput).toHaveBeenCalledWith({
      processKey: "loop:attempt_1",
      processId: 42,
      stream: "stdout",
      chunk: "event\n",
    });
    await expect(process.wait()).resolves.toEqual({ code: 0, signal: null });
    expect(invoke).toHaveBeenCalledWith("start_codex_process", {
      processKey: "loop:attempt_1",
      cwd: "/work/project",
      executable: "codex",
      args: ["exec", "--json", "prompt"],
      environmentRefs: [],
    });
  });

  it("forwards the selected runtime environment references without exposing their values", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen: NativeCodexEventListener = vi.fn(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "start_codex_process") {
        expect(args).toMatchObject({
          environmentRefs: ["CODEX_HOME", "OPENAI_API_KEY"],
        });
        const processKey = String(args?.processKey);
        queueMicrotask(() => handlers.get("codex_process_exit")?.({
          payload: { processKey, processId: 42, code: 0, signal: null },
        }));
        return 42;
      }
      return undefined;
    });
    const spawn = createNativeCodexSpawn({
      invoke,
      listen,
      environmentRefs: ["CODEX_HOME", "OPENAI_API_KEY"],
      createProcessKey: () => "loop:attempt_1",
    });

    const process = spawn("codex", ["exec", "--json", "prompt"], { cwd: "/work/project" });
    for await (const _chunk of process.stdout) { /* wait for native exit */ }
    await expect(process.wait()).resolves.toEqual({ code: 0, signal: null });
  });

  it("forwards the configured runtime credential context without exposing the key", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen: NativeCodexEventListener = vi.fn(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "start_codex_process") {
        expect(args).toMatchObject({
          credentialContext: {
            deploymentOrigin: "http://localhost:3000",
            userId: "user_1",
            credentialRef: "0123456789abcdef0123456789abcdef",
          },
        });
        expect(JSON.stringify(args)).not.toContain("secret-key");
        const processKey = String(args?.processKey);
        queueMicrotask(() => handlers.get("codex_process_exit")?.({
          payload: { processKey, processId: 42, code: 0, signal: null },
        }));
        return 42;
      }
      return undefined;
    });
    const spawn = createNativeCodexSpawn({
      invoke,
      listen,
      createProcessKey: () => "loop:attempt_1",
    });

    const process = spawn("codex", ["exec", "--json", "prompt"], {
      cwd: "/work/project",
      credentialContext: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user_1",
        credentialRef: "0123456789abcdef0123456789abcdef",
      },
    });
    for await (const _chunk of process.stdout) { /* wait for native exit */ }
    await expect(process.wait()).resolves.toEqual({ code: 0, signal: null });
  });

  it("removes inherited Codex auth and routing state when the native spawn has independent credentials", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen: NativeCodexEventListener = vi.fn(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "start_codex_process") {
        expect(args).toMatchObject({ environmentRefs: ["HTTPS_PROXY"] });
        expect(args).not.toHaveProperty("environmentRefs", expect.arrayContaining([
          "CODEX_HOME",
          "OPENAI_API_KEY",
          "OPENAI_BASE_URL",
          "OPENAI_ORGANIZATION",
          "OPENAI_PROJECT",
        ]));
        const processKey = String(args?.processKey);
        queueMicrotask(() => handlers.get("codex_process_exit")?.({
          payload: { processKey, processId: 42, code: 0, signal: null },
        }));
        return 42;
      }
      return undefined;
    });
    const spawn = createNativeCodexSpawn({
      invoke,
      listen,
      environmentRefs: [
        "CODEX_HOME",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "OPENAI_ORGANIZATION",
        "OPENAI_PROJECT",
        "HTTPS_PROXY",
      ],
      credentialContext: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user_1",
        credentialRef: "0123456789abcdef0123456789abcdef",
      },
      createProcessKey: () => "loop:attempt_1",
    });

    const process = spawn("codex", ["exec", "--json", "prompt"], { cwd: "/work/project" });
    for await (const _chunk of process.stdout) { /* wait for native exit */ }
    await expect(process.wait()).resolves.toEqual({ code: 0, signal: null });
  });

  it("preserves string errors returned by the native start command", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen: NativeCodexEventListener = vi.fn(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
    const invoke = vi.fn(async (command: string) => {
      if (command === "start_codex_process") throw "Codex arguments are invalid";
      return undefined;
    });
    const spawn = createNativeCodexSpawn({
      invoke,
      listen,
      createProcessKey: () => "loop:attempt_1",
    });

    const process = spawn("codex", ["exec", "--json", "prompt"], { cwd: "/work/project" });
    const chunks: string[] = [];
    for await (const chunk of process.stderr) chunks.push(chunk);

    expect(chunks).toEqual(["Codex arguments are invalid\n"]);
    await expect(process.wait()).resolves.toEqual({ code: null, signal: "spawn_failed" });
  });

  it("forwards the validated runtime executable instead of relying on the app PATH", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen: NativeCodexEventListener = vi.fn(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "start_codex_process") {
        const processKey = String(args?.processKey);
        queueMicrotask(() => handlers.get("codex_process_exit")?.({
          payload: { processKey, processId: 42, code: 0, signal: null },
        }));
        return 42;
      }
      return undefined;
    });
    const spawn = createNativeCodexSpawn({
      invoke,
      listen,
      executable: "/Users/test/.nvm/versions/node/v24.13.1/bin/codex",
      createProcessKey: () => "loop:attempt_1",
    });

    const process = spawn("codex", ["exec", "--json", "prompt"], { cwd: "/work/project" });
    for await (const _chunk of process.stdout) { /* wait for native exit */ }
    await expect(process.wait()).resolves.toEqual({ code: 0, signal: null });
    expect(invoke).toHaveBeenCalledWith("start_codex_process", expect.objectContaining({
      executable: "/Users/test/.nvm/versions/node/v24.13.1/bin/codex",
    }));
  });

  it("keeps provider streams alive when the output observer fails", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen: NativeCodexEventListener = async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    };
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const processKey = String(args?.processKey);
      queueMicrotask(() => {
        handlers.get("codex_process_output")?.({
          payload: { processKey, processId: 42, stream: "stderr", chunk: "warning\n" },
        });
        handlers.get("codex_process_exit")?.({
          payload: { processKey, processId: 42, code: 0, signal: null },
        });
      });
      return 42;
    });
    const spawn = createNativeCodexSpawn({
      invoke,
      listen,
      onOutput: () => { throw new Error("observer unavailable"); },
      createProcessKey: () => "loop:attempt_1",
    });

    const process = spawn("codex", ["exec", "--json", "prompt"], { cwd: "/work/project" });
    const chunks: string[] = [];
    for await (const chunk of process.stderr) chunks.push(chunk);

    expect(chunks).toEqual(["warning\n"]);
    await expect(process.wait()).resolves.toEqual({ code: 0, signal: null });
  });

  it("cancels the native process after its ID is assigned", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen: NativeCodexEventListener = async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    };
    const invoke = vi.fn(async (command: string) => command === "start_codex_process" ? 42 : undefined);
    const spawn = createNativeCodexSpawn({ invoke, listen, createProcessKey: () => "loop:attempt_1" });
    const process = spawn("codex", ["exec", "--json", "prompt"], { cwd: "/work/project" });

    process.cancel();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("cancel_codex_process", {
      processId: 42,
    }));
  });

  it("rejects commands other than Codex", () => {
    const spawn = createNativeCodexSpawn({
      invoke: vi.fn(),
      listen: vi.fn(),
      createProcessKey: () => "loop:attempt_1",
    });

    expect(() => spawn("sh", ["-c", "echo no"], { cwd: "/work/project" }))
      .toThrow("Only Codex may use the native provider bridge");
  });

  it("cancels when the supplied execution signal aborts", async () => {
    const listen: NativeCodexEventListener = vi.fn(async () => () => undefined);
    const invoke = vi.fn(async (command: string) => command === "start_codex_process" ? 42 : undefined);
    const spawn = createNativeCodexSpawn({ invoke, listen, createProcessKey: () => "loop:attempt_1" });
    const controller = new AbortController();

    spawn("codex", ["exec", "--json", "prompt"], {
      cwd: "/work/project",
      signal: controller.signal,
    });
    controller.abort();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("cancel_codex_process", {
      processId: 42,
    }));
  });
});
