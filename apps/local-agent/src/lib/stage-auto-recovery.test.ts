import { describe, expect, it, vi } from "vitest";

import { attemptStageAutoRecovery } from "./stage-auto-recovery";

const policy = {
  maxAttempts: 1 as const,
  issueTypes: ["ENVIRONMENT_GENERATED_TYPES_MISSING"],
  commands: ["pnpm db:generate", "pnpm -r --sort build"],
};

describe("attemptStageAutoRecovery", () => {
  it("runs project-declared recovery commands once for a matching result", async () => {
    const runCommand = vi.fn().mockResolvedValue({ passed: true, summary: "passed" });

    const recovery = await attemptStageAutoRecovery({
      result: {
        status: "NEEDS_CLARIFICATION",
        issueType: "ENVIRONMENT_GENERATED_TYPES_MISSING",
        summary: "Generated workspace types are missing",
      },
      policy,
      attemptsUsed: 0,
      workspaceWritable: true,
      runCommand,
    });

    expect(recovery).toMatchObject({ recovered: true, attemptsUsed: 1 });
    expect(runCommand.mock.calls.map(([command]) => command)).toEqual(policy.commands);
  });

  it("does not recover unlisted issues or retry after the recovery budget is spent", async () => {
    const runCommand = vi.fn();

    await expect(attemptStageAutoRecovery({
      result: { status: "NEEDS_CLARIFICATION", issueType: "REQUIREMENT_UNCLEAR" },
      policy,
      attemptsUsed: 0,
      workspaceWritable: true,
      runCommand,
    })).resolves.toMatchObject({ recovered: false, attemptsUsed: 0, reason: "not_applicable" });
    await expect(attemptStageAutoRecovery({
      result: { status: "NEEDS_CLARIFICATION", issueType: "ENVIRONMENT_GENERATED_TYPES_MISSING" },
      policy,
      attemptsUsed: 1,
      workspaceWritable: true,
      runCommand,
    })).resolves.toMatchObject({ recovered: false, attemptsUsed: 1, reason: "budget_exhausted" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("does not run write-capable recovery commands under a read-only grant", async () => {
    const runCommand = vi.fn();

    await expect(attemptStageAutoRecovery({
      result: { status: "NEEDS_CLARIFICATION", issueType: "ENVIRONMENT_GENERATED_TYPES_MISSING" },
      policy,
      attemptsUsed: 0,
      workspaceWritable: false,
      runCommand,
    })).resolves.toMatchObject({ recovered: false, attemptsUsed: 0, reason: "workspace_read_only" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("stops at the first failed recovery command", async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ passed: true, summary: "generated" })
      .mockResolvedValueOnce({ passed: false, summary: "build failed" });

    await expect(attemptStageAutoRecovery({
      result: { status: "NEEDS_CLARIFICATION", issueType: "ENVIRONMENT_GENERATED_TYPES_MISSING" },
      policy,
      attemptsUsed: 0,
      workspaceWritable: true,
      runCommand,
    })).resolves.toMatchObject({
      recovered: false,
      attemptsUsed: 1,
      reason: "command_failed",
      failedCommand: "pnpm -r --sort build",
    });
  });
});
