import type { AgentBinding } from "./binding";
import {
  checkAgentApiHealth,
  type AgentApiHealthResponse,
} from "./api";
import {
  loadAgentTaskSnapshot,
  type LoadAgentTaskSnapshotResult,
} from "./current-task-bootstrap";
import type { AgentDeviceStatus, LocalAgentPlatform } from "@humanthread/shared";

export interface DesktopSelfCheckInput {
  binding: AgentBinding;
  platform: LocalAgentPlatform;
}

interface DesktopSelfCheckDependencies {
  checkHealth: typeof checkAgentApiHealth;
  loadAgentTaskSnapshot: typeof loadAgentTaskSnapshot;
}

export interface DesktopSelfCheckResult {
  health: AgentApiHealthResponse;
  deviceStatus: AgentDeviceStatus;
  nextDeviceToken: string;
  taskSummary: {
    queueLength: number;
    taskId: string;
    taskTitle: string;
  } | null;
}

function buildTaskSummary(snapshot: LoadAgentTaskSnapshotResult) {
  const task = snapshot.taskResponse?.task;

  if (!task || !snapshot.taskResponse) {
    return null;
  }

  return {
    queueLength: snapshot.taskResponse.queueLength,
    taskId: task.id,
    taskTitle: task.title,
  };
}

export async function runDesktopSelfCheck(
  input: DesktopSelfCheckInput,
  dependencies: DesktopSelfCheckDependencies = {
    checkHealth: checkAgentApiHealth,
    loadAgentTaskSnapshot,
  },
): Promise<DesktopSelfCheckResult> {
  const health = await dependencies.checkHealth({
    apiBaseUrl: input.binding.apiBaseUrl,
  });
  const snapshot = await dependencies.loadAgentTaskSnapshot({
    apiBaseUrl: input.binding.apiBaseUrl,
    teamId: input.binding.teamId,
    userId: input.binding.userId,
    deviceId: input.binding.deviceId,
    deviceName: input.binding.deviceName,
    deviceToken: input.binding.deviceToken,
    apiToken: input.binding.apiToken,
    platform: input.platform,
  });

  return {
    health,
    deviceStatus: snapshot.deviceStatus,
    nextDeviceToken: snapshot.deviceToken ?? "",
    taskSummary: buildTaskSummary(snapshot),
  };
}
