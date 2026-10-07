import type { AgentDeviceStatus, LocalAgentPlatform } from "@humanthread/shared";
import {
  fetchAgentCurrentTask,
  registerAgentDevice,
  reportAgentEvent,
  type FetchCurrentTaskInput,
  type RegisterAgentDeviceInput,
  type ReportAgentEventInput,
} from "./api.ts";
import { buildCommandExitedEventRequest } from "./command-events.ts";
import type { CommandExitedEventPayload } from "./runtime";
import { LOCAL_AGENT_CAPABILITY_SNAPSHOT } from "./agent-capabilities.ts";

export interface LocalAgentSmokeInput {
  apiBaseUrl: string;
  teamId: string;
  userId: string;
  userEmail?: string;
  deviceId: string;
  deviceName: string;
  apiToken: string;
  deviceToken: string;
  platform: LocalAgentPlatform;
}

interface LocalAgentSmokeDependencies {
  registerAgentDevice: (
    input: RegisterAgentDeviceInput,
  ) => ReturnType<typeof registerAgentDevice>;
  fetchAgentCurrentTask: (
    input: FetchCurrentTaskInput,
  ) => ReturnType<typeof fetchAgentCurrentTask>;
  reportAgentEvent: (
    input: ReportAgentEventInput,
  ) => ReturnType<typeof reportAgentEvent>;
}

export interface LocalAgentSmokeResult {
  deviceStatus: AgentDeviceStatus;
  deviceToken: string;
  taskId: string | null;
  reportedEventTypes: Array<"local_opened" | "command_started" | "command_exited">;
}

function createSmokeCommandExit(input: {
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
  cwd: string;
  command: string;
}): CommandExitedEventPayload {
  return {
    taskId: input.taskId,
    projectId: input.projectId,
    workflowInstanceId: input.workflowInstanceId,
    cwd: input.cwd,
    command: input.command,
    processId: 99901,
    shell: "smoke-shell",
    status: "completed",
    exitCode: 0,
    signal: null,
  };
}

export async function runLocalAgentSmoke(
  input: LocalAgentSmokeInput,
  dependencies: LocalAgentSmokeDependencies = {
    registerAgentDevice,
    fetchAgentCurrentTask,
    reportAgentEvent,
  },
): Promise<LocalAgentSmokeResult> {
  const registration = await dependencies.registerAgentDevice({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    deviceToken: input.deviceToken,
    body: {
      userId: input.userId,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      platform: input.platform,
      capabilitySnapshot: LOCAL_AGENT_CAPABILITY_SNAPSHOT,
    },
    });

  if (registration.status !== "authorized") {
    return {
      deviceStatus: registration.status,
      deviceToken: registration.deviceToken,
      taskId: null,
      reportedEventTypes: [],
    };
  }

  const taskResponse = await dependencies.fetchAgentCurrentTask({
    apiBaseUrl: input.apiBaseUrl,
    teamId: input.teamId,
    userId: input.userId,
    deviceId: input.deviceId,
    deviceToken: registration.deviceToken,
    apiToken: input.apiToken,
  });

  const task = taskResponse.task;

  if (!task) {
    return {
      deviceStatus: registration.status,
      deviceToken: registration.deviceToken,
      taskId: null,
      reportedEventTypes: [],
    };
  }

  const command = task.command ?? "unknown-command";
  const cwd = task.localPath ?? "";

  await dependencies.reportAgentEvent({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    deviceToken: registration.deviceToken,
    body: {
      taskId: task.id,
      actorUserId: input.userId,
      eventType: "local_opened",
      message: "local-agent smoke test",
      payload: {
        source: "local_agent_smoke",
        cwd,
        command,
      },
      localDevice: {
        id: input.deviceId,
        name: input.deviceName,
        platform: input.platform,
      },
    },
  });

  await dependencies.reportAgentEvent({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    deviceToken: registration.deviceToken,
    body: {
      taskId: task.id,
      actorUserId: input.userId,
      eventType: "command_started",
      message: "local-agent smoke command started",
      payload: {
        source: "local_agent_smoke",
        cwd,
        command,
        processId: 99901,
        shell: "smoke-shell",
      },
      localDevice: {
        id: input.deviceId,
        name: input.deviceName,
        platform: input.platform,
      },
    },
  });

  await dependencies.reportAgentEvent({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
    deviceToken: registration.deviceToken,
    body: buildCommandExitedEventRequest({
      actorUserId: input.userId,
      localDevice: {
        id: input.deviceId,
        name: input.deviceName,
        platform: input.platform,
      },
      commandExit: createSmokeCommandExit({
        taskId: task.id,
        projectId: task.projectId,
        workflowInstanceId: task.workflowInstanceId,
        cwd,
        command,
      }),
    }),
  });

  return {
    deviceStatus: registration.status,
    deviceToken: registration.deviceToken,
    taskId: task.id,
    reportedEventTypes: ["local_opened", "command_started", "command_exited"],
  };
}
