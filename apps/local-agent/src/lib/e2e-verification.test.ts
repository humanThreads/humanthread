import { describe, expect, it, vi } from "vitest";
import { runE2eVerification } from "./e2e-verification";

describe("runE2eVerification", () => {
  it("starts the server, waits until ready, runs smoke verify, and always stops the server", async () => {
    const startServer = vi.fn().mockResolvedValue({
      port: 3010,
      stop: vi.fn().mockResolvedValue(undefined),
    });
    const waitUntilReady = vi.fn().mockResolvedValue(undefined);
    const runSmokeVerify = vi.fn().mockResolvedValue({
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

    const result = await runE2eVerification(
      {
        port: 3010,
      },
      {
        startServer,
        waitUntilReady,
        runSmokeVerify,
      },
    );

    expect(startServer).toHaveBeenCalledWith({
      preferredPort: 3010,
    });
    expect(waitUntilReady).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:3010",
    });
    expect(runSmokeVerify).toHaveBeenCalledWith({
      apiBaseUrl: "http://127.0.0.1:3010",
    });
    expect(result).toMatchObject({
      verify: {
        ok: true,
      },
    });
    expect(startServer.mock.results[0]?.value).resolves.toMatchObject({
      stop: expect.any(Function),
    });
  });

  it("stops the server when smoke verify fails", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const startServer = vi.fn().mockResolvedValue({ stop });
    const waitUntilReady = vi.fn().mockResolvedValue(undefined);
    const runSmokeVerify = vi.fn().mockRejectedValue(new Error("smoke failed"));

    await expect(
      runE2eVerification(
        {
          port: 3010,
        },
        {
          startServer,
          waitUntilReady,
          runSmokeVerify,
        },
      ),
    ).rejects.toThrow("smoke failed");

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("uses the actual allocated port when the starter falls back to another port", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const startServer = vi.fn().mockResolvedValue({
      port: 3011,
      stop,
    });
    const waitUntilReady = vi.fn().mockResolvedValue(undefined);
    const runSmokeVerify = vi.fn().mockResolvedValue({
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

    await runE2eVerification(
      {
        port: 3010,
      },
      {
        startServer,
        waitUntilReady,
        runSmokeVerify,
      },
    );

    expect(waitUntilReady).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:3011",
    });
    expect(runSmokeVerify).toHaveBeenCalledWith({
      apiBaseUrl: "http://127.0.0.1:3011",
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
