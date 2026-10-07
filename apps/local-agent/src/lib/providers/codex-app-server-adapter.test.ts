import { describe, expect, it, vi } from "vitest";
import type { CodexAppServerNotification } from "./codex-app-server-client";
import type { CodexAppServerClient } from "./codex-app-server-client";
import { createCodexAppServerAdapter, waitForThreadQuiescence } from "./codex-app-server-adapter";

const state = {
  processKey: "codex:one",
  generation: 1,
  pid: 42,
  bindingFingerprint: "binding-1",
  model: "gpt-5.6-terra",
  reasoningEffort: "high",
  transport: "stdio" as const,
  protocolVersion: "codex-cli 0.159.2",
  status: "ready",
  lastNotificationAt: null,
  pendingRequestCount: 0,
  stderrSummary: null,
  lastErrorCode: null,
};

type FakeClient = ReturnType<typeof createFakeClient>;

function createFakeClient(options: {
  terminal?: "completed" | "failed" | "interrupted";
  includeTools?: boolean;
} = {}) {
  let notificationHandler: ((notification: CodexAppServerNotification) => void) | null = null;
  const requests: Array<{ method: string; params: unknown }> = [];
  const terminal = options.terminal ?? "completed";
  const starts: unknown[] = [];
  const emit = (method: string, params: unknown) => {
    notificationHandler?.({
      processKey: "codex:one",
      generation: 1,
      method,
      params,
      ...(method.endsWith("/requestApproval") ? { requestId: 7 } : {}),
      receivedAtMs: 1,
    });
  };
  const request = vi.fn(async (method: string, params: unknown) => {
    requests.push({ method, params });
    if (method === "thread/start" || method === "thread/resume") {
      return { thread: { id: "thread_1" } };
    }
    if (method === "turn/start") {
      if (options.includeTools) {
        emit("item/commandExecution/requestApproval", {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_approval",
          command: "git status",
        });
        emit("item/started", {
          threadId: "thread_1",
          turnId: "turn_1",
          startedAtMs: 1,
          item: { type: "commandExecution", id: "item_command", command: "git status" },
        });
        emit("item/completed", {
          threadId: "thread_1",
          turnId: "turn_1",
          completedAtMs: 2,
          item: { type: "commandExecution", id: "item_command", command: "git status", status: "completed" },
        });
        emit("item/completed", {
          threadId: "thread_1",
          turnId: "turn_1",
          completedAtMs: 3,
          item: { type: "fileChange", id: "item_file", status: "completed", changes: [] },
        });
      }
      emit("item/completed", {
        threadId: "thread_1",
        turnId: "turn_1",
        completedAtMs: 4,
        item: { type: "agentMessage", id: "item_message", text: "{\"ok\":true}" },
      });
      emit("turn/completed", {
        threadId: "thread_1",
        turn: {
          id: "turn_1",
          status: terminal,
          items: [],
          ...(terminal === "failed" ? { error: { message: "upstream rejected", codexErrorInfo: "unauthorized" } } : {}),
        },
      });
      return { turn: { id: "turn_1", status: "inProgress", items: [] } };
    }
    if (method === "thread/queue/list") return { data: [], nextCursor: null };
    if (method === "thread/read") {
      return { thread: { id: "thread_1", status: { type: "idle" } } };
    }
    return {};
  });
  const start = vi.fn(async (input: unknown) => {
    starts.push(input);
    return state;
  });
  const client = {
    start,
    request,
    respond: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    states: vi.fn(async () => [state]),
    subscribe: vi.fn(async (handler: (notification: CodexAppServerNotification) => void) => {
      notificationHandler = handler;
      return () => { notificationHandler = null; };
    }),
  } as unknown as CodexAppServerClient;
  return { client, requests, emit, request, start, starts };
}

function createAdapter(fake: FakeClient, readSchema: (workspaceRoot: string, path: string) => Promise<string | null> = async () => "{}") {
  return createCodexAppServerAdapter({
    client: fake.client,
    readSchema,
    resolveNativePath: async (workspaceRoot, requestedPath) => ({
      workspaceRealpath: workspaceRoot,
      targetRealpath: requestedPath,
      contained: true,
    }),
  });
}

async function collect(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const event of events) result.push(event);
  return result;
}

const commonInput = {
  cwd: "/repo",
  prompt: "Implement the change",
  resultSchemaPath: "/repo/.humanthread/result.json",
  executionPolicy: { mode: "workspace_full" as const, workspaceRealpath: "/repo" },
  model: "gpt-5.6-terra",
  reasoningEffort: "high" as const,
  environmentOverrides: { OPENAI_BASE_URL: "https://site.example/v1" },
  credentialContext: {
    deploymentOrigin: "https://humanthread.example",
    userId: "user-1",
    credentialRef: "credential-1",
  },
};

describe("Codex app-server adapter", () => {
  it("returns a bounded timeout instead of waiting forever for quiescence", async () => {
    const client = createFakeClient();
    client.request.mockImplementation(async (method: string) => {
      if (method === "thread/queue/list") return { data: [], nextCursor: null };
      if (method === "thread/read") {
        return { thread: { id: "thread_1", status: { type: "active", activeFlags: [] } } };
      }
      return {};
    });
    const queue = {
      drain: () => [],
      push: () => undefined,
      next: async () => { throw new Error("unused"); },
    };

    const result = await waitForThreadQuiescence(
      client.client,
      "thread_1",
      { lastMessage: null, usage: undefined },
      queue as never,
      60,
      10,
    );

    expect(result).toBe("timeout");
  });

  it.each([
    ["codex-cli 0.154.0", "0.154.0"],
    ["codex-cli 0.159.1", "0.159.1"],
  ])("rejects a Codex runtime below the supported floor: %s", async (_label, version) => {
    const fake = createFakeClient();
    fake.client.start = vi.fn(async () => ({ ...state, protocolVersion: `codex-cli ${version}` })) as never;

    await expect(collect(createAdapter(fake).start(commonInput))).rejects.toMatchObject({
      code: "provider_version_unsupported",
    });
  });

  it("accepts the pinned Codex runtime floor", async () => {
    const fake = createFakeClient();
    fake.client.start = vi.fn(async () => ({ ...state, protocolVersion: "codex-cli 0.159.2" })) as never;

    await expect(collect(createAdapter(fake).start(commonInput))).resolves.toBeTruthy();
  });

  it("starts a thread, sends a turn, and exposes the provider session id", async () => {
    const fake = createFakeClient();
    const events = await collect(createAdapter(fake).start(commonInput));

    expect(events).toEqual([
      {
        type: "run.started",
        providerSessionId: "thread_1",
        providerBindingFingerprint: expect.any(String),
        providerTransport: "codex_app_server",
        providerGeneration: 1,
        providerTurnId: "turn_1",
      },
      { type: "agent.message.completed", text: "{\"ok\":true}" },
      { type: "run.completed", result: { ok: true } },
    ]);
    expect(fake.requests[0]).toMatchObject({
      method: "thread/start",
      params: expect.objectContaining({
        model: "gpt-5.6-terra",
        modelProvider: "humanthread_local",
      }),
    });
    expect(fake.starts[0]).toMatchObject({ model: "gpt-5.6-terra", reasoningEffort: "high" });
    expect(fake.requests[1]).toMatchObject({
      method: "turn/start",
      params: expect.objectContaining({
        model: "gpt-5.6-terra",
        effort: "high",
      }),
    });
  });

  it("forces DecisionRouter structured execution into a read-only sandbox", async () => {
    const fake = createFakeClient();
    await collect(createAdapter(fake).executeStructured({
      ...commonInput,
      mode: "router",
      executionPolicy: { mode: "workspace_full", workspaceRealpath: "/repo" },
    }));

    expect(fake.requests[0]).toMatchObject({
      method: "thread/start",
      params: expect.objectContaining({
        sandbox: "read-only",
        approvalPolicy: "on-request",
      }),
    });
  });

  it("runs workspace-full threads with danger-free approvals disabled explicitly", async () => {
    const fake = createFakeClient();
    await collect(createAdapter(fake).start(commonInput));

    expect(fake.requests[0]).toMatchObject({
      method: "thread/start",
      params: expect.objectContaining({
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      }),
    });
  });

  it.each([
    ["sandbox", { sandbox: "danger-full-access" }],
    ["approval policy", { approvalPolicy: "never" }],
  ])("uses the same explicit %s when resuming a workspace-full thread", async (label, expected) => {
    const fake = createFakeClient();
    const adapter = createAdapter(fake);
    const first = await collect(adapter.start(commonInput));
    const sessionId = (first[0] as { providerSessionId?: string }).providerSessionId;
    if (!sessionId) throw new Error(`missing session id for ${label}`);
    fake.requests.length = 0;

    await collect(adapter.resume({
      ...commonInput,
      providerSessionId: sessionId,
      providerTransport: "codex_app_server",
    }));

    expect(fake.requests[0]).toMatchObject({
      method: "thread/resume",
      params: expect.objectContaining(expected),
    });
  });

  it("resumes a legacy CLI checkpoint read-only instead of granting full access", async () => {
    const fake = createFakeClient();
    const adapter = createAdapter(fake);
    const first = await collect(adapter.start(commonInput));
    const sessionId = (first[0] as { providerSessionId?: string }).providerSessionId;
    if (!sessionId) throw new Error("missing session id");
    fake.requests.length = 0;

    await collect(adapter.resume({
      ...commonInput,
      providerSessionId: sessionId,
      providerTransport: "codex_cli",
    }));

    expect(fake.requests[0]).toMatchObject({
      method: "thread/resume",
      params: expect.objectContaining({
        sandbox: "read-only",
        approvalPolicy: "on-request",
      }),
    });
  });


  it("passes the structured output schema and resumes only the bound thread", async () => {
    const fake = createFakeClient();
    const adapter = createAdapter(fake, async () => JSON.stringify({ type: "object", required: ["ok"] }));
    await collect(adapter.start(commonInput));
    const resumed = await collect(adapter.executeStructured({ ...commonInput, providerSessionId: "thread_1", mode: "stage" }));
    const startCallsBeforeMismatch = fake.start.mock.calls.length;

    expect(resumed[0]).toMatchObject({ type: "run.started", providerSessionId: "thread_1", providerBindingFingerprint: expect.any(String) });
    const turnStarts = fake.requests.filter(({ method }) => method === "turn/start");
    expect(turnStarts.at(-1)?.params).toMatchObject({
      outputSchema: { type: "object", required: ["ok"] },
      effort: "high",
    });
    const resumeRequest = fake.requests.find(({ method }) => method === "thread/resume");
    expect(resumeRequest?.params).not.toHaveProperty("excludeTurns");
    await expect(collect(adapter.resume({
      ...commonInput,
      providerSessionId: "thread_1",
      credentialContext: { ...commonInput.credentialContext, credentialRef: "credential-2" },
    }))).rejects.toMatchObject({ code: "provider_resume_binding_mismatch" });
    expect(fake.start).toHaveBeenCalledTimes(startCallsBeforeMismatch);
  });

  it("persists the app-server generation and turn metadata and rejects a stale generation", async () => {
    const fake = createFakeClient();
    const adapter = createAdapter(fake);
    const events = await collect(adapter.start(commonInput));
    expect(events[0]).toMatchObject({
      type: "run.started",
      providerTransport: "codex_app_server",
      providerGeneration: 1,
      providerTurnId: "turn_1",
    });
    const started = events[0] as { providerBindingFingerprint?: string };
    await expect(collect(adapter.resume({
      ...commonInput,
      providerSessionId: "thread_1",
      providerTransport: "codex_app_server",
      providerGeneration: 2,
      ...(started.providerBindingFingerprint ? { providerBindingFingerprint: started.providerBindingFingerprint } : {}),
    }))).rejects.toMatchObject({ code: "provider_resume_generation_mismatch" });
  });

  it("maps approval, tool, artifact, failure, and cancellation notifications", async () => {
    const fake = createFakeClient({ includeTools: true });
    const successful = await collect(createAdapter(fake).start(commonInput));
    expect(successful).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "approval.requested" }),
      expect.objectContaining({ type: "tool.started", tool: "commandExecution" }),
      expect.objectContaining({ type: "tool.completed", tool: "commandExecution" }),
      expect.objectContaining({ type: "artifact.produced" }),
    ]));
    expect(fake.client.respond).toHaveBeenCalledWith(7, { decision: "decline" }, undefined);

    const failed = await collect(createAdapter(createFakeClient({ terminal: "failed" })).start(commonInput));
    expect(failed.at(-1)).toMatchObject({ type: "run.failed", errorCode: "unauthorized", message: "upstream rejected" });

    const cancelled = await collect(createAdapter(createFakeClient({ terminal: "interrupted" })).start(commonInput));
    expect(cancelled.at(-1)).toEqual({ type: "run.cancelled" });
  });

  it("waits for queued turns and keeps the cumulative usage snapshot before completing", async () => {
    const fake = createFakeClient();
    let queueCalls = 0;
    let readCalls = 0;
    (fake.request as unknown as {
      mockImplementation(implementation: (method: string, params: unknown) => Promise<unknown>): void;
    }).mockImplementation(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "thread_1" } };
      if (method === "turn/start") {
        fake.emit("item/completed", {
          threadId: "thread_1",
          turnId: "turn_1",
          item: { type: "agentMessage", id: "item_1", text: "{\"ok\":true}" },
        });
        fake.emit("thread/tokenUsage/updated", {
          threadId: "thread_1",
          turnId: "turn_1",
          tokenUsage: {
            total: { inputTokens: 10, outputTokens: 2, nested: { cachedTokens: 1 } },
            last: { inputTokens: 10, outputTokens: 2, nested: { cachedTokens: 1 } },
          },
        });
        fake.emit("turn/completed", {
          threadId: "thread_1",
          turn: { id: "turn_1", status: "completed", items: [] },
        });
        return { turn: { id: "turn_1", status: "inProgress", items: [] } };
      }
      if (method === "thread/queue/list") {
        queueCalls += 1;
        return queueCalls === 1
          ? { data: [{ id: "queued_1" }], nextCursor: null }
          : { data: [], nextCursor: null };
      }
      if (method === "thread/read") {
        readCalls += 1;
        if (readCalls === 1) {
          queueMicrotask(() => {
            fake.emit("turn/started", {
              threadId: "thread_1",
              turn: { id: "turn_2", status: "inProgress", items: [] },
            });
            fake.emit("thread/tokenUsage/updated", {
              threadId: "thread_1",
              turnId: "turn_2",
              tokenUsage: {
                total: { inputTokens: 30, outputTokens: 6, nested: { cachedTokens: 4 } },
                last: { inputTokens: 20, outputTokens: 4, nested: { cachedTokens: 3 } },
              },
            });
            fake.emit("item/completed", {
              threadId: "thread_1",
              turnId: "turn_2",
              item: { type: "agentMessage", id: "item_2", text: "{\"ok\":true}" },
            });
            fake.emit("turn/completed", {
              threadId: "thread_1",
              turn: { id: "turn_2", status: "completed", items: [] },
            });
          });
          return { thread: { id: "thread_1", status: { type: "active", activeFlags: [] } } };
        }
        queueMicrotask(() => fake.emit("thread/status/changed", {
          threadId: "thread_1",
          status: { type: "idle" },
        }));
        return { thread: { id: "thread_1", status: { type: "idle" } } };
      }
      return {};
    });

    const events = await collect(createAdapter(fake).start(commonInput));

    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      usage: {
        inputTokens: 30,
        outputTokens: 6,
        nested: { cachedTokens: 4 },
      },
    });
    expect(queueCalls).toBeGreaterThanOrEqual(2);
    expect(readCalls).toBeGreaterThanOrEqual(2);
  });

  it("does not fail a run on a retryable app-server error notification", async () => {
    const fake = createFakeClient();
    fake.request.mockImplementation(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "thread_1" } };
      if (method === "turn/start") {
        // Codex emits a retryable `error` and keeps the turn alive.
        fake.emit("error", {
          threadId: "thread_1",
          turnId: "turn_1",
          willRetry: true,
          error: { message: "stream disconnected before completion: Upstream service temporarily unavailable" },
        });
        fake.emit("item/completed", {
          threadId: "thread_1",
          turnId: "turn_1",
          item: { type: "agentMessage", id: "item_1", text: "{\"ok\":true}" },
        });
        fake.emit("turn/completed", {
          threadId: "thread_1",
          turn: { id: "turn_1", status: "completed", items: [] },
        });
        return { turn: { id: "turn_1", status: "inProgress", items: [] } };
      }
      if (method === "thread/queue/list") return { data: [], nextCursor: null };
      if (method === "thread/read") return { thread: { id: "thread_1", status: { type: "idle" } } };
      return {};
    });

    const events = await collect(createAdapter(fake).start(commonInput));

    expect(events.at(-1)).toMatchObject({ type: "run.completed", result: { ok: true } });
    expect(events.some((event) => (event as { type?: string }).type === "run.failed")).toBe(false);
  });

  it("ignores notifications from a different thread on the shared daemon", async () => {
    const fake = createFakeClient();
    let turnStarts = 0;
    fake.request.mockImplementation(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "thread_1" } };
      if (method === "turn/start") {
        turnStarts += 1;
        fake.emit("thread/tokenUsage/updated", {
          threadId: "thread_other",
          turnId: "turn_other",
          tokenUsage: { total: { inputTokens: 999, outputTokens: 999 }, last: {} },
        });
        fake.emit("item/completed", {
          threadId: "thread_other",
          turnId: "turn_other",
          item: { type: "agentMessage", id: "other", text: "SHOULD_NOT_LEAK" },
        });
        fake.emit("turn/completed", {
          threadId: "thread_other",
          turn: { id: "turn_other", status: "completed", items: [] },
        });
        fake.emit("item/completed", {
          threadId: "thread_1",
          turnId: "turn_1",
          item: { type: "agentMessage", id: "mine", text: "{\"ok\":true}" },
        });
        fake.emit("thread/tokenUsage/updated", {
          threadId: "thread_1",
          turnId: "turn_1",
          tokenUsage: { total: { inputTokens: 10, outputTokens: 2 }, last: {} },
        });
        fake.emit("turn/completed", {
          threadId: "thread_1",
          turn: { id: "turn_1", status: "completed", items: [] },
        });
        return { turn: { id: "turn_1", status: "inProgress", items: [] } };
      }
      if (method === "thread/queue/list") return { data: [], nextCursor: null };
      if (method === "thread/read") return { thread: { id: "thread_1", status: { type: "idle" } } };
      return {};
    });

    const events = await collect(createAdapter(fake).start(commonInput));

    expect(turnStarts).toBe(1);
    expect(JSON.stringify(events)).not.toContain("SHOULD_NOT_LEAK");
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      result: { ok: true },
      usage: { inputTokens: 10, outputTokens: 2 },
    });
  });

  it("does not accept thread-scoped notifications that omit a thread id", async () => {
    const fake = createFakeClient();
    fake.request.mockImplementation(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "thread_1" } };
      if (method === "turn/start") {
        fake.emit("turn/completed", {
          turn: { id: "turn_orphan", status: "completed", items: [] },
        });
        fake.emit("item/completed", {
          item: { type: "agentMessage", id: "orphan", text: "ORPHAN_RESULT" },
        });
        fake.emit("item/completed", {
          threadId: "thread_1",
          turnId: "turn_1",
          item: { type: "agentMessage", id: "mine", text: "{\"ok\":true}" },
        });
        fake.emit("turn/completed", {
          threadId: "thread_1",
          turn: { id: "turn_1", status: "completed", items: [] },
        });
        return { turn: { id: "turn_1", status: "inProgress", items: [] } };
      }
      if (method === "thread/queue/list") return { data: [], nextCursor: null };
      if (method === "thread/read") return { thread: { id: "thread_1", status: { type: "idle" } } };
      return {};
    });

    const events = await collect(createAdapter(fake).start(commonInput));

    expect(JSON.stringify(events)).not.toContain("ORPHAN_RESULT");
    expect(events.at(-1)).toMatchObject({ type: "run.completed", result: { ok: true } });
  }, 10_000);
});
