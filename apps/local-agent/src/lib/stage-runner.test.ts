import { describe, expect, it } from "vitest";

import type { LoopAssignment } from "@humanthread/shared";
import type { ProjectLoopStageContract, ResolvedStageResources } from "@humanthread/project-loop-sync";
import { buildStageExecution } from "./stage-runner";

const stage = {
  loopId: "loop_1",
  subloopId: "develop",
  stagePath: ".humanthread/loops/project/subloops/develop",
  configured: true,
  businessGoal: "Implement the approved requirement.",
  inputScope: { codeAccess: true, writeAccess: true, include: ["src/**"], exclude: ["dist/**"], allowedCommands: ["pnpm test"], blockedPaths: [".env"] },
  resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
  checklist: [{ id: "tests", title: "Run tests", fingerprintInputs: ["src/**"], evidence: ["artifacts/test.json"], reusePolicy: "VERIFY" }],
  qualityGate: { checks: ["pnpm test"], requiredArtifacts: ["artifacts/test.json"], minConfidence: 0.8 },
  agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
  skillSelection: { schemaVersion: 1, mode: "include", skills: ["humanthread-mcp"] },
  outputSchema: { type: "object" },
  fingerprint: `sha256:${"a".repeat(64)}`,
} satisfies ProjectLoopStageContract;

const resources = {
  prompt: "Implement {{task}} and return evidence.",
  rules: [{ path: `${stage.stagePath}/rules/project.md`, content: "Never expose credentials." }],
  resources: [{ path: `${stage.stagePath}/resources/map.json`, content: "{}" }],
  schemas: [{ path: `${stage.stagePath}/schemas/artifact.json`, content: "{}" }],
  templates: [{ path: `${stage.stagePath}/templates/report.md`, content: "# Report" }],
  skills: [{ key: "humanthread-mcp", path: ".agents/skills/humanthread-mcp/SKILL.md", content: "Use HumanThread MCP." }],
  fingerprint: `sha256:${"b".repeat(64)}`,
} satisfies ResolvedStageResources;

const assignment = {
  id: "assignment_1",
  loopRunId: "loop_run_1",
  loopNodeRunId: "node_run_1",
  loopNodeAttemptId: "attempt_1",
  node: { key: "develop", label: "Develop" },
  inputSnapshot: {
    taskId: "task_1",
    projectId: "project_1",
    taskNumber: 13,
    shortId: "HT100013",
    taskBranch: "2026-HT100013",
    taskCreatedAt: "2026-08-10T01:00:00.000Z",
    productionBranch: "main",
    stagingBranch: "stage",
    internalNote: "must-not-enter-the-prompt",
  },
  checkpointSnapshot: { commit: "abc123" },
} as unknown as LoopAssignment;

describe("buildStageExecution", () => {
  it("uses the same selected Skills and context fingerprint for Codex and Claude", async () => {
    const constraints = {
      sources: [{ relativePath: "AGENTS.md", content: "Project rules first." }],
      checks: [],
      fingerprint: `sha256:${"c".repeat(64)}` as const,
    };
    const codex = await buildStageExecution({ stage, resources, assignment, provider: "codex", constraints });
    const claude = await buildStageExecution({ stage, resources, assignment, provider: "claude", constraints });

    expect(codex.context.skills).toEqual([".agents/skills/humanthread-mcp/SKILL.md"]);
    expect(claude.context.skills).toEqual(codex.context.skills);
    expect(codex.contextFingerprint).toBe(claude.contextFingerprint);
    expect(codex.prompt.indexOf("Project rules first.")).toBeLessThan(codex.prompt.indexOf("Never expose credentials."));
    expect(codex.prompt).toContain(".agents/skills/humanthread-mcp/SKILL.md");
    expect(codex.prompt).toContain("loop_run_1");
    expect(codex.prompt).toContain("Blocked paths: .env");
  });

  it("includes only authoritative task execution context in the Stage prompt", async () => {
    const execution = await buildStageExecution({ stage, resources, assignment, provider: "codex" });

    expect(execution.prompt).toContain("Task execution context:");
    expect(execution.prompt).toContain('"taskId":"task_1"');
    expect(execution.prompt).toContain('"shortId":"HT100013"');
    expect(execution.prompt).toContain('"taskBranch":"2026-HT100013"');
    expect(execution.prompt).toContain('"productionBranch":"main"');
    expect(execution.prompt).toContain('"stagingBranch":"stage"');
    expect(execution.prompt).not.toContain("internalNote");
    expect(execution.prompt).not.toContain("must-not-enter-the-prompt");
  });

  it("includes platform scheduled task content in the Stage prompt", async () => {
    const execution = await buildStageExecution({
      stage,
      resources,
      assignment: {
        ...assignment,
        inputSnapshot: {
          scheduledTask: {
            id: "a".repeat(32),
            name: "Daily inspection",
            description: "Inspect the previous delivery.",
            contentMode: "platform",
            contentMarkdown: "# Checks\n- Inspect logs\n- Verify artifacts",
          },
          internalNote: "must-not-enter-the-prompt",
        },
      },
      provider: "codex",
    });

    expect(execution.prompt).toContain("Scheduled task execution context:");
    expect(execution.prompt).toContain(`Scheduled task id: ${"a".repeat(32)}`);
    expect(execution.prompt).toContain("Scheduled task name: Daily inspection");
    expect(execution.prompt).toContain("Scheduled task description: Inspect the previous delivery.");
    expect(execution.prompt).toContain("# Checks\n- Inspect logs\n- Verify artifacts");
    expect(execution.prompt).not.toContain("internalNote");
    expect(execution.prompt).not.toContain("must-not-enter-the-prompt");
  });

  it.each([
    { label: "project root with a task child", snapshot: { taskId: "task_1", scheduledTaskRunId: "b".repeat(32) } },
    { label: "task-scoped root with a child", snapshot: { taskId: "task_1", taskLoopRoot: true, scheduledTaskRunId: "b".repeat(32) } },
  ])("includes frozen child scheduled-task content for a $label", async ({ snapshot }) => {
    const execution = await buildStageExecution({
      stage,
      resources,
      assignment: {
        ...assignment,
        inputSnapshot: {
          ...snapshot,
          scheduledTask: {
            id: "b".repeat(32),
            name: "Child inspection",
            description: "Resolved through validated ancestry.",
            contentMode: "platform",
            contentMarkdown: "# Child checks",
          },
        },
      },
      provider: "codex",
    });

    expect(execution.prompt).toContain("Scheduled task name: Child inspection");
    expect(execution.prompt).toContain("# Child checks");
    expect(execution.prompt).not.toContain("contentSnapshot");
  });

  it("omits loop-managed scheduled task content from the Stage prompt", async () => {
    const execution = await buildStageExecution({
      stage,
      resources,
      assignment: {
        ...assignment,
        inputSnapshot: {
          scheduledTask: {
            id: "a".repeat(32),
            name: "Project-managed inspection",
            description: "The Loop supplies its own content.",
            contentMode: "loop_managed",
            contentMarkdown: "# Must not leak",
          },
        },
      },
      provider: "codex",
    });

    expect(execution.prompt).toContain("Scheduled task name: Project-managed inspection");
    expect(execution.prompt).toContain("Scheduled task description: The Loop supplies its own content.");
    expect(execution.prompt).not.toContain("Scheduled task content:");
    expect(execution.prompt).not.toContain("# Must not leak");
    expect(execution.prompt).not.toContain("contentMarkdown");
  });

  it("bounds and redacts scheduled task prompt content", async () => {
    const execution = await buildStageExecution({
      stage,
      resources,
      assignment: {
        ...assignment,
        inputSnapshot: {
          scheduledTask: {
            id: "a".repeat(32),
            name: "Credential inspection",
            description: "Reset the password workflow after review.",
            contentMode: "platform",
            contentMarkdown: "password=inline-secret\nBearer abc.def.ghi\nx".repeat(1_000),
          },
        },
      },
      provider: "codex",
    });

    expect(execution.prompt).toContain("Reset the password workflow after review.");
    expect(execution.prompt).toContain("password=[redacted]");
    expect(execution.prompt).not.toContain("inline-secret");
    expect(execution.prompt).not.toContain("abc.def.ghi");
    expect(execution.prompt.length).toBeLessThan(50_000);
  });
});
