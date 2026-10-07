export type AgentRunStatus = "queued" | "claimed" | "starting" | "running" | "waiting_approval" | "succeeded" | "failed" | "timed_out" | "orphaned" | "cancelled";
type AgentRunCommand = "claim" | "start" | "run" | "wait_approval" | "succeed" | "fail" | "timeout" | "orphan" | "cancel";

const transitions: Record<AgentRunStatus, Partial<Record<AgentRunCommand, AgentRunStatus>>> = {
  queued: { claim: "claimed", cancel: "cancelled" },
  claimed: { start: "starting", orphan: "orphaned", cancel: "cancelled" },
  starting: { run: "running", fail: "failed", orphan: "orphaned", cancel: "cancelled" },
  running: { wait_approval: "waiting_approval", succeed: "succeeded", fail: "failed", timeout: "timed_out", orphan: "orphaned", cancel: "cancelled" },
  waiting_approval: { run: "running", fail: "failed", orphan: "orphaned", cancel: "cancelled" },
  succeeded: {}, failed: {}, timed_out: {}, orphaned: {}, cancelled: {},
};

export function transitionAgentRun<T extends { id: string; status: AgentRunStatus; leaseGeneration: number; version: number }>(input: { run: T; command: AgentRunCommand }) {
  const status = transitions[input.run.status][input.command];
  if (!status) throw Object.assign(new Error(`Invalid AgentRun transition: ${input.run.status} -> ${input.command}`), { code: "validation_failed" });
  return { ...input.run, status, version: input.run.version + 1, leaseGeneration: input.command === "claim" ? input.run.leaseGeneration + 1 : input.run.leaseGeneration };
}

export function validateLease(input: { run: { id: string; status: string; workerId: string | null; leaseGeneration: number; leaseExpiresAt: Date | null }; workerId: string; leaseGeneration: number; now: Date }) {
  const active = ["claimed", "starting", "running", "waiting_approval"].includes(input.run.status);
  const valid = active && input.run.workerId === input.workerId && input.run.leaseGeneration === input.leaseGeneration && Boolean(input.run.leaseExpiresAt && input.run.leaseExpiresAt > input.now);
  return valid ? { ok: true as const } : { ok: false as const, code: "stale_lease" as const };
}
