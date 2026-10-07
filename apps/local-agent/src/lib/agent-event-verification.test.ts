import { describe, expect, it } from "vitest";
import {
  getRequiredPayloadKeys,
  isSupportedLocalAgentEventType,
  validateAgentEventPayload,
} from "./agent-event-verification";

describe("agent event verification", () => {
  it("recognizes supported local agent event types", () => {
    expect(isSupportedLocalAgentEventType("local_opened")).toBe(true);
    expect(isSupportedLocalAgentEventType("command_started")).toBe(true);
    expect(isSupportedLocalAgentEventType("command_exited")).toBe(true);
    expect(isSupportedLocalAgentEventType("cli_reported")).toBe(false);
  });

  it("defines required payload keys for command_started", () => {
    expect(getRequiredPayloadKeys("command_started")).toEqual([
      "cwd",
      "command",
      "processId",
      "shell",
    ]);
  });

  it("reports missing payload keys for incomplete command_started events", () => {
    expect(
      validateAgentEventPayload("command_started", {
        cwd: "/workspace/demo",
        command: "codex",
      }),
    ).toEqual({
      eventType: "command_started",
      valid: false,
      missingKeys: ["processId", "shell"],
      requiredKeys: ["cwd", "command", "processId", "shell"],
    });
  });

  it("accepts command_exited payloads with explicit exit metadata", () => {
    expect(
      validateAgentEventPayload("command_exited", {
        cwd: "/workspace/demo",
        command: "pnpm test",
        processId: 4242,
        shell: "sh -lc",
        status: "completed",
        exitCode: 0,
      }),
    ).toEqual({
      eventType: "command_exited",
      valid: true,
      missingKeys: [],
      requiredKeys: [
        "cwd",
        "command",
        "processId",
        "shell",
        "status",
        "exitCode",
      ],
    });
  });
});
