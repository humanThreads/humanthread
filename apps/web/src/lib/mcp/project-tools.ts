import { activateProject, pauseProject, resumeProject, submitProjectPlan } from "../orchestration/project-commands";
import { commandProjectRoadmap, type ProjectRoadmapAction } from "../orchestration/project-roadmap-commands";
import { createWorkbenchProject, updateWorkbenchProject } from "../workbench/workbench-project-commands";
import { getProjectMemberView } from "../workbench/workbench-project-members";
import { getProjectHubView, getProjectListItems, type ProjectHealth } from "../workbench/workbench-projects";

type ProjectDependencies = Partial<{
  getProjectListItems: typeof getProjectListItems;
  getProjectHubView: typeof getProjectHubView;
  getProjectMemberView: typeof getProjectMemberView;
  commandProjectRoadmap: typeof commandProjectRoadmap;
  submitProjectPlan: typeof submitProjectPlan;
  createWorkbenchProject: typeof createWorkbenchProject;
  updateWorkbenchProject: typeof updateWorkbenchProject;
  activateProject: typeof activateProject;
  pauseProject: typeof pauseProject;
  resumeProject: typeof resumeProject;
}>;

export type McpProjectToolRequest =
  | { tool: "list_projects"; actorUserId: string; arguments: { search?: string; status?: string; health?: ProjectHealth; ownerType?: "company" | "personal" } }
  | { tool: "create_project"; actorUserId: string; arguments: { spaceId: string; name: string; shortCode?: string; objective: string; managerUserId?: string; startAt?: string; targetAt?: string } }
  | { tool: "list_project_members"; actorUserId: string; arguments: { projectId: string } }
  | { tool: "get_project_roadmap"; actorUserId: string; arguments: { projectId: string } }
  | { tool: "create_project_roadmap"; actorUserId: string; arguments: { commandId: string; projectId: string; expectedVersion: number; objective: string; stages: Array<{ key: string; name: string; milestones: Array<{ name: string }> }> } }
  | { tool: "update_project_roadmap"; actorUserId: string; arguments: { commandId: string; projectId: string; expectedVersion: number; action: ProjectRoadmapAction } }
  | { tool: "update_project"; actorUserId: string; arguments: { projectId: string; expectedVersion: number; shortCode: string } }
  | { tool: "change_project_status"; actorUserId: string; arguments: { commandId: string; projectId: string; expectedVersion: number; command: "activate" | "pause" | "resume" } };

function roadmapKeys(projectId: string) {
  return {
    projectId,
    projectVersion: "project.version",
    stageId: "roadmap[].id",
    stageVersion: "roadmap[].version",
    milestoneId: "roadmap[].milestones[].id",
    milestoneVersion: "roadmap[].milestones[].version",
    taskId: "roadmap[].milestones[].tasks[].id",
    taskVersion: "roadmap[].milestones[].tasks[].version",
    stageDates: { startAt: "roadmap[].startAt", targetAt: "roadmap[].targetAt" },
    milestoneDate: "roadmap[].milestones[].targetAt",
    taskDeadline: "roadmap[].milestones[].tasks[].dueAt is available from get_task/list_tasks",
  };
}

export async function dispatchMcpProjectTool(request: McpProjectToolRequest, overrides: ProjectDependencies = {}) {
  const dependencies = {
    getProjectListItems,
    getProjectHubView,
    getProjectMemberView,
    commandProjectRoadmap,
    submitProjectPlan,
    createWorkbenchProject,
    updateWorkbenchProject,
    activateProject,
    pauseProject,
    resumeProject,
    ...overrides,
  };
  const actor = { type: "user" as const, id: request.actorUserId };

  switch (request.tool) {
    case "list_projects":
      return {
        projects: await dependencies.getProjectListItems({
          userId: request.actorUserId,
          ...(request.arguments.search ? { search: request.arguments.search } : {}),
          ...(request.arguments.status ? { status: request.arguments.status } : {}),
          ...(request.arguments.health ? { health: request.arguments.health } : {}),
          ...(request.arguments.ownerType ? { ownerType: request.arguments.ownerType } : {}),
        }),
        keyGuide: { projectId: "projects[].id", projectVersion: "projects[].version" },
      };
    case "create_project": {
      const result = await dependencies.createWorkbenchProject({
        userId: request.actorUserId,
        spaceId: request.arguments.spaceId,
        name: request.arguments.name,
        ...(request.arguments.shortCode ? { shortCode: request.arguments.shortCode } : {}),
        objective: request.arguments.objective,
        managerUserId: request.arguments.managerUserId ?? request.actorUserId,
        ...(request.arguments.startAt ? { startAt: new Date(request.arguments.startAt) } : {}),
        ...(request.arguments.targetAt ? { targetAt: new Date(request.arguments.targetAt) } : {}),
      });
      return { result, keyGuide: { projectId: "result.projectId", projectVersion: "result.version" } };
    }
    case "list_project_members": {
      const view = await dependencies.getProjectMemberView({ projectId: request.arguments.projectId, userId: request.actorUserId });
      if (!view) throw Object.assign(new Error("Project not found"), { code: "not_found" });
      return { project: view.project, members: view.members, keyGuide: { userId: "members[].user.id", membershipId: "members[].id" } };
    }
    case "get_project_roadmap": {
      const view = await dependencies.getProjectHubView({ projectId: request.arguments.projectId, userId: request.actorUserId });
      if (!view) throw Object.assign(new Error("Project not found"), { code: "not_found" });
      return { project: view.project, roadmap: view.roadmap, health: view.health, taskSummary: view.taskSummary, keys: roadmapKeys(view.project.id) };
    }
    case "create_project_roadmap": {
      const result = await dependencies.submitProjectPlan({
        projectId: request.arguments.projectId,
        actor,
        commandId: request.arguments.commandId,
        correlationId: `mcp:project:plan:${request.arguments.projectId}`,
        expectedVersion: request.arguments.expectedVersion,
        payload: { objective: request.arguments.objective, stages: request.arguments.stages },
      });
      return { result, keys: roadmapKeys(request.arguments.projectId) };
    }
    case "update_project_roadmap": {
      const result = await dependencies.commandProjectRoadmap({
        projectId: request.arguments.projectId,
        actor,
        commandId: request.arguments.commandId,
        correlationId: `mcp:project:roadmap:${request.arguments.projectId}`,
        expectedVersion: request.arguments.expectedVersion,
        action: request.arguments.action,
      });
      return { result, keys: roadmapKeys(request.arguments.projectId) };
    }
    case "update_project": {
      const result = await dependencies.updateWorkbenchProject({
        userId: request.actorUserId,
        projectId: request.arguments.projectId,
        expectedVersion: request.arguments.expectedVersion,
        shortCode: request.arguments.shortCode,
      });
      return { result };
    }
    case "change_project_status": {
      const command = request.arguments.command === "activate"
        ? dependencies.activateProject
        : request.arguments.command === "pause"
          ? dependencies.pauseProject
          : dependencies.resumeProject;
      const result = await command({
        projectId: request.arguments.projectId,
        actor,
        commandId: request.arguments.commandId,
        correlationId: `mcp:project:${request.arguments.projectId}`,
        expectedVersion: request.arguments.expectedVersion,
      });
      return { result };
    }
  }
}
