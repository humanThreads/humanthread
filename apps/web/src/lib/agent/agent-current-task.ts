import type { AgentCurrentTaskResponse } from "@humanthread/shared";
import {
  getCurrentTaskForUser,
  type CurrentTaskForUserResult,
} from "../overviews/task-overviews";

export interface AgentCurrentTaskInput {
  teamId: string;
  userId: string;
}

export type AgentCurrentTaskResult = AgentCurrentTaskResponse;

interface AgentCurrentTaskDependencies {
  getCurrentTaskForUser: typeof getCurrentTaskForUser;
}

function mapCurrentTask(
  currentTask: CurrentTaskForUserResult["currentTask"],
): AgentCurrentTaskResult["task"] {
  if (!currentTask) {
    return null;
  }

  return {
    id: currentTask.task.id,
    title: currentTask.task.title,
    projectId: currentTask.project.id,
    projectName: currentTask.project.name,
    workflowInstanceId: currentTask.workflow.id,
    workflowTitle: currentTask.workflow.title,
    status: currentTask.task.status,
    localPath: currentTask.project.localPath,
    command: currentTask.project.defaultCommand,
    ...(currentTask.toolSession
      ? {
          toolSession: {
            id: currentTask.toolSession.id,
            sessionType: currentTask.toolSession.sessionType,
            sessionName: currentTask.toolSession.sessionName,
            status: currentTask.toolSession.status,
            lastOutputSummary: currentTask.toolSession.lastOutputSummary,
          },
        }
      : {}),
  };
}

export async function getAgentCurrentTask(
  input: AgentCurrentTaskInput,
  dependencies: AgentCurrentTaskDependencies = {
    getCurrentTaskForUser,
  },
): Promise<AgentCurrentTaskResult> {
  const result = await dependencies.getCurrentTaskForUser({
    teamId: input.teamId,
    userId: input.userId,
  });

  return {
    teamId: result.teamId,
    userId: result.userId,
    queueLength: result.queueLength,
    task: mapCurrentTask(result.currentTask),
  };
}
