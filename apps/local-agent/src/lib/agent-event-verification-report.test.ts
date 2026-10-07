import { describe, expect, it } from "vitest";
import { summarizeAgentEventVerification } from "./agent-event-verification-report";

describe("summarizeAgentEventVerification", () => {
  it("keeps only the latest event per type when latestOnly is enabled", () => {
    const result = summarizeAgentEventVerification({
      rows: [
        {
          id: "old-local-opened",
          taskId: "task_1",
          type: "local_opened",
          createdAt: new Date("2026-05-19T06:00:00.000Z"),
          payload: {
            command: "codex",
          },
        },
        {
          id: "new-local-opened",
          taskId: "task_1",
          type: "local_opened",
          createdAt: new Date("2026-05-19T06:30:00.000Z"),
          payload: {
            cwd: "/workspace/demo",
          },
        },
        {
          id: "new-command-started",
          taskId: "task_1",
          type: "command_started",
          createdAt: new Date("2026-05-19T06:30:01.000Z"),
          payload: {
            cwd: "/workspace/demo",
            command: "codex",
            processId: 99901,
            shell: "smoke-shell",
          },
        },
      ],
      expectedTypes: ["local_opened", "command_started", "command_exited"],
      latestOnly: true,
    });

    expect(result).toEqual({
      ok: false,
      total: 2,
      invalidCount: 0,
      missingExpectedTypes: ["command_exited"],
      results: [
        {
          id: "new-command-started",
          taskId: "task_1",
          type: "command_started",
          createdAt: "2026-05-19T06:30:01.000Z",
          valid: true,
          missingKeys: [],
          payload: {
            cwd: "/workspace/demo",
            command: "codex",
            processId: 99901,
            shell: "smoke-shell",
          },
        },
        {
          id: "new-local-opened",
          taskId: "task_1",
          type: "local_opened",
          createdAt: "2026-05-19T06:30:00.000Z",
          valid: true,
          missingKeys: [],
          payload: {
            cwd: "/workspace/demo",
          },
        },
      ],
    });
  });
});
