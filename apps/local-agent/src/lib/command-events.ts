import type { AgentEventReportRequest, AgentDeviceInfo } from "@humanthread/shared";
import type { CommandExitedEventPayload } from "./runtime";

export interface BuildCommandExitedEventRequestInput {
  actorUserId: string;
  localDevice: AgentDeviceInfo;
  commandExit: CommandExitedEventPayload;
}

function createCommandExitedMessage(input: CommandExitedEventPayload): string {
  const exitCodeLabel =
    typeof input.exitCode === "number" ? input.exitCode : "unknown";

  return input.status === "completed"
    ? `本地命令执行结束，退出码 ${exitCodeLabel}。`
    : `本地命令执行异常结束，退出码 ${exitCodeLabel}。`;
}

export function buildCommandExitedEventRequest(
  input: BuildCommandExitedEventRequestInput,
): AgentEventReportRequest {
  return {
    taskId: input.commandExit.taskId,
    actorUserId: input.actorUserId,
    eventType: "command_exited",
    message: createCommandExitedMessage(input.commandExit),
    payload: {
      projectId: input.commandExit.projectId,
      workflowInstanceId: input.commandExit.workflowInstanceId,
      cwd: input.commandExit.cwd,
      command: input.commandExit.command,
      processId: input.commandExit.processId,
      shell: input.commandExit.shell,
      status: input.commandExit.status,
      exitCode: input.commandExit.exitCode,
      signal: input.commandExit.signal,
      ...(input.commandExit.sessionName
        ? { sessionName: input.commandExit.sessionName }
        : {}),
      ...(input.commandExit.sessionType
        ? { sessionType: input.commandExit.sessionType }
        : {}),
      ...(input.commandExit.error ? { error: input.commandExit.error } : {}),
    },
    localDevice: input.localDevice,
  };
}
