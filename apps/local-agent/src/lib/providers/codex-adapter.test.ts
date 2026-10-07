import { describe, expect, it, vi } from "vitest";
import { createCodexAdapter } from "./codex-adapter";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
}

describe("Codex provider adapter", () => {
  const executionPolicy = {
    mode: "workspace_full" as const,
    workspaceRealpath: "/Volumes/code/repo",
  };

  const resolveNativePath = vi.fn(async (workspaceRoot: string, requestedPath: string) => ({
    workspaceRealpath: "/Volumes/code/repo",
    targetRealpath: requestedPath === workspaceRoot
      ? "/Volumes/code/repo"
      : "/Volumes/code/repo/.humanthread/result.json",
    contained: true,
  }));

  it("projects the full project Schema to Codex's supported structured-output subset", () => {
    const fullSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Task result",
      type: "object",
      additionalProperties: false,
      required: ["evidence", "status"],
      properties: {
        status: { type: "string", minLength: 1, maxLength: 32, pattern: "^[A-Z]+$" },
        evidence: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: { type: "string", minLength: 1, format: "uri-reference" },
        },
      },
    };

    const adapter = createCodexAdapter({ spawn: vi.fn(), resolveNativePath });
    const projected = adapter.projectStructuredOutputSchema?.(fullSchema);

    expect(projected).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["evidence", "status"],
      properties: {
        status: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
      },
    });
    expect(fullSchema.properties.evidence).toHaveProperty("uniqueItems", true);
    expect(fullSchema.properties.status).toHaveProperty("pattern", "^[A-Z]+$");
  });

  it("normalizes JSONL lifecycle and structured completion", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: [
        '{"type":"thread.started","thread_id":"thread_1"}\n',
        '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n',
        '{"type":"turn.completed","usage":{"input_tokens":10},"result":{"summary":"done"}}\n',
      ],
      stderr: [],
      wait: vi.fn().mockResolvedValue({ code: 0, signal: null }),
      cancel: vi.fn(),
    });
    const adapter = createCodexAdapter({ spawn, resolveNativePath });
    const events = await collect(adapter.start({ cwd: "/repo-link", prompt: "Implement", resultSchemaPath: "/repo-link/.humanthread/result.json", executionPolicy }));
    expect(spawn).toHaveBeenCalledWith("codex", [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--config",
      'model_reasoning_effort="high"',
      "--output-schema",
      "/Volumes/code/repo/.humanthread/result.json",
      "Implement",
    ], expect.objectContaining({ cwd: "/Volumes/code/repo" }));
    expect(spawn.mock.calls[0]?.[1]).not.toContain("--sandbox");
    expect(events.map((event) => event.type)).toEqual(["run.started", "agent.message.completed", "run.completed"]);
    expect(events[0]).toMatchObject({ providerSessionId: "thread_1" });
  });

  it("adds an explicitly selected model as a separate argv value", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: [],
      stderr: [],
      wait: vi.fn().mockResolvedValue({ code: 0, signal: null }),
      cancel: vi.fn(),
    });
    const adapter = createCodexAdapter({ spawn, resolveNativePath });

    await collect(adapter.start({
      cwd: "/repo-link",
      prompt: "Implement",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
      model: "custom coder/v3",
      environmentOverrides: { OPENAI_BASE_URL: "https://models.example.com/v1" },
      credentialContext: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user-1",
        credentialRef: "0123456789abcdef0123456789abcdef",
      },
    }));

    expect(spawn).toHaveBeenCalledWith("codex", [
      "exec",
      "--config",
      'model_provider="humanthread_local"',
      "--config",
      'model_providers.humanthread_local.name="HumanThread Desktop"',
      "--config",
      'model_providers.humanthread_local.base_url="https://models.example.com/v1"',
      "--config",
      'model_providers.humanthread_local.env_key="OPENAI_API_KEY"',
      "--config",
      'model_providers.humanthread_local.wire_api="responses"',
      "--config",
      "model_providers.humanthread_local.requires_openai_auth=false",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "custom coder/v3",
      "--config",
      'model_reasoning_effort="high"',
      "--output-schema",
      "/Volumes/code/repo/.humanthread/result.json",
      "Implement",
    ], expect.objectContaining({
      cwd: "/Volumes/code/repo",
      environmentOverrides: { OPENAI_BASE_URL: "https://models.example.com/v1" },
      credentialContext: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user-1",
        credentialRef: "0123456789abcdef0123456789abcdef",
      },
    }));
  });

  it("keeps the selected model position consistent across structured execution and resume", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: [],
      stderr: [],
      wait: vi.fn().mockResolvedValue({ code: 0, signal: null }),
      cancel: vi.fn(),
    });
    const adapter = createCodexAdapter({ spawn, resolveNativePath });

    await collect(adapter.executeStructured({
      cwd: "/repo-link",
      prompt: "Choose the next node",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
      mode: "stage",
      model: "gpt-5.6-sol",
      environmentOverrides: { OPENAI_BASE_URL: "https://models.example.com/v1" },
    }));
    await collect(adapter.resume({
      cwd: "/repo-link",
      prompt: "Continue",
      providerSessionId: "thread_1",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: executionPolicy.workspaceRealpath },
      model: "gpt-5.6-sol",
      environmentOverrides: { OPENAI_BASE_URL: "https://models.example.com/v1" },
    }));

    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "exec",
      "--config",
      'model_provider="humanthread_local"',
      "--config",
      'model_providers.humanthread_local.name="HumanThread Desktop"',
      "--config",
      'model_providers.humanthread_local.base_url="https://models.example.com/v1"',
      "--config",
      'model_providers.humanthread_local.env_key="OPENAI_API_KEY"',
      "--config",
      'model_providers.humanthread_local.wire_api="responses"',
      "--config",
      "model_providers.humanthread_local.requires_openai_auth=false",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="high"',
      "--output-schema",
      "/Volumes/code/repo/.humanthread/result.json",
      "Choose the next node",
    ]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      "exec",
      "--config",
      'model_provider="humanthread_local"',
      "--config",
      'model_providers.humanthread_local.name="HumanThread Desktop"',
      "--config",
      'model_providers.humanthread_local.base_url="https://models.example.com/v1"',
      "--config",
      'model_providers.humanthread_local.env_key="OPENAI_API_KEY"',
      "--config",
      'model_providers.humanthread_local.wire_api="responses"',
      "--config",
      "model_providers.humanthread_local.requires_openai_auth=false",
      "--sandbox",
      "read-only",
      "resume",
      "thread_1",
      "--json",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="high"',
      "--output-schema",
      "/Volumes/code/repo/.humanthread/result.json",
      "Continue",
    ]);
  });

  it("passes one explicit reasoning effort to fresh, resume, and structured Codex executions", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: [],
      stderr: [],
      wait: vi.fn().mockResolvedValue({ code: 0, signal: null }),
      cancel: vi.fn(),
    });
    const adapter = createCodexAdapter({ spawn, resolveNativePath });
    const common = {
      cwd: "/repo-link",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh" as const,
      environmentOverrides: { OPENAI_BASE_URL: "https://models.example.com/v1" },
    };

    await collect(adapter.start({ ...common, prompt: "Fresh" }));
    await collect(adapter.resume({ ...common, prompt: "Resume", providerSessionId: "thread_1" }));
    await collect(adapter.executeStructured({ ...common, prompt: "Structured fresh", mode: "stage" }));
    await collect(adapter.executeStructured({ ...common, prompt: "Structured resume", mode: "stage", providerSessionId: "thread_1" }));

    expect(spawn).toHaveBeenCalledTimes(4);
    for (const [, args] of spawn.mock.calls) {
      expect(args.filter((value: string) => value === "--config")).toContain("--config");
      expect(args.filter((value: string) => value === 'model_reasoning_effort="xhigh"')).toHaveLength(1);
    }
  });

  it.each([
    "https://user:password@models.example.com/v1",
    "https://models.example.com/v1?route=openai",
    "https://models.example.com/v1#openai",
  ])("rejects an unsafe selected model site URL: %s", async (baseUrl) => {
    const adapter = createCodexAdapter({ spawn: vi.fn(), resolveNativePath });

    await expect(collect(adapter.start({
      cwd: "/repo-link",
      prompt: "Implement",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
      model: "gpt-5.6-sol",
      environmentOverrides: { OPENAI_BASE_URL: baseUrl },
    }))).rejects.toMatchObject({ code: "local_model_invalid" });
  });

  it("uses the final structured agent message as the completed turn result", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: [
        '{"type":"thread.started","thread_id":"thread_1"}\n',
        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"done\\"}"}}\n',
        '{"type":"turn.completed","usage":{"input_tokens":10}}\n',
      ],
      stderr: [],
      wait: vi.fn().mockResolvedValue({ code: 0, signal: null }),
      cancel: vi.fn(),
    });
    const adapter = createCodexAdapter({ spawn, resolveNativePath });

    const events = await collect(adapter.start({
      cwd: "/repo-link",
      prompt: "Implement",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
    }));

    expect(events.at(-1)).toEqual({
      type: "run.completed",
      result: { summary: "done" },
      usage: { input_tokens: 10 },
    });
  });

  it("applies the same full authority when resuming a Codex session", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: [],
      stderr: [],
      wait: vi.fn().mockResolvedValue({ code: 0, signal: null }),
      cancel: vi.fn(),
    });
    const adapter = createCodexAdapter({ spawn, resolveNativePath });

    await collect(adapter.resume({
      cwd: "/repo-link",
      prompt: "Continue",
      providerSessionId: "thread_1",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
    }));

    expect(spawn).toHaveBeenCalledWith("codex", [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "resume",
      "thread_1",
      "--json",
      "--config",
      'model_reasoning_effort="high"',
      "--output-schema",
      "/Volumes/code/repo/.humanthread/result.json",
      "Continue",
    ], expect.objectContaining({ cwd: "/Volumes/code/repo" }));
    expect(spawn.mock.calls[0]?.[1]).not.toContain("--sandbox");
  });

  it("forces structured router execution to read-only while retaining the output Schema", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: [],
      stderr: [],
      wait: vi.fn().mockResolvedValue({ code: 0, signal: null }),
      cancel: vi.fn(),
    });
    const adapter = createCodexAdapter({ spawn, resolveNativePath });

    await collect(adapter.executeStructured({
      cwd: "/repo-link",
      prompt: "Choose the next node",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
      mode: "router",
    }));

    expect(spawn).toHaveBeenCalledWith("codex", [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--config",
      'model_reasoning_effort="high"',
      "--output-schema",
      "/Volumes/code/repo/.humanthread/result.json",
      "Choose the next node",
    ], expect.objectContaining({ cwd: "/Volumes/code/repo" }));
    expect(spawn.mock.calls[0]?.[1]).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("turns malformed JSON into provider failure", async () => {
    const adapter = createCodexAdapter({ spawn: vi.fn().mockReturnValue({ stdout: ["not-json\n"], stderr: [], wait: vi.fn().mockResolvedValue({ code: 1, signal: null }), cancel: vi.fn() }), resolveNativePath });
    const events = await collect(adapter.start({ cwd: "/repo-link", prompt: "Implement", resultSchemaPath: "/repo-link/.humanthread/result.json", executionPolicy }));
    expect(events[0]).toMatchObject({ type: "run.failed", errorCode: "provider_protocol_error" });
  });

  it("preserves the nested Codex turn failure message", async () => {
    const adapter = createCodexAdapter({
      spawn: vi.fn().mockReturnValue({
        stdout: [
          '{"type":"turn.failed","error":{"message":"unexpected status 502 Bad Gateway: Upstream request failed"}}\n',
        ],
        stderr: [],
        wait: vi.fn().mockResolvedValue({ code: 1, signal: null }),
        cancel: vi.fn(),
      }),
      resolveNativePath,
    });

    const events = await collect(adapter.executeStructured({
      cwd: "/repo-link",
      prompt: "Choose the next node",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
      mode: "router",
    }));

    expect(events[0]).toEqual({
      type: "run.failed",
      errorCode: "provider_error",
      message: "unexpected status 502 Bad Gateway: Upstream request failed",
    });
  });

  it("reports native spawn failures instead of labelling them as an unknown signal", async () => {
    const adapter = createCodexAdapter({
      spawn: vi.fn().mockReturnValue({
        stdout: [],
        stderr: ["Codex arguments are invalid\n"],
        wait: vi.fn().mockResolvedValue({ code: null, signal: "spawn_failed" }),
        cancel: vi.fn(),
      }),
      resolveNativePath,
    });

    const events = await collect(adapter.start({
      cwd: "/repo-link",
      prompt: "Implement",
      resultSchemaPath: "/repo-link/.humanthread/result.json",
      executionPolicy,
    }));

    expect(events).toContainEqual({
      type: "run.failed",
      errorCode: "provider_error",
      message: "Codex arguments are invalid",
    });
  });

  it("does not spawn Codex when the result Schema escapes the Workspace", async () => {
    const spawn = vi.fn();
    const adapter = createCodexAdapter({
      spawn,
      resolveNativePath: vi.fn()
        .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: "/Volumes/code/repo", contained: true })
        .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: "/Users/alice/schema.json", contained: false }),
    });

    await expect(collect(adapter.start({
      cwd: "/repo-link",
      prompt: "Implement",
      resultSchemaPath: "/repo-link/schema-link.json",
      executionPolicy,
    }))).rejects.toMatchObject({ code: "workspace_scope_denied" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not spawn Codex when execution is cancelled during native path resolution", async () => {
    const spawn = vi.fn();
    const controller = new AbortController();
    let releaseResolution: (() => void) | undefined;
    const resolutionReady = new Promise<void>((resolve) => { releaseResolution = resolve; });
    const adapter = createCodexAdapter({
      spawn,
      resolveNativePath: vi.fn(async (workspaceRoot, requestedPath) => {
        await resolutionReady;
        return {
          workspaceRealpath: "/Volumes/code/repo",
          targetRealpath: requestedPath === workspaceRoot
            ? "/Volumes/code/repo"
            : "/Volumes/code/repo/result.json",
          contained: true,
        };
      }),
    });
    const running = collect(adapter.start({
      cwd: "/repo-link",
      prompt: "Implement",
      resultSchemaPath: "/repo-link/result.json",
      executionPolicy,
      signal: controller.signal,
    }));

    controller.abort();
    releaseResolution?.();
    await running;

    expect(spawn).not.toHaveBeenCalled();
  });
});
