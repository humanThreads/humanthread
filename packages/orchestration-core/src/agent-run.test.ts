import { describe, expect, it } from "vitest";
import { transitionAgentRun, validateLease } from "./agent-run";

describe("AgentRun state and lease", () => {
  it("advances through the execution lifecycle", () => {
    let run = { id: "run_1", status: "queued" as const, leaseGeneration: 0, version: 1 };
    run = transitionAgentRun({ run, command: "claim" });
    expect(run).toMatchObject({ status: "claimed", leaseGeneration: 1, version: 2 });
    const starting = transitionAgentRun({ run, command: "start" });
    expect(transitionAgentRun({ run: starting, command: "run" })).toMatchObject({ status: "running" });
  });

  it("rejects stale, expired and terminal leases", () => {
    expect(validateLease({
      run: { id: "run_1", status: "running", workerId: "worker_1", leaseGeneration: 3, leaseExpiresAt: new Date("2026-07-21T00:10:00.000Z") },
      workerId: "worker_1",
      leaseGeneration: 2,
      now: new Date("2026-07-21T00:05:00.000Z"),
    })).toEqual({ ok: false, code: "stale_lease" });
    expect(validateLease({
      run: { id: "run_1", status: "succeeded", workerId: "worker_1", leaseGeneration: 3, leaseExpiresAt: new Date("2026-07-21T00:10:00.000Z") },
      workerId: "worker_1",
      leaseGeneration: 3,
      now: new Date("2026-07-21T00:05:00.000Z"),
    })).toEqual({ ok: false, code: "stale_lease" });
  });
});
