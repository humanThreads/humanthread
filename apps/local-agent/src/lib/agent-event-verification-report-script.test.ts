import { describe, expect, it } from "vitest";
import { summarizeAgentEventVerification } from "./agent-event-verification-report";

describe("summarizeAgentEventVerification", () => {
  it("keeps only the latest row for each event type when duplicate historical rows exist", () => {
    const result = summarizeAgentEventVerification({
      rows: [
        {
          id: "older-command-started",
          taskId: "task_1",
          type: "command_started",
          createdAt: new Date("2026-05-19T06:00:00.000Z"),
          payload: {
            cwd: "/workspace/demo",
            command: "codex",
          },
        },
        {
          id: "newer-command-started",
          taskId: "task_1",
          type: "command_started",
          createdAt: new Date("2026-05-19T06:30:00.000Z"),
          payload: {
            cwd: "/workspace/demo",
            command: "codex",
            processId: 99901,
            shell: "smoke-shell",
          },
        },
      ],
      expectedTypes: ["command_started"],
      latestOnly: true,
    });

    expect(result).toEqual({
      ok: true,
      total: 1,
      invalidCount: 0,
      missingExpectedTypes: [],
      results: [
        {
          id: "newer-command-started",
          taskId: "task_1",
          type: "command_started",
          createdAt: "2026-05-19T06:30:00.000Z",
          valid: true,
          missingKeys: [],
          payload: {
            cwd: "/workspace/demo",
            command: "codex",
            processId: 99901,
            shell: "smoke-shell",
          },
        },
      ],
    });
  });
});
