import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { parseAppServerListeningEndpoint } from "../electron/lib/codex-app-server-transport.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function assertSmokeOutput(input: {
  threadRead: unknown;
  methodCalls: string[];
  spawnCommand?: readonly string[];
  outputTail?: string;
  threadStartParams?: Record<string, unknown>;
}): void {
  const thread = record(record(input.threadRead)?.thread);
  const turns = thread?.turns;
  if (!Array.isArray(turns) || !turns.some((turn) => {
    const items = record(turn)?.items;
    if (!Array.isArray(items)) return false;
    const hasUser = items.some((item) => {
      const entry = record(item);
      return entry?.type === "userMessage" && JSON.stringify(entry).includes("HUMANTHREAD_TUI_SMOKE");
    });
    const hasAssistant = items.some((item) => {
      const entry = record(item);
      return entry?.type === "agentMessage" && entry.text === "TUI_SMOKE_OK";
    });
    return hasUser && hasAssistant;
  })) {
    throw new Error("Codex TUI smoke did not persist the user and assistant messages");
  }
  if (!input.methodCalls.includes("process/spawn") || !input.methodCalls.includes("process/writeStdin")) {
    throw new Error("Codex TUI smoke did not use the PTY path");
  }
  const spawnCommand = input.spawnCommand ?? [];
  // The app-server session owns the execution policy. Codex 0.159.2 rejects a
  // permission flag on `resume ... --remote` ("Permission overrides are not
  // supported when resuming a remote task."), so a no-approval TUI must launch
  // without one and must still be driven by a policy-flagged thread.
  if (spawnCommand.includes("--dangerously-bypass-approvals-and-sandbox")) {
    throw new Error("Codex TUI smoke re-added the retired TUI approval override");
  }
  const threadStart = input.threadStartParams;
  if (threadStart !== undefined) {
    if (threadStart.approvalPolicy !== "never") {
      throw new Error("Codex TUI smoke did not start the thread with approvalPolicy=never");
    }
    if (threadStart.sandbox !== "danger-full-access") {
      throw new Error("Codex TUI smoke did not start the thread with sandbox=danger-full-access");
    }
  }
  if (/approval (?:required|requested)|waiting for approval|do you want to/iu.test(input.outputTail ?? "")) {
    throw new Error("Codex TUI smoke observed an interactive approval prompt");
  }
}

class SmokeRpc {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();
  readonly methods: string[] = [];
  private readonly notifications = new Set<(method: string, params: unknown) => void>();
  private readonly bufferedNotifications: Array<{ method: string; params: unknown }> = [];

  constructor(endpoint: string) {
    this.socket = new WebSocket(endpoint);
    this.socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const object = record(JSON.parse(data.toString("utf8")));
      if (!object) return;
      if (typeof object.method === "string") {
        this.methods.push(object.method);
        this.bufferedNotifications.push({ method: object.method, params: object.params ?? null });
        if (this.bufferedNotifications.length > 1_000) this.bufferedNotifications.shift();
        for (const handler of this.notifications) handler(object.method, object.params ?? null);
        return;
      }
      if (typeof object.id !== "number") return;
      const pending = this.pending.get(object.id);
      if (!pending) return;
      this.pending.delete(object.id);
      const error = record(object.error);
      if (error) pending.reject(new Error(typeof error.message === "string" ? error.message : "RPC failed"));
      else pending.resolve(object.result);
    });
  }

  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.methods.push(method);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params?: unknown): void {
    this.socket.send(JSON.stringify({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    }));
  }

  subscribe(handler: (method: string, params: unknown) => void): () => void {
    for (const notification of this.bufferedNotifications) {
      handler(notification.method, notification.params);
    }
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }

  hasNotification(predicate: (method: string, params: unknown) => boolean): boolean {
    return this.bufferedNotifications.some((notification) => predicate(notification.method, notification.params));
  }

  findNotification(predicate: (method: string, params: unknown) => boolean): { method: string; params: unknown } | null {
    return this.bufferedNotifications.find((notification) => predicate(notification.method, notification.params)) ?? null;
  }

  close(): void {
    this.socket.close();
  }
}

async function waitFor(
  rpc: SmokeRpc,
  predicate: (method: string, params: unknown) => boolean,
  timeoutMs: number,
  stage: string,
): Promise<{ method: string; params: unknown }> {
  return new Promise((resolve, reject) => {
    if (rpc.hasNotification(predicate)) {
      resolve(rpc.findNotification(predicate)!);
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Codex TUI smoke timed out during ${stage}`));
    }, timeoutMs);
    const unsubscribe = rpc.subscribe((method, params) => {
      if (!predicate(method, params)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve({ method, params });
    });
  });
}

function outputText(params: unknown): string {
  const value = record(params);
  const base64 = typeof value?.deltaBase64 === "string" ? value.deltaBase64 : "";
  return Buffer.from(base64, "base64").toString("utf8");
}

function strippedTerminalText(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\x1b[@-_]/gu, "")
    .replace(/\r/gu, "")
    .replace(/\u0000/gu, "")
    .slice(-2_000);
}

function debugTui(message: string): void {
  if (process.env.CODEX_TUI_SMOKE_DEBUG === "1") {
    console.error(`[codex-tui-smoke-debug] ${message}`);
  }
}


/**
 * Seeds the smoke workspace's trust decision into a copy of the user's Codex
 * config. TOML is order-sensitive here: a top-level key written after a table
 * header belongs to that table, and a table written before the user's own
 * settings swallows every top-level key that follows it. So the scalar must be
 * prepended (before any table) while the project table must be appended.
 */
export function buildSmokeConfig(input: { source: string; workspace: string }): string {
  const source = input.source;
  const leading: string[] = [];
  const trailing: string[] = [];
  if (!/^check_for_update_on_startup\s*=/mu.test(source)) {
    leading.push("check_for_update_on_startup = false");
  }
  if (!source.includes(`[projects.${JSON.stringify(input.workspace)}]`)) {
    trailing.push(`[projects.${JSON.stringify(input.workspace)}]\ntrust_level = "trusted"`);
  }
  const head = leading.join("\n");
  const tail = trailing.join("\n");
  if (!head && !tail) return source;
  const body = source.trim();
  return [head, body, tail].filter((part) => part.length > 0).join("\n") + "\n";
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "humanthread-codex-tui-smoke-"));
  const workspace = join(root, "workspace");
  const sourceCodeHome = process.env.CODEX_HOME?.trim()
    || join(process.env.HOME ?? "", ".codex");
  const codeHome = join(root, "codex-home");
  const executable = process.env.CODEX_EXECUTABLE?.trim() || "codex";
  let child: ChildProcess | null = null;
  let rpc: SmokeRpc | null = null;
  try {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(codeHome, { recursive: true });
    for (const fileName of ["config.toml", "auth.json", "codex-models.json"]) {
      const source = join(sourceCodeHome, fileName);
      if (existsSync(source)) copyFileSync(source, join(codeHome, fileName));
    }
    const smokeConfigPath = join(codeHome, "config.toml");
    if (!existsSync(smokeConfigPath)) writeFileSync(smokeConfigPath, "", "utf8");
    // Codex 0.159 stopped prompting for trust on a confirmed workspace, but a
    // fresh CODEX_HOME would still stop the automated smoke on the first-run
    // trust screen. The workspace is created by this script, so seed its trust
    // decision instead of driving an interactive prompt.
    const smokeConfig = buildSmokeConfig({
      source: readFileSync(smokeConfigPath, "utf8"),
      workspace,
    });
    writeFileSync(smokeConfigPath, smokeConfig, "utf8");
    child = spawn(executable, ["app-server", "--listen", "ws://127.0.0.1:0"], {
      cwd: root,
      env: { ...process.env, CODEX_HOME: codeHome },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Codex app-server did not start")), 15_000);
      if (!child?.stdout || !child.stderr) return reject(new Error("Codex app-server output is unavailable"));
      const handleLine = (line: string) => {
        const parsed = parseAppServerListeningEndpoint(line);
        if (!parsed) return;
        clearTimeout(timer);
        resolve(parsed);
      };
      createInterface({ input: child.stdout }).on("line", handleLine);
      createInterface({ input: child.stderr }).on("line", handleLine);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Codex app-server exited before ready: ${code ?? "signal"}`));
      });
    });
    rpc = new SmokeRpc(endpoint);
    await rpc.ready();
    await rpc.request("initialize", {
      clientInfo: { name: "humanthread-tui-smoke", version: "1" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    rpc.notify("initialized");
    // Mirror the production app-server thread: the session owns the execution
    // policy, so the TUI never needs a permission flag on the command line.
    const threadStartParams = {
      cwd: workspace,
      threadSource: "humanthread_desktop_smoke",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    };
    const threadResponse = record(await rpc.request("thread/start", threadStartParams));
    const thread = record(threadResponse?.thread);
    const threadId = typeof thread?.id === "string" ? thread.id : null;
    if (!threadId) throw new Error("Codex TUI smoke thread was not created");
    await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Bootstrap this thread. Reply with READY only.", text_elements: [] }],
    });
    await waitFor(rpc, (method, params) => {
      if (method !== "turn/completed") return false;
      const turn = record(record(params)?.turn);
      return turn?.status === "completed";
    }, 60_000, "bootstrap turn");

    const spawnResponse = record(await rpc.request("process/spawn", {
      command: [
        executable,
        "resume",
        threadId,
        "--remote",
        endpoint,
        "--cd",
        workspace,
      ],
      processHandle: "smoke-tui",
      cwd: workspace,
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      outputBytesCap: 1024 * 1024,
      timeoutMs: null,
      env: {
        CODEX_HOME: codeHome,
        OPENAI_API_KEY: null,
        OPENAI_BASE_URL: null,
        TERM: "xterm-256color",
      },
      size: { rows: 40, cols: 120 },
    }));
    void spawnResponse;
    let sawUpdatePrompt = false;
    let sentPrompt = false;
    // 0.159 asks the user to trust a workspace the first time it opens one.
    // The smoke workspace is created by this script, so accepting the prompt
    // is safe here; the production run records its trust decision up front.
    let sawTrustPrompt = false;
    let tuiText = "";
    const sendTuiText = async (text: string, stage: string) => {
      try {
        await rpc?.request("process/writeStdin", {
          processHandle: "smoke-tui",
          deltaBase64: Buffer.from(text).toString("base64"),
        });
        debugTui(`writeStdin ok stage=${stage}`);
      } catch (error) {
        debugTui(`writeStdin failed stage=${stage} error=${error instanceof Error ? error.message : "unknown"}`);
        throw error;
      }
    };
    const stopTuiInteraction = rpc.subscribe((method, params) => {
      if (method !== "process/outputDelta" || record(params)?.processHandle !== "smoke-tui") return;
      tuiText = `${tuiText}${outputText(params)}`.slice(-262_144);
      const visibleText = strippedTerminalText(tuiText);
      if (process.env.CODEX_TUI_SMOKE_DEBUG === "1") {
        console.error(`[codex-tui-smoke-debug] ${JSON.stringify(strippedTerminalText(tuiText))}`);
      }
      if (!sawUpdatePrompt && /Update available|Press enter to continue/u.test(tuiText)) {
        sawUpdatePrompt = true;
        void sendTuiText("3\r", "update-skip").catch(() => undefined);
        return;
      }
      if (!sawTrustPrompt && /Trust this folder/u.test(visibleText)) {
        sawTrustPrompt = true;
        void sendTuiText("1\r", "trust-folder").catch(() => undefined);
        return;
      }
      // The composer placeholder has changed across Codex releases ("Ask Codex
      // to do anything" / "describe a task"). Anchor on the resumed turn being
      // painted instead, so a copy change cannot masquerade as a stuck TUI.
      if (!sentPrompt && /Bootstrap\s*this\s*thread/u.test(visibleText) && /READY/u.test(visibleText)) {
        sentPrompt = true;
        void (async () => {
          await new Promise((resolve) => setTimeout(resolve, 750));
          await sendTuiText("HUMANTHREAD_TUI_SMOKE reply exactly TUI_SMOKE_OK", "prompt");
          await new Promise((resolve) => setTimeout(resolve, 250));
          await sendTuiText("\r", "submit");
        })().catch(() => undefined);
      }
    });
    await waitFor(rpc, () => sentPrompt, 30_000, "TUI readiness");
    stopTuiInteraction();
    const responseDeadline = Date.now() + 60_000;
    let threadRead: unknown = null;
    while (Date.now() < responseDeadline) {
      threadRead = await rpc.request("thread/read", { threadId, includeTurns: true });
      try {
        assertSmokeOutput({
          threadRead,
          methodCalls: rpc.methods,
          spawnCommand: [executable, "resume", threadId, "--remote", endpoint, "--cd", workspace],
          outputTail: tuiText,
          threadStartParams,
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    try {
      assertSmokeOutput({
        threadRead,
        methodCalls: rpc.methods,
        spawnCommand: [executable, "resume", threadId, "--remote", endpoint, "--cd", workspace],
        outputTail: tuiText,
        threadStartParams,
      });
    } catch (error) {
      throw new Error("Codex TUI smoke timed out during TUI response", { cause: error });
    }
    const finalRead = await rpc.request("thread/read", { threadId, includeTurns: true });
    try {
      assertSmokeOutput({ threadRead: finalRead, methodCalls: rpc.methods, threadStartParams });
    } catch (error) {
      const debug = record(await rpc.request("thread/read", { threadId, includeTurns: true }));
      const turns = record(debug?.thread)?.turns;
      console.error("[codex-tui-smoke] final turn summary", JSON.stringify(
        Array.isArray(turns)
          ? turns.map((turn) => {
            const value = record(turn);
            const items = Array.isArray(value?.items) ? value.items : [];
            return {
              status: value?.status,
              items: items.map((item) => {
                const entry = record(item);
                return { type: entry?.type, text: typeof entry?.text === "string" ? entry.text.slice(0, 80) : undefined };
              }),
            };
          })
          : [],
      ));
      throw error;
    }

    const secondSpawn = record(await rpc.request("process/spawn", {
      command: [
        executable,
        "resume",
        threadId,
        "--remote",
        endpoint,
        "--cd",
        workspace,
      ],
      processHandle: "smoke-tui-second",
      cwd: workspace,
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      outputBytesCap: 1024 * 1024,
      timeoutMs: null,
      env: {
        CODEX_HOME: codeHome,
        OPENAI_API_KEY: null,
        OPENAI_BASE_URL: null,
        TERM: "xterm-256color",
      },
      size: { rows: 40, cols: 120 },
    }));
    void secondSpawn;
    const secondRead = record(await rpc.request("thread/read", { threadId }));
    const secondThread = record(secondRead?.thread);
    if (secondThread?.id !== threadId) throw new Error("Codex TUI smoke re-attached a different thread");
    await rpc.request("process/writeStdin", {
      processHandle: "smoke-tui-second",
      deltaBase64: Buffer.from("/quit\r").toString("base64"),
    }).catch(() => undefined);
    await rpc.request("process/kill", { processHandle: "smoke-tui" }).catch(() => undefined);
    await rpc.request("process/kill", { processHandle: "smoke-tui-second" }).catch(() => undefined);
    await rpc.request("thread/read", { threadId });
    console.log(`[codex-tui-smoke] daemon=ready thread=${threadId.slice(0, 12)} attach=ok history=ok cleanup=ok`);
  } finally {
    rpc?.close();
    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        child?.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    for (let attempt = 0; attempt < 5 && existsSync(root); attempt += 1) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(`[codex-tui-smoke] failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
