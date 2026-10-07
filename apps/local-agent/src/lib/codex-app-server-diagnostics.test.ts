import { describe, expect, it } from "vitest";

import { projectCodexAppServerDiagnostic } from "./codex-app-server-diagnostics";

describe("projectCodexAppServerDiagnostic", () => {
  it("projects bounded runtime state without credentials, prompts, environments, or full paths", () => {
    const result = projectCodexAppServerDiagnostic({
      state: {
        processKey: "codex:one",
        generation: 4,
        pid: 123,
        bindingFingerprint: "a".repeat(64),
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        transport: "stdio",
        status: "ready",
        lastNotificationAt: 1234,
        pendingRequestCount: 1,
        stderrSummary: "failed at /Users/secret/project token=top-secret",
        lastErrorCode: "provider_error",
      },
      threadId: "thread_1",
      turnId: "turn_1",
      heartbeat: { status: "healthy", lastSuccessAt: 1230, leaseExpiresAt: 5000 },
      outbox: "online",
      reconnectCount: 2,
      apiKey: "top-secret",
      prompt: "do not retain this",
      environment: { OPENAI_API_KEY: "top-secret" },
      workspacePath: "/Users/secret/project",
    } as never);

    expect(result).toEqual(expect.objectContaining({
      processKey: "codex:one",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      threadId: "thread_1",
      turnId: "turn_1",
      heartbeat: { status: "healthy", lastSuccessAt: 1230, leaseExpiresAt: 5000 },
      outbox: "online",
      reconnectCount: 2,
    }));
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("prompt");
    expect(result).not.toHaveProperty("environment");
    expect(result).not.toHaveProperty("workspacePath");
    expect(result.stderrSummary).not.toContain("/Users/secret/project");
    expect(result.stderrSummary).not.toContain("top-secret");
  });
});
