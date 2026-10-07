import type { StageAutoRecovery } from "@humanthread/project-loop-sync";

type RecoveryCommandResult = { passed: boolean; summary: string };

export type StageAutoRecoveryResult =
  | {
      recovered: true;
      attemptsUsed: number;
      commandResults: Array<{ command: string; summary: string }>;
    }
  | {
      recovered: false;
      attemptsUsed: number;
      reason: "not_applicable" | "workspace_read_only" | "budget_exhausted" | "command_failed";
      commandResults: Array<{ command: string; summary: string }>;
      failedCommand?: string;
    };

function recoveryIssueType(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const status = Reflect.get(result, "status");
  const issueType = Reflect.get(result, "issueType");
  return status !== "SUCCESS" && typeof issueType === "string" ? issueType : null;
}

export async function attemptStageAutoRecovery(input: {
  result: unknown;
  policy: StageAutoRecovery;
  attemptsUsed: number;
  workspaceWritable: boolean;
  runCommand(command: string): Promise<RecoveryCommandResult>;
}): Promise<StageAutoRecoveryResult> {
  const issueType = recoveryIssueType(input.result);
  if (!issueType || !input.policy.issueTypes.includes(issueType)) {
    return { recovered: false, attemptsUsed: input.attemptsUsed, reason: "not_applicable", commandResults: [] };
  }
  if (!input.workspaceWritable) {
    return { recovered: false, attemptsUsed: input.attemptsUsed, reason: "workspace_read_only", commandResults: [] };
  }
  if (input.attemptsUsed >= input.policy.maxAttempts) {
    return { recovered: false, attemptsUsed: input.attemptsUsed, reason: "budget_exhausted", commandResults: [] };
  }

  const attemptsUsed = input.attemptsUsed + 1;
  const commandResults: Array<{ command: string; summary: string }> = [];
  for (const command of input.policy.commands) {
    let result: RecoveryCommandResult;
    try {
      result = await input.runCommand(command);
    } catch {
      result = { passed: false, summary: "Recovery command could not be executed" };
    }
    commandResults.push({ command, summary: result.summary.slice(0, 512) });
    if (!result.passed) {
      return { recovered: false, attemptsUsed, reason: "command_failed", commandResults, failedCommand: command };
    }
  }
  return { recovered: true, attemptsUsed, commandResults };
}
