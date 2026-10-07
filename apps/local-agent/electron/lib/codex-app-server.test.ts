import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  boundedErrorMessage,
  buildServerResponse,
  CodexAppServerRegistry,
  sanitizeEnvironmentRefs,
  validateJsonRpcLine,
} from "./codex-app-server";
import type {
  CodexAppServerTransport,
  CodexAppServerTransportKind,
} from "./codex-app-server-transport";

describe("codex app-server JSON-RPC boundary", () => {
  it("accepts requests, responses and notifications", () => {
    expect(validateJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }))).toBeTruthy();
    expect(validateJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", method: "turn/started", params: {} }))).toBeTruthy();
    expect(validateJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }))).toBeTruthy();
  });

  it("rejects mixed request/response shapes and oversized messages", () => {
    expect(() =>
      validateJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", result: {} })),
    ).toThrow("Codex app-server message cannot be both a request and a response");
    expect(() => validateJsonRpcLine(JSON.stringify({ jsonrpc: "1.0", id: 1, result: {} }))).toThrow(
      "Codex app-server message has an unsupported JSON-RPC version",
    );
    expect(() => validateJsonRpcLine("x".repeat(4 * 1024 * 1024 + 1))).toThrow(
      "Codex app-server message size exceeds the limit",
    );
  });

  it("builds validated server responses", () => {
    expect(buildServerResponse(1, { ok: true }, undefined)).toBe(
      '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
    );
    expect(() => buildServerResponse(1, { ok: true }, { code: -1, message: "boom" })).toThrow(
      "Codex app-server response is invalid",
    );
    expect(() => buildServerResponse(1, undefined, undefined)).toThrow(
      "Codex app-server response is invalid",
    );
  });

  it("redacts credential-shaped tokens and bounds the message", () => {
    const redacted = boundedErrorMessage("failed token=super-secret authorization=bearer-value");
    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("bearer-value");
    expect(redacted).toContain("token=[redacted]");
    expect(boundedErrorMessage("x".repeat(1_000)).length).toBe(512);
  });

  it("strips independent credential environment references for isolated executions", () => {
    expect(
      sanitizeEnvironmentRefs(["CODEX_HOME", "OPENAI_API_KEY", "HTTPS_PROXY"], true),
    ).toEqual(["HTTPS_PROXY"]);
    expect(
      sanitizeEnvironmentRefs(["CODEX_HOME", "OPENAI_API_KEY"], false),
    ).toEqual(["CODEX_HOME", "OPENAI_API_KEY"]);
  });
});

function fakeChild() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill(): boolean;
  };
  child.pid = 4242;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

class FakeTransport implements CodexAppServerTransport {
  readonly kind: Exclude<CodexAppServerTransportKind, "stdio"> = "websocket";
  readonly endpoint: string;
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly messages = new Set<(line: string) => void>();
  private readonly closes = new Set<(error: Error | null) => void>();

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async ready(): Promise<void> {}

  async write(line: string): Promise<void> {
    const message = JSON.parse(line) as Record<string, unknown>;
    this.sent.push(message);
    const id = message.id;
    if (typeof id === "number" && typeof message.method === "string") {
      const result = message.method === "process/spawn"
        ? undefined
        : { userAgent: "codex-cli 0.154.0" };
      const response = message.method === "process/spawn"
        ? { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } }
        : { jsonrpc: "2.0", id, result };
      queueMicrotask(() => this.emit(JSON.stringify(response)));
    }
  }

  async close(): Promise<void> {}

  onMessage(handler: (line: string) => void): () => void {
    this.messages.add(handler);
    return () => this.messages.delete(handler);
  }

  onClose(handler: (error: Error | null) => void): () => void {
    this.closes.add(handler);
    return () => this.closes.delete(handler);
  }

  emit(line: string): void {
    for (const handler of this.messages) handler(line);
  }
}

describe("Codex app-server daemon registry", () => {
  it("waits for the actual endpoint and exposes the transport state", async () => {
    const child = fakeChild();
    const transport = new FakeTransport("ws://127.0.0.1:63570");
    const registry = new CodexAppServerRegistry({
      send: vi.fn(),
      spawn: (() => child) as never,
      resolveExecutable: () => "/fake/codex",
      transportFactory: () => transport,
    });

    const start = registry.start({
      processKey: "codex:test",
      cwd: process.cwd(),
      executable: "codex",
      transport: "websocket",
    });
    expect(start).toMatchObject({
      transport: "websocket",
      status: "starting",
    });
    child.stdout.write("codex app-server (WebSockets)\n  listening on: ws://127.0.0.1:63570\n");
    await expect(registry.request("codex:test", "initialize", {})).resolves.toEqual({
      userAgent: "codex-cli 0.154.0",
    });
    expect(registry.state("codex:test")).toMatchObject({
      transport: "websocket",
      endpoint: "ws://127.0.0.1:63570",
      status: "ready",
      protocolVersion: "codex-cli 0.154.0",
    });
    expect(transport.sent[0]).toMatchObject({ method: "initialize" });
  });

  it("fails capability probe closed when process/spawn is unsupported", async () => {
    const child = fakeChild();
    const registry = new CodexAppServerRegistry({
      send: vi.fn(),
      spawn: (() => child) as never,
      resolveExecutable: () => "/fake/codex",
      transportFactory: () => new FakeTransport("ws://127.0.0.1:63570"),
    });
    registry.start({
      processKey: "codex:test",
      cwd: process.cwd(),
      executable: "codex",
      transport: "websocket",
    });
    child.stdout.write("listening on: ws://127.0.0.1:63570\n");
    await registry.request("codex:test", "initialize", {});

    await expect(registry.probeCapabilities("codex:test", "codex")).rejects.toMatchObject({
      code: "provider_tui_unsupported",
    });
  }, 10_000);
});
