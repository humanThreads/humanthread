import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoopWorkerLifecycle, shouldStartLoopWorker } from "./loop-worker-lifecycle";

describe("Loop Worker lifecycle", () => {
  it("starts only for a ready native session with authorized execution", () => {
    expect(shouldStartLoopWorker({
      isNative: true,
      sessionStatus: "ready",
      nativeExecution: true,
      hasCredentials: true,
      hasAccountSession: true,
      workerEnabled: true,
    })).toBe(true);
    expect(shouldStartLoopWorker({
      isNative: false,
      sessionStatus: "ready",
      nativeExecution: true,
      hasCredentials: true,
      hasAccountSession: true,
      workerEnabled: true,
    })).toBe(false);
    expect(shouldStartLoopWorker({
      isNative: true,
      sessionStatus: "signed_out",
      nativeExecution: true,
      hasCredentials: false,
      hasAccountSession: true,
      workerEnabled: true,
    })).toBe(false);
    expect(shouldStartLoopWorker({
      isNative: true,
      sessionStatus: "ready",
      nativeExecution: true,
      hasCredentials: true,
      hasAccountSession: true,
      workerEnabled: false,
    })).toBe(false);
  });

  it("starts an online pass and stops the Worker on unmount", async () => {
    const worker = {
      onOnline: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };
    const createWorker = vi.fn().mockResolvedValue(worker);
    const accountSession = {
      apiBaseUrl: "http://localhost:3000",
      userId: "user_1",
      deviceId: "device_1",
    };
    const { unmount } = render(<LoopWorkerLifecycle
      accountSession={accountSession}
      createWorker={createWorker}
      loadWorkerPreferences={vi.fn().mockResolvedValue({ enabled: true, maxConcurrency: 12 })}
      isNative
      pollIntervalMs={60_000}
      session={{
        status: "ready",
        nativeExecution: true,
        runtimeCredentials: { deviceToken: "device_token", apiToken: "" },
      }}
    />);

    await waitFor(() => expect(worker.onOnline).toHaveBeenCalledOnce());
    expect(createWorker).toHaveBeenCalledWith(expect.anything(), { maxConcurrency: 12 });
    unmount();

    expect(worker.stop).toHaveBeenCalledOnce();
  });

  it("reasserts deactivation on startup when execution is disabled", async () => {
    const worker = {
      onOnline: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      deactivate: vi.fn().mockResolvedValue(undefined),
    };
    const createWorker = vi.fn().mockResolvedValue(worker);
    render(<LoopWorkerLifecycle
      accountSession={{ apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1" }}
      createWorker={createWorker}
      loadWorkerPreferences={vi.fn().mockResolvedValue({ enabled: false, maxConcurrency: 8 })}
      isNative
      session={{ status: "ready", nativeExecution: true, runtimeCredentials: { deviceToken: "device_token", apiToken: "" } }}
    />);

    await waitFor(() => expect(worker.deactivate).toHaveBeenCalledOnce());
    expect(worker.onOnline).not.toHaveBeenCalled();
  });

  it("updates concurrency in place without stopping active work", async () => {
    const worker = {
      onOnline: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      deactivate: vi.fn().mockResolvedValue(undefined),
      updateMaxConcurrency: vi.fn(),
    };
    const createWorker = vi.fn().mockResolvedValue(worker);
    render(<LoopWorkerLifecycle
      accountSession={{ apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1" }}
      createWorker={createWorker}
      loadWorkerPreferences={vi.fn().mockResolvedValue({ enabled: true, maxConcurrency: 8 })}
      isNative
      pollIntervalMs={60_000}
      session={{ status: "ready", nativeExecution: true, runtimeCredentials: { deviceToken: "device_token", apiToken: "" } }}
    />);
    await waitFor(() => expect(worker.onOnline).toHaveBeenCalledOnce());

    act(() => globalThis.dispatchEvent(new CustomEvent("humanthread:worker-preferences-changed", {
      detail: { enabled: true, maxConcurrency: 2 },
    })));

    expect(worker.updateMaxConcurrency).toHaveBeenCalledWith(2);
    expect(worker.stop).not.toHaveBeenCalled();
    expect(worker.deactivate).not.toHaveBeenCalled();
    expect(createWorker).toHaveBeenCalledOnce();
    await waitFor(() => expect(worker.onOnline).toHaveBeenCalledTimes(2));
  });
});
