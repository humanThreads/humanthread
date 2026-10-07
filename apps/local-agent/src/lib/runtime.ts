import { getNativeBridge } from "./native-bridge";

import {
  agentRuntimeInstallResultSchema,
  runtimeProbeResultSchema,
  type AgentProvider,
  type AgentRuntimeInstallResult,
  type RuntimeProbeResult,
} from "./execution-configuration";

export type LocalPlatform = "macos" | "windows" | "linux" | "unknown";
export type CommandExitStatus = "completed" | "interrupted";

export interface CommandLaunchResult {
  shell: string;
  processId: number | null;
  sessionName?: string;
  sessionType?: string;
}

export interface LaunchProjectCommandInput {
  cwd: string;
  command: string;
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
  sessionName: string;
  sessionType: string;
}

export interface RestoreToolSessionInput {
  cwd: string;
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
  sessionName: string;
  sessionType: string;
}

export interface CommandExitedEventPayload {
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
  cwd: string;
  command: string;
  processId: number;
  shell: string;
  status: CommandExitStatus;
  exitCode: number | null;
  signal: number | null;
  sessionName?: string;
  sessionType?: string;
  error?: string;
}

export interface ValidatedWorkspaceDirectory {
  absolutePath: string;
  realpath: string;
}

export interface AgentRuntimeProbeInput {
  provider: AgentProvider;
  command: string;
  environmentRefs: string[];
  credential?: string;
  credentialContext?: {
    deploymentOrigin: string;
    userId: string;
    credentialRef: string;
  };
}

export interface AgentRuntimeInstallInput {
  provider: AgentProvider;
  environmentRefs: string[];
}

export interface LocalRuntime {
  platform: LocalPlatform;
  isNative: boolean;
  openProjectPath(path: string): Promise<void>;
  openTerminalAtPath(path: string): Promise<CommandLaunchResult>;
  launchProjectCommand(
    input: LaunchProjectCommandInput,
  ): Promise<CommandLaunchResult>;
  restoreToolSession(
    input: RestoreToolSessionInput,
  ): Promise<CommandLaunchResult>;
  validateWorkspaceDirectory(path: string): Promise<ValidatedWorkspaceDirectory>;
  probeAgentRuntime(input: AgentRuntimeProbeInput): Promise<RuntimeProbeResult>;
  installAgentRuntime(input: AgentRuntimeInstallInput): Promise<AgentRuntimeInstallResult>;
  selectProjectDirectory(): Promise<string | null>;
  subscribeCommandExited(
    handler: (payload: CommandExitedEventPayload) => void,
  ): Promise<() => void>;
}

export interface InvokeLike {
  <T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export interface ListenLike {
  <T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void>;
}

const DESKTOP_RUNTIME_ERROR = "本地系统动作仅在桌面客户端中可用。";

export function detectLocalPlatform(platform: string): LocalPlatform {
  const normalized = platform.trim().toLowerCase();

  if (normalized.includes("mac") || normalized.includes("darwin")) {
    return "macos";
  }

  if (normalized.includes("win")) {
    return "windows";
  }

  if (normalized.includes("linux")) {
    return "linux";
  }

  return "unknown";
}

export function createBrowserRuntime(platformLabel: string): LocalRuntime {
  const platform = detectLocalPlatform(platformLabel);

  return {
    platform,
    isNative: false,
    async openProjectPath() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
    async openTerminalAtPath() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
    async launchProjectCommand() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
    async restoreToolSession() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
    async validateWorkspaceDirectory() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
    async probeAgentRuntime() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
    async installAgentRuntime() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
    async selectProjectDirectory() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
    async subscribeCommandExited() {
      throw new Error(DESKTOP_RUNTIME_ERROR);
    },
  };
}

export function createDesktopRuntime(
  dependencies: {
    invoke: InvokeLike;
    listen: ListenLike;
    selectDirectory?: () => Promise<string | null>;
  },
  platformLabel: string,
): LocalRuntime {
  const platform = detectLocalPlatform(platformLabel);

  return {
    platform,
    isNative: true,
    async openProjectPath(path: string) {
      await dependencies.invoke("open_project_path", { path });
    },
    async openTerminalAtPath(path: string) {
      return dependencies.invoke<CommandLaunchResult>("open_terminal_at_path", {
        path,
      });
    },
    async launchProjectCommand(input: LaunchProjectCommandInput) {
      return dependencies.invoke<CommandLaunchResult>("launch_project_command", {
        cwd: input.cwd,
        command: input.command,
        task_id: input.taskId,
        project_id: input.projectId,
        workflow_instance_id: input.workflowInstanceId,
        session_name: input.sessionName,
        session_type: input.sessionType,
      });
    },
    async restoreToolSession(input: RestoreToolSessionInput) {
      return dependencies.invoke<CommandLaunchResult>("restore_tool_session", {
        cwd: input.cwd,
        task_id: input.taskId,
        project_id: input.projectId,
        workflow_instance_id: input.workflowInstanceId,
        session_name: input.sessionName,
        session_type: input.sessionType,
      });
    },
    async validateWorkspaceDirectory(path: string) {
      return dependencies.invoke<ValidatedWorkspaceDirectory>(
        "validate_workspace_directory",
        { path },
      );
    },
    async probeAgentRuntime(input: AgentRuntimeProbeInput) {
      const result = await dependencies.invoke<RuntimeProbeResult>("probe_agent_runtime", {
        provider: input.provider,
        command: input.command,
        environmentRefs: input.environmentRefs,
        ...(input.credential ? { credential: input.credential } : {}),
        ...(input.credentialContext ? { credentialContext: input.credentialContext } : {}),
      });
      return runtimeProbeResultSchema.parse(result);
    },
    async installAgentRuntime(input: AgentRuntimeInstallInput) {
      const result = await dependencies.invoke<AgentRuntimeInstallResult>("install_agent_runtime", {
        provider: input.provider,
        environmentRefs: input.environmentRefs,
      });
      return agentRuntimeInstallResultSchema.parse(result);
    },
    async selectProjectDirectory() {
      if (!dependencies.selectDirectory) {
        throw new Error(DESKTOP_RUNTIME_ERROR);
      }
      return dependencies.selectDirectory();
    },
    async subscribeCommandExited(
      handler: (payload: CommandExitedEventPayload) => void,
    ) {
      return dependencies.listen<CommandExitedEventPayload>(
        "command_exited",
        (event) => {
          handler(event.payload);
        },
      );
    },
  };
}

export function createLocalRuntime(): LocalRuntime {
  const bridge = getNativeBridge();
  const platformLabel = bridge?.platform
    ?? (typeof navigator !== "undefined" ? navigator.platform : "");

  if (bridge) {
    return createDesktopRuntime(
      {
        invoke: bridge.invoke.bind(bridge),
        listen: bridge.listen.bind(bridge),
        selectDirectory: bridge.selectDirectory.bind(bridge),
      },
      platformLabel,
    );
  }

  return createBrowserRuntime(platformLabel);
}
