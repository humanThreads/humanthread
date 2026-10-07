import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignUserTask, changeUserTaskStatus, rejectUserTask, updateUserTaskFields, updateUserTaskSchedule } from "@/lib/tasks/task-commands";
import { submitTaskAcceptanceEvidence } from "@/lib/tasks/task-acceptance-evidence";
import { OPTIONS, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/tasks/task-commands", () => ({
  changeUserTaskStatus: vi.fn(),
  addUserTaskBlocker: vi.fn(),
  resolveUserTaskBlocker: vi.fn(),
  archiveUserTask: vi.fn(),
  restoreUserTask: vi.fn(),
  dispatchUserTaskToAgent: vi.fn(),
  rejectUserTask: vi.fn(),
  assignUserTask: vi.fn(),
  updateUserTaskFields: vi.fn(),
  updateUserTaskSchedule: vi.fn(),
}));
vi.mock("@/lib/tasks/task-acceptance-evidence", () => ({
  submitTaskAcceptanceEvidence: vi.fn(),
}));

describe("POST /api/tasks/:taskId/commands/:command", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards commandId and expectedVersion to the Task command service", async () => {
    vi.mocked(changeUserTaskStatus).mockResolvedValue({ taskId: "task_1", statusCategory: "in_progress", version: 2 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "command_start", expectedVersion: 1 }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "start" }) });

    expect(response.status).toBe(200);
    expect(changeUserTaskStatus).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_session" },
      commandId: "command_start",
      expectedVersion: 1,
      command: "start",
    }));
  });

  it("submits bounded acceptance evidence with user provenance", async () => {
    vi.mocked(submitTaskAcceptanceEvidence).mockResolvedValue({
      taskId: "task_1",
      evidenceId: "evidence_1",
      checkKey: "delivery",
      status: "passed",
      readiness: { ready: true },
      version: 3,
    } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/submit_acceptance_evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "command_evidence_1",
        expectedVersion: 2,
        checkKey: "delivery",
        status: "passed",
        summary: "正式环境验收通过",
        evidenceMarkdown: "发布版本 image@sha256:abc",
        startedAt: "2026-08-01T09:00:00.000Z",
        finishedAt: "2026-08-01T09:05:00.000Z",
      }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "submit_acceptance_evidence" }) });

    expect(response.status).toBe(200);
    expect(submitTaskAcceptanceEvidence).toHaveBeenCalledWith({
      actor: { type: "user", id: "user_session" },
      source: "user",
      commandId: "command_evidence_1",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 2,
      checkKey: "delivery",
      status: "passed",
      summary: "正式环境验收通过",
      evidenceMarkdown: "发布版本 image@sha256:abc",
      startedAt: new Date("2026-08-01T09:00:00.000Z"),
      finishedAt: new Date("2026-08-01T09:05:00.000Z"),
    });
  });

  it("does not forward caller-provided acceptancePassed", async () => {
    vi.mocked(changeUserTaskStatus).mockResolvedValue({ taskId: "task_1", version: 3 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "command_accept", expectedVersion: 2, acceptancePassed: true }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "accept" }) });

    expect(response.status).toBe(200);
    expect(changeUserTaskStatus).toHaveBeenCalledWith({
      actor: { type: "user", id: "user_session" },
      commandId: "command_accept",
      correlationId: "task:task_1",
      taskId: "task_1",
      expectedVersion: 2,
      command: "accept",
    });
  });

  it("returns 422 with current state for invalid transitions", async () => {
    vi.mocked(changeUserTaskStatus).mockRejectedValue(Object.assign(new Error("task_invalid_transition"), {
      code: "task_invalid_transition",
      currentStatus: "todo",
      command: "accept",
    }));
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "command_accept", expectedVersion: 1 }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "accept" }) });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "task_invalid_transition",
      currentStatus: "todo",
      allowedCommands: ["start", "cancel"],
    });
  });

  it("returns structured acceptance readiness blockers", async () => {
    vi.mocked(changeUserTaskStatus).mockRejectedValue(Object.assign(new Error("task_acceptance_evidence_required"), {
      code: "task_acceptance_evidence_required",
      currentStatus: "in_review",
      command: "accept",
      missingChecks: ["typecheck"],
      blockingChecks: ["test"],
    }));
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "command_accept", expectedVersion: 2 }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "accept" }) });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "task_acceptance_evidence_required",
      currentStatus: "in_review",
      missingChecks: ["typecheck"],
      blockingChecks: ["test"],
    });
  });

  it("requires a reason for rejection and uses the dedicated command", async () => {
    expect((await POST(new Request("http://localhost/api/tasks/task_1/commands/reject", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "command_reject", expectedVersion: 1 }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "reject" }) })).status).toBe(400);

    vi.mocked(rejectUserTask).mockResolvedValue({ taskId: "task_1", statusCategory: "in_progress", version: 2 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/reject", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "command_reject", expectedVersion: 1, reason: "证据不足" }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "reject" }) });
    expect(response.status).toBe(200);
    expect(rejectUserTask).toHaveBeenCalledWith(expect.objectContaining({ reason: "证据不足" }));
  });

  it("routes assignment and field updates through versioned Task commands", async () => {
    vi.mocked(assignUserTask).mockResolvedValue({ taskId: "task_1", version: 2 } as never);
    vi.mocked(updateUserTaskFields).mockResolvedValue({ taskId: "task_1", version: 2 } as never);
    const assignment = await POST(new Request("http://localhost/api/tasks/task_1/commands/assign", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "command_assign", expectedVersion: 1, assigneeUserId: "user_2" }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "assign" }) });
    expect(assignment.status).toBe(200);
    expect(assignUserTask).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: "user_2" }));
    const update = await POST(new Request("http://localhost/api/tasks/task_1/commands/update_fields", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "command_fields", expectedVersion: 1, priority: 2, projectId: "project_1" }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "update_fields" }) });
    expect(update.status).toBe(200);
    expect(updateUserTaskFields).toHaveBeenCalledWith(expect.objectContaining({ priority: 2, projectId: "project_1" }));
  });

  it("routes schedule updates with nullable ISO dates", async () => {
    vi.mocked(updateUserTaskSchedule).mockResolvedValue({ taskId: "task_1", version: 2 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/update_schedule", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "command_schedule", expectedVersion: 1, startAt: null, dueAt: "2026-07-25T09:00:00.000Z" }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "update_schedule" }) });
    expect(response.status).toBe(200);
    expect(updateUserTaskSchedule).toHaveBeenCalledWith(expect.objectContaining({ startAt: null, dueAt: new Date("2026-07-25T09:00:00.000Z") }));
  });

  it("routes recurring Loop binding updates", async () => {
    vi.mocked(updateUserTaskSchedule).mockResolvedValue({ taskId: "task_1", version: 2 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/update_schedule", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "command_schedule_loop", expectedVersion: 1, recurrenceRule: "0 9 * * 1", loopBinding: { bindingId: "binding_1", bindingType: "task" } }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "update_schedule" }) });

    expect(response.status).toBe(200);
    expect(updateUserTaskSchedule).toHaveBeenCalledWith(expect.objectContaining({
      recurrenceRule: "0 9 * * 1",
      loopBinding: { bindingId: "binding_1", bindingType: "task" },
    }));
  });

  it("routes title updates through the field command", async () => {
    vi.mocked(updateUserTaskFields).mockResolvedValue({ taskId: "task_1", title: "新标题", version: 2 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/update_fields", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "command_title", expectedVersion: 1, title: "新标题" }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "update_fields" }) });
    expect(response.status).toBe(200);
    expect(updateUserTaskFields).toHaveBeenCalledWith(expect.objectContaining({ title: "新标题" }));
  });

  it("allows configured desktop origins for preflight and command responses", async () => {
    const origin = "http://localhost:1420";
    const preflight = OPTIONS(new Request("http://localhost/api/tasks/task_1/commands/start", {
      method: "OPTIONS",
      headers: { origin },
    }));
    vi.mocked(changeUserTaskStatus).mockResolvedValue({ taskId: "task_1", version: 2 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/commands/start", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ commandId: "desktop_command_1", expectedVersion: 1 }),
    }), { params: Promise.resolve({ taskId: "task_1", command: "start" }) });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  });
});
