import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  persistCompleted: vi.fn(),
  persistInterrupted: vi.fn(),
  persistBlocked: vi.fn(),
  persistFollowUp: vi.fn(),
  changeStatus: vi.fn(),
  rollout: vi.fn(() => ({ reads: true, writes: true })),
  authenticateAgent: vi.fn(),
}));

vi.mock("../../../../../packages/db/src/index", () => ({
  prisma: { task: { findUnique: mocks.findUnique } },
  persistCompletedTaskResultWithPrisma: mocks.persistCompleted,
  persistInterruptedTaskResultWithPrisma: mocks.persistInterrupted,
  persistBlockedTaskResultWithPrisma: mocks.persistBlocked,
  persistFollowUpTaskResultWithPrisma: mocks.persistFollowUp,
}));

vi.mock("./task-status-actions", () => ({
  normalizeWorkflowTemplateForActor: vi.fn((template) => template),
}));

vi.mock("./task-commands", () => ({
  changeUserTaskStatus: mocks.changeStatus,
}));

vi.mock("./task-rollout", async (importOriginal) => ({
  ...await importOriginal<typeof import("./task-rollout")>(),
  getUserTaskRollout: mocks.rollout,
}));

vi.mock("../agent/agent-auth", () => ({
  authenticateAgentRequest: mocks.authenticateAgent,
}));

vi.mock("../templates/matter-templates", () => ({
  getWorkflowTemplateByMatterType: vi.fn(() => ({
    id: "template_1",
    name: "Template",
    version: 1,
    firstStepKey: "run_cli",
    steps: [{
      id: "step_1",
      key: "run_cli",
      title: "Run CLI",
      description: "Execute the provider command",
      executorType: "human",
      assigneeUserId: "user_1",
    }],
  })),
}));

vi.mock("./legacy-workflow-task", () => ({
  assertLegacyWorkflowTask: vi.fn(),
}));

import { authenticateCliTaskReport, reportCliTaskStatusAction } from "./cli-report-actions";

function taskRow() {
  const now = new Date("2026-07-22T10:00:00.000Z");
  return {
    id: "task_1",
    teamId: "team_1",
    projectId: "project_1",
    workflowInstanceId: "workflow_1",
    stepTemplateId: "step_1",
    title: "Run Codex",
    description: "Implement the change",
    status: "active",
    statusCategory: "in_progress",
    acceptanceMode: "none",
    version: 7,
    executorType: "ai",
    queuePosition: 1,
    assigneeUserId: "user_1",
    localPath: null,
    command: "codex",
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    workflowInstance: {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_1",
      workflowTemplateId: "template_1",
      title: "Deliver feature",
      description: null,
      status: "running",
      currentStepKey: "run_cli",
      createdById: "user_1",
      createdAt: now,
      updatedAt: now,
    },
  };
}

describe("reportCliTaskStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(taskRow());
    mocks.changeStatus.mockResolvedValue({ taskId: "task_1", statusCategory: "in_review", version: 8 });
    mocks.rollout.mockReturnValue({ reads: true, writes: true });
    mocks.authenticateAgent.mockResolvedValue({ userId: "user_1", teamId: "team_1" });
  });

  it("authenticates the CLI token against the Task actor and team", async () => {
    await authenticateCliTaskReport({
      taskId: "task_1",
      authorizationHeader: "Bearer token_123",
    });

    expect(mocks.authenticateAgent).toHaveBeenCalledWith({
      authorizationHeader: "Bearer token_123",
      userId: "user_1",
      expectedTeamId: "team_1",
    });
  });

  it("loads the user Task projection and persists CLI completion as a review candidate", async () => {
    const result = await reportCliTaskStatusAction({
      taskId: "task_1",
      status: "completed",
      exitCode: 0,
      outputSummary: "Tests and build passed",
      now: new Date("2026-07-22T10:05:00.000Z"),
    });

    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_1" },
    }));
    expect(mocks.changeStatus).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" },
      taskId: "task_1",
      expectedVersion: 7,
      command: "submit_for_review",
      reason: "Tests and build passed",
    }));
    expect(mocks.persistCompleted).not.toHaveBeenCalled();
    expect(result.task.status).toBe("active");
    expect(result.nextTask).toBeNull();
  });

  it("keeps legacy completion active during the reads-only rollout phase", async () => {
    mocks.rollout.mockReturnValue({ reads: true, writes: false });
    mocks.persistCompleted.mockResolvedValue(undefined);

    await reportCliTaskStatusAction({
      taskId: "task_1",
      status: "completed",
      exitCode: 0,
      now: new Date("2026-07-22T10:05:00.000Z"),
    });

    expect(mocks.persistCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });
});
