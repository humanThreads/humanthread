import { describe, expect, it, vi } from "vitest";
import {
  loadTaskAcceptanceReadiness,
  recordAutomatedTaskAcceptanceEvidence,
  submitTaskAcceptanceEvidence,
} from "./task-acceptance-evidence";

function dependencies(overrides: Record<string, unknown> = {}) {
  const checkDefinitionUpsert = vi.fn().mockResolvedValue({ id: "check_definition_1" });
  const checkResultCreate = vi.fn().mockResolvedValue({});
  const taskUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    loadContext: vi.fn().mockResolvedValue({
      task: {
        id: "task_1",
        projectId: "project_1",
        acceptancePolicy: { requiredChecks: ["test", "typecheck"] },
      },
      results: [],
    }),
    authorize: vi.fn().mockResolvedValue({ allowed: true, role: "creator" }),
    execute: vi.fn().mockImplementation(async (input) => {
      const applied = await input.persist({
        task: { updateMany: taskUpdateMany },
        checkDefinition: { upsert: checkDefinitionUpsert },
        checkResult: { create: checkResultCreate },
      });
      return applied.result;
    }),
    checkDefinitionUpsert,
    checkResultCreate,
    taskUpdateMany,
    ...overrides,
  };
}

describe("Task acceptance evidence", () => {
  it("records internal automated evidence with AgentRun provenance without user authorization", async () => {
    const deps = dependencies();

    await recordAutomatedTaskAcceptanceEvidence({
      systemActorId: "task-development-loop",
      agentRunId: "agent_run_1",
      commandId: "command_automated_evidence",
      correlationId: "loop:loop_run_1",
      taskId: "task_1",
      expectedVersion: 4,
      checkKey: "test",
      status: "passed",
      summary: "Task branch tests passed",
      evidence: {
        loopRunId: "loop_run_1",
        branch: "2026-HT100023",
        headCommit: "a".repeat(40),
      },
    }, deps as never);

    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.checkResultCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentRunId: "agent_run_1",
        evidence: {
          source: "automation",
          actorType: "system",
          actorId: "task-development-loop",
          commandId: "command_automated_evidence",
          loopRunId: "loop_run_1",
          branch: "2026-HT100023",
          headCommit: "a".repeat(40),
        },
      }),
    });
  });

  it("authorizes before loading Task acceptance context", async () => {
    const loadContext = vi.fn();
    const deps = dependencies({
      loadContext,
      authorize: vi.fn().mockRejectedValue(Object.assign(new Error("Task not found"), { code: "task_not_found" })),
    });

    await expect(submitTaskAcceptanceEvidence({
      actor: { type: "user", id: "user_denied" },
      source: "mcp",
      commandId: "command_denied_evidence",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 1,
      checkKey: "test",
      status: "passed",
      summary: "Should not be inspected",
    }, deps as never)).rejects.toMatchObject({ code: "task_not_found" });
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("persists immutable user evidence and returns the resulting readiness", async () => {
    const deps = dependencies();
    const result = await submitTaskAcceptanceEvidence({
      actor: { type: "user", id: "user_1" },
      source: "user",
      commandId: "command_evidence_test",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 7,
      checkKey: "test",
      status: "passed",
      summary: "All tests passed",
      evidenceMarkdown: "2,054 tests passed in CI run 481.",
      startedAt: new Date("2026-08-01T08:55:00.000Z"),
      finishedAt: new Date("2026-08-01T09:00:00.000Z"),
    }, deps as never);

    expect(result).toMatchObject({
      taskId: "task_1",
      checkKey: "test",
      status: "passed",
      version: 8,
      readiness: {
        ready: false,
        requiredChecks: ["test", "typecheck"],
        missingChecks: ["typecheck"],
        blockingChecks: [],
      },
    });
    expect(deps.checkDefinitionUpsert).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^acceptance-check:/u) },
      create: expect.objectContaining({
        taskId: "task_1",
        projectId: "project_1",
        type: "acceptance",
        name: "test",
        required: true,
      }),
      update: expect.objectContaining({ required: true }),
    });
    expect(deps.checkResultCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.stringMatching(/^acceptance-evidence:/u),
        taskId: "task_1",
        checkDefinitionId: expect.stringMatching(/^acceptance-check:/u),
        agentRunId: null,
        status: "passed",
        summary: "All tests passed",
        evidence: {
          source: "user",
          actorType: "user",
          actorId: "user_1",
          commandId: "command_evidence_test",
          evidenceMarkdown: "2,054 tests passed in CI run 481.",
        },
      }),
    });
    expect(deps.taskUpdateMany).toHaveBeenCalledWith({
      where: { id: "task_1", version: 7 },
      data: { version: { increment: 1 } },
    });
  });

  it("records MCP provenance without letting the source replace actor identity", async () => {
    const deps = dependencies();
    await submitTaskAcceptanceEvidence({
      actor: { type: "user", id: "user_1" },
      source: "mcp",
      commandId: "command_mcp_evidence",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 2,
      checkKey: "test",
      status: "failed",
      summary: "One regression failed",
    }, deps as never);

    expect(deps.checkResultCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        evidence: {
          source: "mcp",
          actorType: "user",
          actorId: "user_1",
          commandId: "command_mcp_evidence",
        },
      }),
    });
  });

  it("allows a newer passing result to supersede a failed result without deleting it", async () => {
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({
        task: {
          id: "task_1",
          projectId: "project_1",
          acceptancePolicy: { requiredChecks: ["test"] },
        },
        results: [{
          id: "evidence_failed",
          checkKey: "test",
          status: "failed",
          summary: "Old failure",
          source: "automation",
          finishedAt: new Date("2026-08-01T08:00:00.000Z"),
        }],
      }),
    });
    const result = await submitTaskAcceptanceEvidence({
      actor: { type: "user", id: "user_1" },
      source: "user",
      commandId: "command_evidence_retry",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 3,
      checkKey: "test",
      status: "passed",
      summary: "Regression fixed",
      finishedAt: new Date("2026-08-01T09:00:00.000Z"),
    }, deps as never);

    expect(result.readiness.ready).toBe(true);
    expect(deps.checkResultCreate).toHaveBeenCalledOnce();
  });

  it("ignores evidence definitions owned by a Task's previous Project", async () => {
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({
        task: {
          id: "task_1",
          projectId: "project_new",
          acceptancePolicy: { requiredChecks: ["test"] },
        },
        results: [{
          id: "evidence_old_project",
          definitionProjectId: "project_old",
          checkKey: "test",
          status: "passed",
          summary: "Old project evidence",
          source: "mcp",
          finishedAt: new Date("2026-08-01T08:00:00.000Z"),
        }],
      }),
    });

    await expect(loadTaskAcceptanceReadiness({ taskId: "task_1" }, deps as never)).resolves.toMatchObject({
      ready: false,
      missingChecks: ["test"],
    });
  });

  it("rejects evidence for a check outside the Task acceptance policy", async () => {
    const deps = dependencies();
    await expect(submitTaskAcceptanceEvidence({
      actor: { type: "user", id: "user_1" },
      source: "user",
      commandId: "command_unknown_check",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 1,
      checkKey: "security",
      status: "passed",
      summary: "Looks good",
    }, deps as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("requires Project-scoped persistence for acceptance check definitions", async () => {
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({
        task: { id: "task_1", projectId: null, acceptancePolicy: null },
        results: [],
      }),
    });
    await expect(submitTaskAcceptanceEvidence({
      actor: { type: "user", id: "user_1" },
      source: "user",
      commandId: "command_personal_evidence",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 1,
      checkKey: "delivery",
      status: "passed",
      summary: "Delivered",
    }, deps as never)).rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.execute).not.toHaveBeenCalled();
  });
});
