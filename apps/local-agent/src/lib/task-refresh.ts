import type { AgentCurrentTaskResponse } from "./api";
import {
  resolveActiveAgentBinding,
  saveAgentState,
  type ActiveAgentBinding,
  type BindingEnvironment,
  type LocalAgentState,
} from "./binding";
import {
  loadAgentTaskSnapshot,
  type LoadAgentTaskSnapshotResult,
} from "./current-task-bootstrap";
import type {
  AgentDeviceStatus,
  LocalAgentPlatform,
} from "@humanthread/shared";

export interface RefreshLocalAgentTaskStateInput {
  state: LocalAgentState;
  environment: BindingEnvironment;
  platform: LocalAgentPlatform;
}

interface RefreshLocalAgentTaskStateDependencies {
  loadAgentTaskSnapshot: typeof loadAgentTaskSnapshot;
  saveAgentState: typeof saveAgentState;
}

export interface RefreshLocalAgentTaskStateResult {
  state: LocalAgentState;
  activeBinding: ActiveAgentBinding | null;
  deviceStatus: AgentDeviceStatus;
  taskResponse: AgentCurrentTaskResponse | null;
}

function resolveNextState(input: {
  state: LocalAgentState;
  environment: BindingEnvironment;
  snapshot: LoadAgentTaskSnapshotResult;
  saveAgentState: typeof saveAgentState;
}): LocalAgentState {
  const activeBinding = input.snapshot.activeBinding;

  if (!activeBinding || !activeBinding.sessionKey) {
    return input.state;
  }

  const currentSession = input.state.accountSessions[activeBinding.sessionKey];

  if (!currentSession) {
    return input.state;
  }

  const tokenChanged = currentSession.deviceToken !== activeBinding.deviceToken;
  const identityChanged =
    currentSession.teamId !== activeBinding.teamId ||
    currentSession.userId !== activeBinding.userId ||
    currentSession.deviceId !== activeBinding.deviceId;

  if (!tokenChanged && !identityChanged) {
    return input.state;
  }

  return input.saveAgentState(input.environment, {
    ...input.state,
    accountSessions: {
      ...input.state.accountSessions,
      [activeBinding.sessionKey]: {
        ...currentSession,
        teamId: activeBinding.teamId,
        userId: activeBinding.userId,
        deviceId: activeBinding.deviceId,
        deviceToken: activeBinding.deviceToken,
        lastUsedAt: input.environment.now
          ? input.environment.now()
          : new Date().toISOString(),
      },
    },
  });
}

export async function refreshLocalAgentTaskState(
  input: RefreshLocalAgentTaskStateInput,
  dependencies?: Partial<RefreshLocalAgentTaskStateDependencies>,
): Promise<RefreshLocalAgentTaskStateResult> {
  const resolvedDependencies: RefreshLocalAgentTaskStateDependencies = {
    loadAgentTaskSnapshot,
    saveAgentState,
    ...dependencies,
  };
  const activeBinding = resolveActiveAgentBinding(input.state);
  const snapshot = await resolvedDependencies.loadAgentTaskSnapshot({
    activeBinding,
    platform: input.platform,
  });
  const nextState = resolveNextState({
    state: input.state,
    environment: input.environment,
    snapshot,
    saveAgentState: resolvedDependencies.saveAgentState,
  });

  return {
    state: nextState,
    activeBinding: snapshot.activeBinding,
    deviceStatus: snapshot.deviceStatus,
    taskResponse: snapshot.taskResponse,
  };
}
