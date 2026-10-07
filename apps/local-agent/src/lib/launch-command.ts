import { DEFAULT_AGENT_COMMAND_TEMPLATE } from "./binding";

export interface ResolveLaunchCommandInput {
  template: string;
  command: string;
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
}

export function resolveLaunchCommand(
  input: ResolveLaunchCommandInput,
): string {
  const normalizedCommand = input.command.trim();
  const normalizedTemplate = input.template.trim();

  if (!normalizedTemplate || normalizedTemplate === DEFAULT_AGENT_COMMAND_TEMPLATE) {
    return normalizedCommand;
  }

  return normalizedTemplate
    .replaceAll("{taskId}", input.taskId)
    .replaceAll("{projectId}", input.projectId)
    .replaceAll("{workflowInstanceId}", input.workflowInstanceId)
    .replaceAll("{command}", normalizedCommand);
}
