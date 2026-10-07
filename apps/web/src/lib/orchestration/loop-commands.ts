const transitions = { created: { start: "running", cancel: "cancelled" }, running: { pause: "paused", cancel: "cancelled" }, paused: { resume: "running", cancel: "cancelled" }, waiting: { cancel: "cancelled" }, waiting_approval: { resume: "running", cancel: "cancelled" } } as const;

export async function transitionLoopCommand(input: { command: "start" | "pause" | "resume" | "cancel"; loop: { id: string; status: string; version: number }; budgetRemaining: boolean; approvalPending?: boolean }, dependencies: { persist(result: { id: string; status: string; version: number }): Promise<unknown> }) {
  if (input.command === "resume" && !input.budgetRemaining) throw Object.assign(new Error("Loop budget exhausted"), { code: "budget_exhausted" });
  if (input.command === "resume" && input.approvalPending) throw Object.assign(new Error("Loop approval is unresolved"), { code: "policy_denied" });
  const status = (transitions as Record<string, Partial<Record<string, string>>>)[input.loop.status]?.[input.command];
  if (!status) throw Object.assign(new Error("Invalid Loop transition"), { code: "validation_failed" });
  const result = { id: input.loop.id, status, version: input.loop.version + 1 };
  const persisted = await dependencies.persist(result);
  if (persisted && typeof persisted === "object" && "count" in persisted && persisted.count !== 1) throw Object.assign(new Error("Loop version conflict"), { code: "version_conflict" });
  return result;
}
