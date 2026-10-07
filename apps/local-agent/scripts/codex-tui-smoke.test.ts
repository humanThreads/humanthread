import { describe, expect, it } from "vitest";

import { parse } from "smol-toml";
import { assertSmokeOutput, buildSmokeConfig } from "./codex-tui-smoke";

const validThreadRead = {
  thread: {
    turns: [{
      items: [
        { type: "userMessage", content: [{ type: "text", text: "HUMANTHREAD_TUI_SMOKE" }] },
        { type: "agentMessage", text: "TUI_SMOKE_OK" },
      ],
    }],
  },
};

// Codex 0.159.2 aborts `resume ... --remote` when a permission flag is present,
// so the attached TUI carries none and the app-server thread owns the policy.
const noApprovalCommand = [
  "codex",
  "resume",
  "thread_1",
  "--remote",
  "ws://127.0.0.1:1",
  "--cd",
  "/workspace",
];

const noApprovalThread = {
  approvalPolicy: "never",
  sandbox: "danger-full-access",
};

describe("Codex TUI smoke assertions", () => {
  it("accepts a persisted PTY thread with both messages", () => {
    expect(() => assertSmokeOutput({
      threadRead: validThreadRead,
      methodCalls: ["process/spawn", "process/writeStdin"],
      spawnCommand: noApprovalCommand,
      threadStartParams: noApprovalThread,
    })).not.toThrow();
  });

  it("requires the no-approval session policy and rejects an approval prompt", () => {
    expect(() => assertSmokeOutput({
      threadRead: validThreadRead,
      methodCalls: ["process/spawn", "process/writeStdin"],
      spawnCommand: noApprovalCommand,
      threadStartParams: { approvalPolicy: "on-request", sandbox: "danger-full-access" },
    })).toThrow("did not start the thread with approvalPolicy=never");
    expect(() => assertSmokeOutput({
      threadRead: validThreadRead,
      methodCalls: ["process/spawn", "process/writeStdin"],
      spawnCommand: noApprovalCommand,
      threadStartParams: { approvalPolicy: "never", sandbox: "workspace-write" },
    })).toThrow("did not start the thread with sandbox=danger-full-access");
    expect(() => assertSmokeOutput({
      threadRead: validThreadRead,
      methodCalls: ["process/spawn", "process/writeStdin"],
      spawnCommand: [...noApprovalCommand, "--dangerously-bypass-approvals-and-sandbox"],
      threadStartParams: noApprovalThread,
    })).toThrow("re-added the retired TUI approval override");
    expect(() => assertSmokeOutput({
      threadRead: validThreadRead,
      methodCalls: ["process/spawn", "process/writeStdin"],
      spawnCommand: noApprovalCommand,
      outputTail: "Approval requested: allow this command?",
      threadStartParams: noApprovalThread,
    })).toThrow("observed an interactive approval prompt");
  });

  it("keeps the user's top-level provider settings at the document root", () => {
    const source = [
      'model_provider = "OpenAI"',
      'model = "deepseek-v4.1-flash"',
      "",
      "[model_providers.OpenAI]",
      'base_url = "https://relay.example"',
      "",
    ].join("\n");
    const parsed = parse(buildSmokeConfig({ source, workspace: "/tmp/ht-smoke-ws" })) as Record<string, any>;

    // A TOML table header swallows every top-level key written before it, so
    // injecting `[projects.*]` ahead of the user's settings used to nest the
    // provider configuration inside that table and run the wrong provider.
    expect(parsed.model_provider).toBe("OpenAI");
    expect(parsed.model).toBe("deepseek-v4.1-flash");
    expect(parsed.model_providers.OpenAI.base_url).toBe("https://relay.example");
    expect(parsed.check_for_update_on_startup).toBe(false);
    expect(parsed.projects["/tmp/ht-smoke-ws"]).toEqual({ trust_level: "trusted" });
  });

  it("does not duplicate settings the user config already declares", () => {
    const source = [
      "check_for_update_on_startup = true",
      '[projects."/tmp/ht-smoke-ws"]',
      'trust_level = "trusted"',
    ].join("\n");
    const config = buildSmokeConfig({ source, workspace: "/tmp/ht-smoke-ws" });
    expect(config.match(/check_for_update_on_startup/gu)).toHaveLength(1);
    expect(config.match(/\[projects\./gu)).toHaveLength(1);
    expect((parse(config) as Record<string, any>).check_for_update_on_startup).toBe(true);
  });

  it("rejects missing user history, answer, or PTY calls", () => {
    expect(() => assertSmokeOutput({
      threadRead: { thread: { turns: [{ items: [{ type: "agentMessage", text: "TUI_SMOKE_OK" }] }] } },
      methodCalls: ["process/spawn", "process/writeStdin"],
      spawnCommand: noApprovalCommand,
      threadStartParams: noApprovalThread,
    })).toThrow("did not persist the user and assistant messages");
    expect(() => assertSmokeOutput({
      threadRead: { thread: { turns: [{ items: [{ type: "userMessage", content: [{ type: "text", text: "HUMANTHREAD_TUI_SMOKE" }] }] }] } },
      methodCalls: ["process/spawn", "process/writeStdin"],
      spawnCommand: noApprovalCommand,
      threadStartParams: noApprovalThread,
    })).toThrow("did not persist the user and assistant messages");
    expect(() => assertSmokeOutput({
      threadRead: validThreadRead,
      methodCalls: ["process/writeStdin"],
      spawnCommand: noApprovalCommand,
    })).toThrow("did not use the PTY path");
  });
});
