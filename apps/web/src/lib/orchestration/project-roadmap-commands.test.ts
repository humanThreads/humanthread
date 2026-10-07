import { describe, expect, it, vi } from "vitest";
import { commandProjectRoadmap, persistProjectRoadmapAction } from "./project-roadmap-commands";

const base = {
  projectId: "project_1",
  actor: { type: "user" as const, id: "manager_1" },
  commandId: "command_1",
  correlationId: "project:project_1",
  expectedVersion: 4,
};

describe("commandProjectRoadmap", () => {
  it("authorizes and forwards a fine-grained stage mutation through the idempotent executor", async () => {
    const authorize = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({ projectId: "project_1", version: 5 });
    const result = await commandProjectRoadmap({ ...base, action: { type: "stage.update", stageId: "stage_1", expectedNodeVersion: 2, name: "验证" } }, { authorize, execute });
    expect(authorize).toHaveBeenCalledWith({ userId: "manager_1", projectId: "project_1" });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, eventType: "project.roadmap.stage.updated", action: expect.objectContaining({ name: "验证" }) }));
    expect(result).toEqual({ projectId: "project_1", version: 5 });
  });

  it("lets the idempotent executor replay a completed command after the Project version advances", async () => {
    const execute = vi.fn().mockResolvedValue({ projectId: "project_1", version: 5 });
    await expect(commandProjectRoadmap({ ...base, action: { type: "stage.create", name: "发布" } }, { authorize: vi.fn(), execute })).resolves.toEqual({ projectId: "project_1", version: 5 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects non-user actors", async () => {
    await expect(commandProjectRoadmap({ ...base, actor: { type: "agent", id: "agent_1", runId: "run_1" }, action: { type: "stage.create", name: "发布" } }, { authorize: vi.fn(), execute: vi.fn() })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a stage reorder that omits a Project stage", async () => {
    const count = vi.fn(async ({ where }: { where: { id?: unknown } }) => where.id ? 1 : 2);
    const update = vi.fn().mockResolvedValue(undefined);
    await expect(persistProjectRoadmapAction({ projectStage: { count, update } } as never, { ...base, eventType: "project.roadmap.stage.reordered", action: { type: "stage.reorder", stageIds: ["stage_1"] } })).rejects.toMatchObject({ code: "validation_failed" });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a milestone reorder that omits a milestone from its stage", async () => {
    const count = vi.fn(async ({ where }: { where: { id?: unknown } }) => where.id ? 1 : 2);
    const update = vi.fn().mockResolvedValue(undefined);
    await expect(persistProjectRoadmapAction({ milestone: { count, update } } as never, { ...base, eventType: "project.roadmap.milestone.reordered", action: { type: "milestone.reorder", stageId: "stage_1", milestoneIds: ["milestone_1"] } })).rejects.toMatchObject({ code: "validation_failed" });
    expect(update).not.toHaveBeenCalled();
  });
});
