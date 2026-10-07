import { describe, expect, it, vi } from "vitest";
import { dispatchMcpProjectTool } from "./project-tools";

describe("MCP Project tools", () => {
  it("lists accessible projects with explicit ID and version key guidance", async () => {
    const getProjectListItems = vi.fn().mockResolvedValue([{ id: "project_1", version: 4, name: "HumanThread" }]);
    const result = await dispatchMcpProjectTool({
      tool: "list_projects",
      actorUserId: "user_1",
      arguments: { search: "Human" },
    }, { getProjectListItems });

    expect(result).toEqual({
      projects: [{ id: "project_1", version: 4, name: "HumanThread" }],
      keyGuide: { projectId: "projects[].id", projectVersion: "projects[].version" },
    });
    expect(getProjectListItems).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", search: "Human" }));
  });

  it("reads a roadmap with canonical project, stage, milestone, task, and date keys", async () => {
    const getProjectHubView = vi.fn().mockResolvedValue({
      project: { id: "project_1", version: 4 },
      roadmap: [{ id: "stage_1", version: 2, milestones: [{ id: "milestone_1", version: 3, tasks: [] }] }],
      health: { blockers: 0 },
      taskSummary: { total: 0 },
    });
    const result = await dispatchMcpProjectTool({
      tool: "get_project_roadmap",
      actorUserId: "user_1",
      arguments: { projectId: "project_1" },
    }, { getProjectHubView });

    expect(result).toMatchObject({
      project: { id: "project_1", version: 4 },
      keys: {
        projectId: "project_1",
        projectVersion: "project.version",
        stageId: "roadmap[].id",
        milestoneId: "roadmap[].milestones[].id",
        taskDeadline: expect.stringContaining("dueAt"),
      },
    });
  });

  it("creates and updates project roadmap stages through authenticated commands", async () => {
    const submitProjectPlan = vi.fn().mockResolvedValue({ projectId: "project_1", status: "planned", version: 2 });
    const commandProjectRoadmap = vi.fn().mockResolvedValue({ projectId: "project_1", version: 3 });
    await dispatchMcpProjectTool({
      tool: "create_project_roadmap",
      actorUserId: "user_1",
      arguments: {
        commandId: "cmd_plan",
        projectId: "project_1",
        expectedVersion: 1,
        objective: "交付稳定版本",
        stages: [{ key: "delivery", name: "交付", milestones: [{ name: "MVP" }] }],
      },
    }, { submitProjectPlan });
    await dispatchMcpProjectTool({
      tool: "update_project_roadmap",
      actorUserId: "user_1",
      arguments: {
        commandId: "cmd_stage",
        projectId: "project_1",
        expectedVersion: 2,
        action: { type: "stage.create", name: "发布", targetAt: "2026-08-31T12:00:00.000Z" },
      },
    }, { commandProjectRoadmap });

    expect(submitProjectPlan).toHaveBeenCalledWith(expect.objectContaining({ actor: { type: "user", id: "user_1" } }));
    expect(commandProjectRoadmap).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" },
      action: { type: "stage.create", name: "发布", targetAt: "2026-08-31T12:00:00.000Z" },
    }));
  });

  it("creates a Project with explicit start and target dates", async () => {
    const createWorkbenchProject = vi.fn().mockResolvedValue({ projectId: "project_new", version: 1 });
    await dispatchMcpProjectTool({
      tool: "create_project",
      actorUserId: "user_1",
      arguments: {
        spaceId: "space_1",
        name: "客户端交付",
        objective: "稳定交付桌面客户端",
        managerUserId: "user_1",
        startAt: "2026-08-18T00:00:00.000Z",
        targetAt: "2026-08-31T12:00:00.000Z",
      },
    } as never, { createWorkbenchProject } as never);

    expect(createWorkbenchProject).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      startAt: new Date("2026-08-18T00:00:00.000Z"),
      targetAt: new Date("2026-08-31T12:00:00.000Z"),
    }));
  });

  it("changes the Project lifecycle using its current version", async () => {
    const activateProject = vi.fn().mockResolvedValue({ projectId: "project_1", status: "active", version: 3 });
    await dispatchMcpProjectTool({
      tool: "change_project_status",
      actorUserId: "user_1",
      arguments: { commandId: "cmd_activate", projectId: "project_1", expectedVersion: 2, command: "activate" },
    } as never, { activateProject } as never);

    expect(activateProject).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" },
      projectId: "project_1",
      expectedVersion: 2,
    }));
  });

  it("lists Project members with the canonical user ID key", async () => {
    const getProjectMemberView = vi.fn().mockResolvedValue({
      project: { id: "project_1", name: "HumanThread" },
      members: [{ id: "membership_1", role: "manager", user: { id: "user_2", name: "Owner" } }],
    });
    const result = await dispatchMcpProjectTool({
      tool: "list_project_members",
      actorUserId: "user_1",
      arguments: { projectId: "project_1" },
    } as never, { getProjectMemberView } as never);

    expect(result).toMatchObject({
      members: [{ user: { id: "user_2" } }],
      keyGuide: { userId: "members[].user.id" },
    });
  });
});
