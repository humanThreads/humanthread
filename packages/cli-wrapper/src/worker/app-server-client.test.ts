import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { createCodexAppServerClient } from "./app-server-client";

function fakeChild() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    stdin,
    stdout,
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  const messages: Array<Record<string, unknown>> = [];
  stdin.on("data", (chunk: Buffer) => {
    const message = JSON.parse(chunk.toString("utf8"));
    messages.push(message);
    if (message.id !== undefined) {
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n`);
    }
  });
  return Object.assign(child, { messages });
}

describe("Codex app-server Worker client", () => {
  it("advertises the experimental capability required by the attachable TUI PTY", async () => {
    const child = fakeChild();
    const client = createCodexAppServerClient({
      spawn: vi.fn().mockReturnValue(child),
      createDirectory: vi.fn().mockResolvedValue(undefined),
    });

    await client.start({
      cwd: "/workspace/task",
      codexHome: "/workspace/codex-home",
      endpoint: "https://configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
    });

    expect(child.messages[0]).toMatchObject({
      method: "initialize",
      params: { capabilities: { experimentalApi: true, requestAttestation: false } },
    });
  });

  it("creates a private task Codex home before spawning app-server", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "humanthread-codex-home-"));
    const codexHome = join(parentDirectory, "task-codex-home");
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const client = createCodexAppServerClient({ spawn, ambientEnvironment: { PATH: "/usr/bin" } });

    try {
      await client.start({
        cwd: "/workspace/task",
        codexHome,
        endpoint: "https://configured.example.com/v1",
        apiKey: "configured-key",
        model: "configured-model",
        reasoningEffort: "high",
      });

      expect(existsSync(codexHome)).toBe(true);
      expect((await stat(codexHome)).mode & 0o077).toBe(0);
      expect(spawn).toHaveBeenCalledOnce();
    } finally {
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });

  it("starts app-server with only the explicit assignment model configuration", async () => {
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const createDirectory = vi.fn().mockResolvedValue(undefined);
    const client = createCodexAppServerClient({ spawn, ambientEnvironment: {
      PATH: "/usr/bin",
      HOME: "/ambient-home",
      CODEX_HOME: "/ambient-codex",
      OPENAI_API_KEY: "ambient-key",
      OPENAI_BASE_URL: "https://ambient.example.com/v1",
      CODEX_MODEL: "ambient-model",
    }, createDirectory });

    await client.start({
      cwd: "/workspace/task",
      codexHome: "/workspace/codex-home",
      endpoint: "https://configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
    });

    expect(spawn).toHaveBeenCalledWith("codex", [
      "app-server",
      "--stdio",
      "--config", 'model_provider="humanthread_linux_worker"',
      "--config", 'model_providers.humanthread_linux_worker.name="HumanThread Linux Worker"',
      "--config", 'model_providers.humanthread_linux_worker.base_url="https://configured.example.com/v1"',
      "--config", 'model_providers.humanthread_linux_worker.env_key="OPENAI_API_KEY"',
      "--config", 'model_providers.humanthread_linux_worker.wire_api="responses"',
      "--config", "model_providers.humanthread_linux_worker.requires_openai_auth=false",
      "--config", "check_for_update_on_startup=false",
      "--config", 'model_reasoning_summary="none"',
      "--config", 'model_providers.humanthread_linux_worker.env_http_headers={ "x-opencode-session" = "HT_OPENCODE_SESSION" }',
    ], expect.objectContaining({
      cwd: "/workspace/task",
      env: expect.objectContaining({
        HOME: "/workspace/codex-home",
        CODEX_HOME: "/workspace/codex-home",
        OPENAI_BASE_URL: "https://configured.example.com/v1",
        OPENAI_API_KEY: "configured-key",
        CODEX_MODEL: "configured-model",
        CODEX_REASONING_EFFORT: "high",
      }),
    }));
    const environment = spawn.mock.calls[0]?.[2]?.env as Record<string, string>;
    expect(createDirectory).toHaveBeenCalledWith("/workspace/codex-home", { recursive: true, mode: 0o700 });
    expect(environment).not.toHaveProperty("OPENAI_ORGANIZATION");
    expect(environment.OPENAI_API_KEY).not.toBe("ambient-key");
    expect(environment.CODEX_HOME).not.toBe("/ambient-codex");
    expect(child.messages.find((message) => message.method === "initialized")).toEqual({ jsonrpc: "2.0", method: "initialized" });
  });

  it("writes only the leased checklist MCP server into the isolated Codex home", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "humanthread-codex-mcp-"));
    const codexHome = join(parentDirectory, "task-codex-home");
    const child = fakeChild();
    const client = createCodexAppServerClient({ spawn: vi.fn().mockReturnValue(child) });

    try {
      await client.start({
        cwd: "/workspace/task",
        codexHome,
        endpoint: "https://configured.example.com/v1",
        apiKey: "configured-key",
        model: "configured-model",
        reasoningEffort: "high",
        checklistMcp: {
          url: "https://platform.example.com/api/worker-pools/assignments/agent_run_1/checklist-mcp",
          headers: { "x-worker-pool-session": "htwps_session", "x-humanthread-worker-pool": "a".repeat(32) },
        },
      });

      const config = await readFile(join(codexHome, "config.toml"), "utf8");
      expect(config).toContain("[mcp_servers.humanthread_checklist]");
      expect(config).toContain('url = "https://platform.example.com/api/worker-pools/assignments/agent_run_1/checklist-mcp"');
      expect(config).toContain('"x-worker-pool-session" = "htwps_session"');
      expect(config).not.toContain("configured-key");
    } finally {
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });

  it("forwards the scoped Git credential environment into the Worker sandbox", async () => {
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const createDirectory = vi.fn().mockResolvedValue(undefined);
    const client = createCodexAppServerClient({ spawn, ambientEnvironment: {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "ambient-key",
      OPENAI_BASE_URL: "https://ambient.example.com/v1",
      CODEX_MODEL: "ambient-model",
      GIT_ASKPASS: "/ambient/askpass",
      HT_GIT_TOKEN: "ambient-token",
    }, createDirectory });

    await client.start({
      cwd: "/workspace/task",
      codexHome: "/workspace/codex-home",
      endpoint: "https://configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
      gitEnvironment: {
        GIT_ASKPASS: "/state/git-askpass.sh",
        GIT_CONFIG_GLOBAL: "/state/gitconfig",
        GIT_TERMINAL_PROMPT: "0",
        HT_GIT_USERNAME: "worker-user",
        HT_GIT_TOKEN: "configured-git-token",
        OPENAI_API_KEY: "spoofed-model-key",
        CODEX_MODEL: "spoofed-model",
      },
    });

    const environment = spawn.mock.calls[0]?.[2]?.env as Record<string, string>;
    expect(environment).toMatchObject({
      GIT_ASKPASS: "/state/git-askpass.sh",
      GIT_CONFIG_GLOBAL: "/state/gitconfig",
      GIT_TERMINAL_PROMPT: "0",
      HT_GIT_USERNAME: "worker-user",
      HT_GIT_TOKEN: "configured-git-token",
    });
    expect(environment).not.toHaveProperty("GIT_CONFIG_COUNT");
    expect(environment.OPENAI_API_KEY).toBe("configured-key");
    expect(environment.CODEX_MODEL).toBe("configured-model");
  });

  it("forwards project-managed runtime environment values without allowing reserved provider overrides", async () => {
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const client = createCodexAppServerClient({ spawn, ambientEnvironment: { PATH: "/usr/bin" }, createDirectory: vi.fn().mockResolvedValue(undefined) });

    await client.start({
      cwd: "/workspace/task",
      codexHome: "/workspace/codex-home",
      endpoint: "https://configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
      runtimeEnvironment: { HT_GIT_USERNAME: "git-user", HT_GIT_SECRET: "git-secret", OPENAI_API_KEY: "spoofed" },
    });

    const environment = spawn.mock.calls[0]?.[2]?.env as Record<string, string>;
    expect(environment).toMatchObject({ HT_GIT_USERNAME: "git-user", HT_GIT_SECRET: "git-secret", OPENAI_API_KEY: "configured-key" });
  });

  it("rejects an invalid custom model site before spawning app-server", async () => {
    const spawn = vi.fn();
    const client = createCodexAppServerClient({ spawn, createDirectory: vi.fn().mockResolvedValue(undefined) });

    await expect(client.start({
      cwd: "/workspace/task",
      codexHome: "/workspace/codex-home",
      endpoint: "https://worker:secret@configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
    })).rejects.toMatchObject({ code: "configuration_required" });

    expect(spawn).not.toHaveBeenCalled();
  });

  it("times out a non-responsive app-server initialization and terminates the child", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      pid: 42,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    const client = createCodexAppServerClient({
      spawn: vi.fn().mockReturnValue(child),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      requestTimeoutMs: 25,
    });
    const settled = vi.fn();
    void client.start({
      cwd: "/workspace/task",
      codexHome: "/workspace/codex-home",
      endpoint: "https://configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
    }).catch(settled);

    await vi.advanceTimersByTimeAsync(25);

    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: "provider_start_timeout" }));
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    vi.useRealTimers();
  });

  it("preserves structured JSON-RPC provider diagnostics", async () => {
    const child = fakeChild();
    child.stdin.removeAllListeners("data");
    child.stdin.on("data", (chunk: Buffer) => {
      const message = JSON.parse(chunk.toString("utf8"));
      if (message.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n`);
        return;
      }
      child.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: 429, message: "rate limit", type: "rate_limit_exceeded", requestId: "req_123", httpStatus: 429 },
      })}\n`);
    });
    const client = createCodexAppServerClient({ spawn: vi.fn().mockReturnValue(child), createDirectory: vi.fn().mockResolvedValue(undefined) });

    await client.start({
      cwd: "/workspace/task",
      codexHome: "/workspace/codex-home",
      endpoint: "https://configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
    });

    await expect(client.request("turn/start", {})).rejects.toMatchObject({
      code: "provider_error",
      providerDiagnostic: {
        code: 429,
        message: "rate limit",
        type: "rate_limit_exceeded",
        requestId: "req_123",
        httpStatus: 429,
      },
    });
    await client.stop();
  });

  it("exposes the assignment conversation id to OpenCode-compatible gateways", async () => {
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const client = createCodexAppServerClient({ spawn, createDirectory: vi.fn().mockResolvedValue(undefined) });

    await client.start({
      cwd: "/workspace/task",
      codexHome: "/workspace/codex-home",
      endpoint: "https://configured.example.com/v1",
      apiKey: "configured-key",
      model: "configured-model",
      reasoningEffort: "high",
      sessionId: "5f70861591303fd7e0f4d4e2357d74abb35cd07a5519c604ae8d0ba68eca7364",
    });

    const environment = spawn.mock.calls[0]?.[2]?.env as Record<string, string>;
    expect(environment.HT_OPENCODE_SESSION).toBe("5f70861591303fd7e0f4d4e2357d74abb35cd07a5519c604ae8d0ba68eca7364");
  });

  it("writes codex-models.json and selects it from config.toml", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "humanthread-codex-catalog-"));
    const codexHome = join(parentDirectory, "task-codex-home");
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const readBundledModelCatalog = vi.fn().mockResolvedValue(JSON.stringify({
      models: [{ slug: "relay-model", tool_mode: "code_mode_only", use_responses_lite: true, context_window: 128_000 }],
    }));
    const client = createCodexAppServerClient({ spawn, readBundledModelCatalog });

    try {
      await client.start({
        cwd: "/workspace/task",
        codexHome,
        endpoint: "https://configured.example.com/v1",
        apiKey: "configured-key",
        model: "relay-model",
        reasoningEffort: "high",
      });

      expect(readBundledModelCatalog).toHaveBeenCalledWith("codex", codexHome);
      const catalogPath = join(codexHome, "codex-models.json");
      const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { models: Array<Record<string, unknown>> };
      expect(catalog.models[0]).toMatchObject({
        slug: "relay-model",
        tool_mode: "direct",
        use_responses_lite: false,
        supports_reasoning_summary_parameter: false,
        default_reasoning_summary: "none",
      });
      const config = await readFile(join(codexHome, "config.toml"), "utf8");
      expect(config).toContain(`model_catalog_json = ${JSON.stringify(catalogPath)}`);
      expect(config).toContain('model_reasoning_summary = "none"');
      expect(spawn).toHaveBeenCalledWith("codex", expect.arrayContaining([
        "--config",
        `model_catalog_json=${JSON.stringify(catalogPath)}`,
      ]), expect.anything());
    } finally {
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });

  it("generates the selected relayed model when the bundled catalog omits it", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "humanthread-codex-catalog-"));
    const codexHome = join(parentDirectory, "task-codex-home");
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const readBundledModelCatalog = vi.fn().mockResolvedValue(JSON.stringify({
      models: [{
        slug: "other-model",
        display_name: "Other Model",
        description: "Bundled template.",
        default_reasoning_level: "medium",
        supported_reasoning_levels: [{ effort: "medium", description: "Balanced" }],
        shell_type: "unified_exec",
        visibility: "list",
        supported_in_api: true,
        priority: 12,
        tool_mode: null,
        use_responses_lite: false,
        model_messages: { instructions_template: "You are Codex." },
      }],
    }));
    const client = createCodexAppServerClient({ spawn, readBundledModelCatalog });

    try {
      await client.start({
        cwd: "/workspace/task",
        codexHome,
        endpoint: "https://configured.example.com/v1",
        apiKey: "configured-key",
        model: "relay-model",
        reasoningEffort: "high",
      });

      const args = spawn.mock.calls[0]?.[1] as string[];
      const catalogPath = join(codexHome, "codex-models.json");
      const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { models: Array<Record<string, unknown>> };
      expect(catalog.models).toHaveLength(2);
      expect(catalog.models[1]).toMatchObject({
        slug: "relay-model",
        tool_mode: "direct",
        use_responses_lite: false,
        supports_reasoning_summary_parameter: false,
        default_reasoning_summary: "none",
      });
      expect(args).toContain(`model_catalog_json=${JSON.stringify(catalogPath)}`);
    } finally {
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });

  it("generates a fallback catalog when the bundled catalog cannot be read", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "humanthread-codex-catalog-"));
    const codexHome = join(parentDirectory, "task-codex-home");
    const child = fakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const readBundledModelCatalog = vi.fn().mockResolvedValue(null);
    const client = createCodexAppServerClient({ spawn, readBundledModelCatalog });

    try {
      await client.start({
        cwd: "/workspace/task",
        codexHome,
        endpoint: "https://configured.example.com/v1",
        apiKey: "configured-key",
        model: "relay-model",
        reasoningEffort: "high",
      });

      const catalogPath = join(codexHome, "codex-models.json");
      const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { models: Array<Record<string, unknown>> };
      expect(catalog.models[0]).toMatchObject({
        slug: "relay-model",
        tool_mode: "direct",
        use_responses_lite: false,
        supports_reasoning_summary_parameter: false,
        default_reasoning_summary: "none",
      });
      expect(await readFile(join(codexHome, "config.toml"), "utf8")).toContain(`model_catalog_json = ${JSON.stringify(catalogPath)}`);
    } finally {
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });
});
