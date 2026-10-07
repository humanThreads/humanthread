import { describe, expect, it, vi } from "vitest";
import { createClaudeAdapter } from "./claude-adapter";

describe("Claude provider adapter", () => {
  it("normalizes streamed lifecycle, permissions and results", async () => {
    const query = vi.fn(async function* () {
      yield { type: "system", subtype: "init", session_id: "session_1" };
      yield { type: "permission_request", tool_name: "Bash", input: { command: "git status" } };
      yield { type: "assistant", message: { content: [{ type: "text", text: "done" }] } };
      yield { type: "result", subtype: "success", result: { summary: "done" }, usage: { input_tokens: 10 } };
    });
    const events = [];
    for await (const event of createClaudeAdapter({ query }).start({ cwd: "/repo", prompt: "Implement", resultSchemaPath: "/tmp/result.json", executionPolicy: { mode: "read_only", workspaceRealpath: "/repo" } })) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["run.started", "approval.requested", "agent.message.completed", "run.completed"]);
  });

  it("disables tools for structured router execution and includes the result Schema instruction", async () => {
    const query = vi.fn(async function* () {
      yield { type: "result", subtype: "success", result: { nextNodeId: "develop" } };
    });
    const adapter = createClaudeAdapter({ query });

    for await (const _event of adapter.executeStructured({
      cwd: "/repo",
      prompt: "Choose the next node",
      resultSchemaPath: "/repo/.humanthread/router.schema.json",
      executionPolicy: { mode: "workspace_full", workspaceRealpath: "/repo" },
      mode: "router",
    })) {
      // Consume the provider stream.
    }

    expect(query).toHaveBeenCalledWith({
      prompt: expect.stringMatching(/^Choose the next node[\s\S]*\/repo\/\.humanthread\/router\.schema\.json$/u),
      options: expect.objectContaining({
        cwd: "/repo",
        tools: [],
        permissionMode: "dontAsk",
      }),
    });
  });

  it("passes an explicitly selected model to the Claude SDK", async () => {
    const query = vi.fn(async function* () {
      yield { type: "result", subtype: "success", result: {} };
    });
    const adapter = createClaudeAdapter({ query });

    for await (const _event of adapter.start({
      cwd: "/repo",
      prompt: "Implement",
      resultSchemaPath: "/tmp/result.json",
      executionPolicy: { mode: "read_only", workspaceRealpath: "/repo" },
      model: "claude-custom-v2",
    })) {
      // Consume the provider stream.
    }

    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ model: "claude-custom-v2" }),
    }));
  });
});
