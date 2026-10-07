import type { AgentWorkerCapabilitySnapshot } from "@humanthread/shared";

export const LOCAL_AGENT_CAPABILITY_SNAPSHOT = {
  providers: [{ name: "codex", version: "unknown" }],
  capabilities: ["workspace", "files", "commands"],
  loginStateCategories: [],
  maxConcurrency: 1,
} as const satisfies AgentWorkerCapabilitySnapshot;

export function localAgentCapabilitySnapshot(maxConcurrency: number): AgentWorkerCapabilitySnapshot {
  return { ...LOCAL_AGENT_CAPABILITY_SNAPSHOT, maxConcurrency };
}
