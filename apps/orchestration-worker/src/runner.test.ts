import { describe, expect, it, vi } from "vitest";
import { runWorkerIteration, runWorkerLoop } from "./runner";

describe("runWorkerIteration", () => {
  it("publishes outbox, dispatches, then recovers in order", async () => {
    const calls: string[] = [];
    await runWorkerIteration({ publishOutbox: vi.fn(async () => { calls.push("outbox"); }), dispatch: vi.fn(async () => { calls.push("dispatch"); }), recover: vi.fn(async () => { calls.push("recover"); }) });
    expect(calls).toEqual(["outbox", "dispatch", "recover"]);
  });
});

describe("runWorkerLoop", () => {
  it("keeps polling after a failed iteration and reports the error", async () => {
    const onError = vi.fn();
    const iteration = vi.fn()
      .mockRejectedValueOnce(new Error("agentProfileId is invalid"))
      .mockResolvedValue(undefined);
    const controller = new AbortController();
    let polls = 0;
    await runWorkerLoop({
      iteration,
      pollMs: 0,
      signal: controller.signal,
      onError,
      wait: async () => {
        polls += 1;
        if (polls >= 2) controller.abort();
      },
    });

    expect(iteration).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "agentProfileId is invalid" }));
  });

  it("stops after the current iteration when aborted", async () => {
    const controller = new AbortController();
    const iteration = vi.fn(async () => { controller.abort(); });
    const wait = vi.fn();

    await runWorkerLoop({ iteration, pollMs: 1_000, signal: controller.signal, wait });

    expect(iteration).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
