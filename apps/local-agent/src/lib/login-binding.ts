import type { AgentDeviceStatus, LocalAgentPlatform } from "@humanthread/shared";
import { loginAndBindAgentDevice } from "./api";
import {
  buildAccountSessionKey,
  loadAgentBinding,
  loadAgentState,
  resolveActiveAgentBinding,
  resolveInstallationScopedDeviceName,
  resolveLoginDeviceId,
  saveAgentState,
  type ActiveAgentBinding,
  type AgentBinding,
  type BindingEnvironment,
  type LocalAgentState,
} from "./binding";

export interface LoginAndPersistAgentSessionInput {
  email: string;
  password: string;
  apiBaseUrl: string;
  environment: BindingEnvironment;
  platform: LocalAgentPlatform;
  seedState?: LocalAgentState;
}

interface LoginAndPersistAgentSessionDependencies {
  loginAndBindAgentDevice: typeof loginAndBindAgentDevice;
}

export interface LoginAndPersistAgentSessionResult {
  state: LocalAgentState;
  activeBinding: ActiveAgentBinding | null;
  deviceStatus: AgentDeviceStatus;
}

export interface LoginAndPersistAgentBindingInput {
  binding: AgentBinding;
  environment: BindingEnvironment;
  password: string;
  platform: LocalAgentPlatform;
}

export interface LoginAndPersistAgentBindingResult {
  binding: AgentBinding;
  deviceStatus: AgentDeviceStatus;
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "http://localhost:3000";
  }

  return trimmed.replace(/\/+$/u, "");
}

function buildDraftDeviceIdentity(input: {
  state: LocalAgentState;
  sessionKey: string;
}) {
  const existingSession = input.state.accountSessions[input.sessionKey];
  const storedDeviceName = existingSession?.deviceName
    ?? input.state.installProfile.defaultDeviceName;
  const deviceId = resolveLoginDeviceId({
    deviceName: storedDeviceName,
    installationId: input.state.installProfile.installationId,
    ...(existingSession?.deviceId
      ? { existingDeviceId: existingSession.deviceId }
      : {}),
  });
  const deviceName = resolveInstallationScopedDeviceName({
    deviceName: storedDeviceName,
    installationId: input.state.installProfile.installationId,
  });

  return {
    deviceId,
    deviceName,
    deviceToken: existingSession?.deviceToken ?? "",
    apiToken: existingSession?.apiToken ?? "",
  };
}

export async function loginAndPersistAgentSession(
  input: LoginAndPersistAgentSessionInput,
  dependencies: LoginAndPersistAgentSessionDependencies = {
    loginAndBindAgentDevice,
  },
): Promise<LoginAndPersistAgentSessionResult> {
  const email = normalizeOptionalText(input.email).toLowerCase();
  const password = normalizeOptionalText(input.password);
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);

  if (!email) {
    throw new Error("请填写登录邮箱。");
  }

  if (!password) {
    throw new Error("请填写登录密码。");
  }

  const state = input.seedState ?? loadAgentState(input.environment);
  const sessionKey = buildAccountSessionKey(apiBaseUrl, email);
  const existingSession = state.accountSessions[sessionKey];
  const draftIdentity = buildDraftDeviceIdentity({ state, sessionKey });
  const registration = await dependencies.loginAndBindAgentDevice({
    apiBaseUrl,
    deviceToken: draftIdentity.deviceToken,
    body: {
      email,
      password,
      deviceId: draftIdentity.deviceId,
      deviceName: draftIdentity.deviceName,
      platform: input.platform,
    },
  });
  const now = input.environment.now ? input.environment.now() : new Date().toISOString();
  const nextState = saveAgentState(input.environment, {
    ...state,
    activeSessionKey: sessionKey,
    accountSessions: {
      ...state.accountSessions,
      [sessionKey]: {
        sessionKey,
        apiBaseUrl,
        email,
        desktopSessionId: existingSession?.desktopSessionId ?? "",
        activeSpaceKey: existingSession?.activeSpaceKey ?? "personal",
        teamId: registration.teamId,
        userId: registration.userId,
        deviceId: registration.deviceId,
        deviceName: draftIdentity.deviceName,
        deviceToken: registration.deviceToken,
        apiToken: existingSession?.apiToken ?? draftIdentity.apiToken,
        lastLoginAt: now,
        lastUsedAt: now,
      },
    },
  });

  return {
    state: nextState,
    activeBinding: resolveActiveAgentBinding(nextState),
    deviceStatus: registration.status,
  };
}

export async function loginAndPersistAgentBinding(
  input: LoginAndPersistAgentBindingInput,
): Promise<LoginAndPersistAgentBindingResult> {
  const result = await loginAndPersistAgentSession({
    email: input.binding.userEmail,
    password: input.password,
    apiBaseUrl: input.binding.apiBaseUrl,
    environment: input.environment,
    platform: input.platform,
  });

  return {
    binding: loadAgentBinding(input.environment),
    deviceStatus: result.deviceStatus,
  };
}
