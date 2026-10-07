import type {
  AgentDeviceStatus,
  LocalAgentPlatform,
} from "@humanthread/shared";
import {
  type AgentCurrentTaskResponse,
  fetchAgentCurrentTask,
  registerAgentDevice,
} from "./api";
import type { ActiveAgentBinding } from "./binding";
import { LOCAL_AGENT_CAPABILITY_SNAPSHOT } from "./agent-capabilities";
import { AGENT_BUILD_VERSION } from "./build-version";

export interface LoadAgentTaskSnapshotInput {
  activeBinding?: ActiveAgentBinding | null;
  apiBaseUrl?: string;
  teamId?: string;
  userId?: string;
  deviceId?: string;
  deviceName?: string;
  deviceToken?: string;
  apiToken?: string;
  platform: LocalAgentPlatform;
}

interface LoadAgentTaskSnapshotDependencies {
  registerAgentDevice: typeof registerAgentDevice;
  fetchAgentCurrentTask: typeof fetchAgentCurrentTask;
}

export interface LoadAgentTaskSnapshotResult {
  deviceStatus: AgentDeviceStatus;
  taskResponse: AgentCurrentTaskResponse | null;
  activeBinding: ActiveAgentBinding | null;
  teamId?: string;
  userId?: string;
  deviceId?: string;
  deviceToken?: string;
}

function resolveActiveBinding(
  input: LoadAgentTaskSnapshotInput,
): ActiveAgentBinding | null {
  if (input.activeBinding !== undefined) {
    return input.activeBinding;
  }

  if (
    !input.apiBaseUrl ||
    !input.teamId ||
    !input.userId ||
    !input.deviceId ||
    !input.deviceName
  ) {
    return null;
  }

  return {
    sessionKey: "",
    apiBaseUrl: input.apiBaseUrl,
    teamId: input.teamId,
    userId: input.userId,
    userEmail: "",
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    deviceToken: input.deviceToken?.trim() ?? "",
    apiToken: input.apiToken?.trim() ?? "",
    pollIntervalMs: 10000,
    commandTemplate: "{command}",
  };
}

export async function loadAgentTaskSnapshot(
  input: LoadAgentTaskSnapshotInput,
  dependencies: LoadAgentTaskSnapshotDependencies = {
    registerAgentDevice,
    fetchAgentCurrentTask,
  },
): Promise<LoadAgentTaskSnapshotResult> {
  const activeBinding = resolveActiveBinding(input);

  if (!activeBinding) {
    return {
      deviceStatus: "pending",
      taskResponse: null,
      activeBinding: null,
    };
  }

  if (!activeBinding.deviceToken.trim() && !activeBinding.apiToken.trim()) {
    return {
      deviceStatus: "pending",
      taskResponse: null,
      activeBinding,
      teamId: activeBinding.teamId,
      userId: activeBinding.userId,
      deviceId: activeBinding.deviceId,
      deviceToken: "",
    };
  }

  const registration = await dependencies.registerAgentDevice({
    apiBaseUrl: activeBinding.apiBaseUrl,
    apiToken: activeBinding.apiToken,
    ...(activeBinding.deviceToken.trim()
      ? { deviceToken: activeBinding.deviceToken }
      : {}),
    body: {
      userId: activeBinding.userId,
      deviceId: activeBinding.deviceId,
      deviceName: activeBinding.deviceName,
      platform: input.platform,
      capabilitySnapshot: LOCAL_AGENT_CAPABILITY_SNAPSHOT,
      agentVersion: AGENT_BUILD_VERSION,
    },
  });
  const teamId =
    "teamId" in registration && typeof registration.teamId === "string"
      ? registration.teamId
      : activeBinding.teamId;
  const nextBinding: ActiveAgentBinding = {
    ...activeBinding,
    teamId,
    userId: registration.userId,
    deviceId: registration.deviceId,
    deviceToken: registration.deviceToken,
  };

  if (registration.status !== "authorized") {
    return {
      deviceStatus: registration.status,
      taskResponse: null,
      activeBinding: nextBinding,
      teamId,
      userId: registration.userId,
      deviceId: registration.deviceId,
      deviceToken: registration.deviceToken,
    };
  }

  const taskResponse = await dependencies.fetchAgentCurrentTask({
    apiBaseUrl: nextBinding.apiBaseUrl,
    teamId,
    userId: registration.userId,
    deviceId: registration.deviceId,
    deviceToken: registration.deviceToken,
    apiToken: nextBinding.apiToken,
  });

  return {
    deviceStatus: registration.status,
    taskResponse,
    activeBinding: nextBinding,
    teamId,
    userId: registration.userId,
    deviceId: registration.deviceId,
    deviceToken: registration.deviceToken,
  };
}
