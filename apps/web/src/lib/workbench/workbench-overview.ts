import {
  getCurrentTaskForUser,
  getTeamOverview,
  getWorkflowTimeline,
  type CurrentTaskForUserResult,
  type TeamOverviewResult,
  type WorkflowTimelineResult,
} from "../overviews/task-overviews";
import {
  getWorkbenchDevices,
  type WorkbenchDeviceOverview,
} from "./workbench-devices";

export interface WorkbenchOverviewInput {
  teamId: string;
  userId: string;
  companyId?: string;
  ownerType?: "company" | "personal";
}

export interface WorkbenchOverviewResult {
  currentTask: CurrentTaskForUserResult["currentTask"];
  queueLength: number;
  queuedTasks: CurrentTaskForUserResult["queuedTasks"];
  team: TeamOverviewResult["team"];
  members: TeamOverviewResult["members"];
  devices: WorkbenchDeviceOverview[];
  timeline: WorkflowTimelineResult;
}

interface WorkbenchOverviewDependencies {
  getCurrentTaskForUser: typeof getCurrentTaskForUser;
  getTeamOverview: typeof getTeamOverview;
  getWorkbenchDevices: typeof getWorkbenchDevices;
  getWorkflowTimeline: typeof getWorkflowTimeline;
}

export async function getWorkbenchOverview(
  input: WorkbenchOverviewInput,
  dependencies: WorkbenchOverviewDependencies = {
    getCurrentTaskForUser,
    getTeamOverview,
    getWorkbenchDevices,
    getWorkflowTimeline,
  },
): Promise<WorkbenchOverviewResult> {
  const [currentTaskResult, teamOverview, devices] = await Promise.all([
    dependencies.getCurrentTaskForUser({
      teamId: input.teamId,
      userId: input.userId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.ownerType ? { ownerType: input.ownerType } : {}),
    }),
    dependencies.getTeamOverview({
      teamId: input.teamId,
      userId: input.userId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.ownerType ? { ownerType: input.ownerType } : {}),
    }),
    dependencies.getWorkbenchDevices({
      teamId: input.teamId,
    }),
  ]);

  const timeline = currentTaskResult.currentTask
    ? await dependencies.getWorkflowTimeline({
        workflowId: currentTaskResult.currentTask.workflow.id,
      })
    : {
        workflow: null,
        events: [],
      };

  return {
    currentTask: currentTaskResult.currentTask,
    queueLength: currentTaskResult.queueLength,
    queuedTasks: currentTaskResult.queuedTasks,
    team: teamOverview.team,
    members: teamOverview.members,
    devices,
    timeline,
  };
}
