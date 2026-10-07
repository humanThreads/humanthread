import { describe, expect, it, vi } from "vitest";
import { transitionLoopCommand } from "./loop-commands";

describe("transitionLoopCommand", () => {
  it("starts, pauses and resumes only with remaining budget", async () => {
    const persist = vi.fn(async (result) => result);
    await expect(transitionLoopCommand({ command: "start", loop: { id: "l1", status: "created", version: 1 }, budgetRemaining: true }, { persist })).resolves.toMatchObject({ status: "running", version: 2 });
    await expect(transitionLoopCommand({ command: "resume", loop: { id: "l1", status: "paused", version: 2 }, budgetRemaining: false }, { persist })).rejects.toMatchObject({ code: "budget_exhausted" });
  });

  it("rejects a concurrent projection update", async () => {
    await expect(transitionLoopCommand({ command: "pause", loop: { id: "l1", status: "running", version: 2 }, budgetRemaining: true }, { persist: vi.fn().mockResolvedValue({ count: 0 }) })).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("cancels a Loop that is waiting on configuration", async () => {
    const persist = vi.fn(async (result) => result);

    await expect(transitionLoopCommand({
      command: "cancel",
      loop: { id: "l1", status: "waiting", version: 4 },
      budgetRemaining: true,
    }, { persist })).resolves.toMatchObject({ status: "cancelled", version: 5 });
  });
});
