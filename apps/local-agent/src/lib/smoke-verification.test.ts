import { describe, expect, it, vi } from "vitest";
import { runSmokeAndVerifyEvents } from "./smoke-verification";

describe("runSmokeAndVerifyEvents", () => {
  it("runs smoke first and then verifies the returned task event chain", async () => {
    const runSmoke = vi.fn().mockResolvedValue({
      deviceStatus: "authorized",
      deviceToken: "device_token_123",
      taskId: "workflow_1:run_cli",
      reportedEventTypes: [
        "local_opened",
        "command_started",
        "command_exited",
      ],
    });
    const runVerify = vi.fn().mockResolvedValue({
      ok: true,
      total: 3,
      invalidCount: 0,
      missingExpectedTypes: [],
      results: [],
    });

    const result = await runSmokeAndVerifyEvents(
      {
        smokeInput: {
          apiBaseUrl: "http://127.0.0.1:3010",
          teamId: "team_1",
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceName: "agent-macbook",
          apiToken: "token_123",
          deviceToken: "",
          platform: "macos",
        },
        verifyInput: {
          take: 10,
        },
      },
      {
        runSmoke,
        runVerify,
      },
    );

    expect(runSmoke).toHaveBeenCalledTimes(1);
    expect(runVerify).toHaveBeenCalledWith({
      taskId: "workflow_1:run_cli",
      take: 10,
      expectedTypes: [
        "local_opened",
        "command_started",
        "command_exited",
      ],
      latestOnly: true,
    });
    expect(result).toEqual({
      smoke: {
        deviceStatus: "authorized",
        deviceToken: "device_token_123",
        taskId: "workflow_1:run_cli",
        reportedEventTypes: [
          "local_opened",
          "command_started",
          "command_exited",
        ],
      },
      verify: {
        ok: true,
        total: 3,
        invalidCount: 0,
        missingExpectedTypes: [],
        results: [],
      },
    });
  });

  it("skips verification when smoke did not return a task id", async () => {
    const runSmoke = vi.fn().mockResolvedValue({
      deviceStatus: "pending",
      deviceToken: "device_token_123",
      taskId: null,
      reportedEventTypes: [],
    });
    const runVerify = vi.fn();

    const result = await runSmokeAndVerifyEvents(
      {
        smokeInput: {
          apiBaseUrl: "http://127.0.0.1:3010",
          teamId: "team_1",
          userId: "user_owner",
          deviceId: "device_mac_1",
          deviceName: "agent-macbook",
          apiToken: "token_123",
          deviceToken: "",
          platform: "macos",
        },
        verifyInput: {},
      },
      {
        runSmoke,
        runVerify,
      },
    );

    expect(runVerify).not.toHaveBeenCalled();
    expect(result).toEqual({
      smoke: {
        deviceStatus: "pending",
        deviceToken: "device_token_123",
        taskId: null,
        reportedEventTypes: [],
      },
      verify: null,
    });
  });
});
