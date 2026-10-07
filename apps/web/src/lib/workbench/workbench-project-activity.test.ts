import { describe, expect, it, vi } from "vitest";
import { getProjectActivityView } from "./workbench-project-activity";

describe("getProjectActivityView", () => {
  it("merges Project approvals, events, and Task activity by occurrence time", async () => {
    const db = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1", name: "交付中心" }) },
      approvalRequest: { findMany: vi.fn().mockResolvedValue([{ id: "approval_1", type: "merge", status: "pending", requestedByActor: "agent:1", requestPayload: { action: "merge", scope: "main" }, policySnapshot: { reason: "需要人工确认" }, decisionReason: null, decidedByUserId: null, createdAt: new Date("2026-07-29T08:00:00.000Z"), decidedAt: null, task: { id: "task_1", title: "合并发布分支" } }]) },
      orchestrationEvent: { findMany: vi.fn().mockResolvedValue([{ id: "event_1", eventType: "project.activated", actorType: "user", actorId: "user_1", payload: {}, occurredAt: new Date("2026-07-29T09:00:00.000Z") }]) },
      taskActivity: { findMany: vi.fn().mockResolvedValue([{ id: "activity_1", type: "status.changed", actorType: "user", message: "任务进入进行中", createdAt: new Date("2026-07-29T10:00:00.000Z"), task: { id: "task_1", title: "合并发布分支" }, actor: { id: "user_1", name: "项目经理" } }]) },
    };

    const result = await getProjectActivityView({ projectId: "project_1", userId: "viewer_1", db, canWriteProject: vi.fn().mockResolvedValue(true) });

    expect(db.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "project_1", AND: expect.any(Array) }) }));
    expect(db.taskActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { task: { projectId: "project_1" } } }));
    expect(result?.canDecide).toBe(true);
    expect(result?.decisions[0]).toMatchObject({ id: "approval_1", action: "merge", scope: "main", policyReason: "需要人工确认" });
    expect(result?.timeline.map((entry) => entry.id)).toEqual(["activity_1", "event_1", "approval_1"]);
  });

  it("returns null before loading scoped facts when the Project is inaccessible", async () => {
    const approvals = vi.fn();
    await expect(getProjectActivityView({ projectId: "hidden", userId: "viewer_1", db: { project: { findFirst: vi.fn().mockResolvedValue(null) }, approvalRequest: { findMany: approvals }, orchestrationEvent: { findMany: vi.fn() }, taskActivity: { findMany: vi.fn() } }, canWriteProject: vi.fn() })).resolves.toBeNull();
    expect(approvals).not.toHaveBeenCalled();
  });
});
