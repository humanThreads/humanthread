import { normalizeAppearance, type Appearance } from "../theme/appearance";

export const AGENT_BINDING_STORAGE_KEY = "humanthread.localAgent.binding";
export const AGENT_STATE_STORAGE_KEY = "humanthread.localAgent.state";
export const DEFAULT_AGENT_API_BASE_URL = "http://localhost:3000";
export const DEFAULT_AGENT_TEAM_ID = "team_1";
export const DEFAULT_AGENT_USER_ID = "user_owner";
export const DEFAULT_AGENT_POLL_INTERVAL_MS = 10000;
export const DEFAULT_AGENT_COMMAND_TEMPLATE = "{command}";
export const MIN_AGENT_POLL_INTERVAL_MS = 3000;

const DEVICE_ID_MAX_LENGTH = 64;
const DEVICE_NAME_MAX_LENGTH = 191;
const GENERIC_PLATFORM_DEVICE_NAMES = new Set([
  "humanthread-device",
  "linux aarch64",
  "linux armv8l",
  "linux i686",
  "linux x86_64",
  "macintel",
  "macppc",
  "win32",
  "win64",
]);

export interface AgentBinding {
  apiBaseUrl: string;
  teamId: string;
  userId: string;
  userEmail: string;
  bindingCode: string;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
  pollIntervalMs: number;
  apiToken: string;
  commandTemplate: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface BindingEnvironment {
  storage: StorageLike;
  fallbackDeviceName: string;
  now?: () => string;
  createId?: () => string;
}

export interface LocalAgentInstallProfile {
  installationId: string;
  defaultDeviceName: string;
  appearance: Appearance;
  lastSuccessfulRoute: string;
  onboardingSkipped: boolean;
  onboardingCompletedAt: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface LocalAgentAccountSession {
  sessionKey: string;
  apiBaseUrl: string;
  email: string;
  desktopSessionId: string;
  activeSpaceKey: string;
  teamId: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
  apiToken: string;
  lastLoginAt: string;
  lastUsedAt: string;
}

export interface LocalAgentState {
  installProfile: LocalAgentInstallProfile;
  accountSessions: Record<string, LocalAgentAccountSession>;
  activeSessionKey: string | null;
}

export interface LocalAgentAccountSessionMetadata {
  sessionKey: string;
  apiBaseUrl: string;
  email: string;
  activeSpaceKey: string;
  teamId: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  lastLoginAt: string;
  lastUsedAt: string;
}

export interface LocalAgentStateMetadata {
  version: 2;
  installProfile: LocalAgentInstallProfile;
  accountSessions: Record<string, LocalAgentAccountSessionMetadata>;
  activeSessionKey: null;
}

export interface ActiveAgentBinding {
  sessionKey: string;
  apiBaseUrl: string;
  teamId: string;
  userId: string;
  userEmail: string;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
  apiToken: string;
  pollIntervalMs: number;
  commandTemplate: string;
}

function resolveNow(environment: BindingEnvironment): string {
  return environment.now ? environment.now() : new Date().toISOString();
}

function resolveCreateId(environment: BindingEnvironment): string {
  if (environment.createId) {
    return environment.createId();
  }

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `install_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return DEFAULT_AGENT_API_BASE_URL;
  }

  return trimmed.replace(/\/+$/u, "");
}

function normalizeRequiredText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeEmail(value: string | undefined): string {
  return normalizeOptionalText(value).toLowerCase();
}

function normalizeDeviceIdPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized || fallback;
}

function normalizeLegacyDeviceIdPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized || fallback;
}

function normalizeDeviceId(deviceName: string, deviceId?: string): string {
  const normalizedProvided = deviceId?.trim();

  if (normalizedProvided) {
    return normalizedProvided;
  }

  const slug = normalizeLegacyDeviceIdPart(deviceName, "local-agent");

  return `device-${slug}`;
}

export function buildInstallationScopedDeviceId(input: {
  deviceName: string;
  installationId: string;
}): string {
  const installationSlug = normalizeDeviceIdPart(
    input.installationId,
    "installation",
  ).slice(-40);
  const availableNameLength = DEVICE_ID_MAX_LENGTH
    - "device-".length
    - 1
    - installationSlug.length;
  const deviceSlug = normalizeDeviceIdPart(
    input.deviceName,
    "local-agent",
  ).slice(0, Math.max(1, availableNameLength));

  return `device-${deviceSlug}-${installationSlug}`;
}

export function resolveInstallationScopedDeviceName(input: {
  deviceName: string;
  installationId: string;
}): string {
  const deviceName = normalizeRequiredText(input.deviceName, "humanthread-device");
  if (!GENERIC_PLATFORM_DEVICE_NAMES.has(deviceName.toLowerCase())) {
    return deviceName;
  }

  const installationSlug = normalizeDeviceIdPart(
    input.installationId,
    "device",
  );
  const suffix = installationSlug
    .replace(/^install(?:ation)?[_-]?/u, "")
    .slice(-8) || installationSlug.slice(-8);
  const separator = " - ";

  return `${deviceName.slice(0, DEVICE_NAME_MAX_LENGTH - separator.length - suffix.length)}${separator}${suffix}`;
}

export function resolveLoginDeviceId(input: {
  deviceName: string;
  installationId: string;
  existingDeviceId?: string;
}): string {
  const existingDeviceId = input.existingDeviceId?.trim();
  const legacyDeviceId = normalizeDeviceId(input.deviceName);
  if (existingDeviceId && existingDeviceId !== legacyDeviceId) {
    return existingDeviceId;
  }

  return buildInstallationScopedDeviceId(input);
}

function normalizePollInterval(value: number | undefined): number {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_AGENT_POLL_INTERVAL_MS;
  }

  return Math.max(MIN_AGENT_POLL_INTERVAL_MS, Math.round(value));
}

function normalizeCommandTemplate(value: string | undefined): string {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_AGENT_COMMAND_TEMPLATE;
}

function createDefaultInstallProfile(environment: BindingEnvironment): LocalAgentInstallProfile {
  const now = resolveNow(environment);

  return {
    installationId: resolveCreateId(environment),
    defaultDeviceName: normalizeRequiredText(
      environment.fallbackDeviceName,
      "humanthread-device",
    ),
    appearance: "light",
    lastSuccessfulRoute: "/dashboard",
    onboardingSkipped: false,
    onboardingCompletedAt: null,
    createdAt: now,
    lastUsedAt: now,
  };
}

function normalizeInstallProfile(
  profile: Partial<LocalAgentInstallProfile> | undefined,
  environment: BindingEnvironment,
  hasExistingAccountSessions = false,
): LocalAgentInstallProfile {
  const defaults = createDefaultInstallProfile(environment);
  const hasLegacyActivity = hasExistingAccountSessions
    || (typeof profile?.lastSuccessfulRoute === "string"
      && profile.lastSuccessfulRoute.trim() !== ""
      && profile.lastSuccessfulRoute !== "/dashboard");

  return {
    installationId: normalizeRequiredText(
      profile?.installationId,
      defaults.installationId,
    ),
    defaultDeviceName: normalizeRequiredText(
      profile?.defaultDeviceName,
      defaults.defaultDeviceName,
    ),
    appearance: normalizeAppearance(profile?.appearance),
    lastSuccessfulRoute: normalizeRequiredText(
      profile?.lastSuccessfulRoute,
      defaults.lastSuccessfulRoute,
    ),
    onboardingSkipped: typeof profile?.onboardingSkipped === "boolean"
      ? profile.onboardingSkipped
      : hasLegacyActivity,
    onboardingCompletedAt: typeof profile?.onboardingCompletedAt === "string"
      ? profile.onboardingCompletedAt
      : null,
    createdAt: normalizeRequiredText(profile?.createdAt, defaults.createdAt),
    lastUsedAt: normalizeRequiredText(profile?.lastUsedAt, defaults.lastUsedAt),
  };
}

function createDefaultLocalAgentState(
  environment: BindingEnvironment,
): LocalAgentState {
  return {
    installProfile: createDefaultInstallProfile(environment),
    accountSessions: {},
    activeSessionKey: null,
  };
}

function normalizeAccountSession(
  session: Partial<LocalAgentAccountSession>,
  installProfile: LocalAgentInstallProfile,
  environment: BindingEnvironment,
  preserveRuntimeCredentials: boolean,
): LocalAgentAccountSession | null {
  const email = normalizeEmail(session.email);

  if (!email) {
    return null;
  }

  const apiBaseUrl = normalizeApiBaseUrl(session.apiBaseUrl ?? DEFAULT_AGENT_API_BASE_URL);
  const deviceName = normalizeRequiredText(
    session.deviceName,
    installProfile.defaultDeviceName,
  );
  const deviceId = normalizeDeviceId(deviceName, session.deviceId);
  const now = resolveNow(environment);
  const sessionKey = buildAccountSessionKey(apiBaseUrl, email);

  return {
    sessionKey,
    apiBaseUrl,
    email,
    desktopSessionId: preserveRuntimeCredentials
      ? normalizeOptionalText(session.desktopSessionId)
      : "",
    activeSpaceKey: normalizeRequiredText(session.activeSpaceKey, "personal"),
    teamId: normalizeRequiredText(session.teamId, DEFAULT_AGENT_TEAM_ID),
    userId: normalizeRequiredText(session.userId, DEFAULT_AGENT_USER_ID),
    deviceId,
    deviceName,
    deviceToken: preserveRuntimeCredentials
      ? normalizeOptionalText(session.deviceToken)
      : "",
    apiToken: preserveRuntimeCredentials
      ? normalizeOptionalText(session.apiToken)
      : "",
    lastLoginAt: normalizeRequiredText(session.lastLoginAt, now),
    lastUsedAt: normalizeRequiredText(session.lastUsedAt, now),
  };
}

function normalizeRuntimeLocalAgentState(
  state: Partial<LocalAgentState>,
  environment: BindingEnvironment,
): LocalAgentState {
  const entries = Object.values(state.accountSessions ?? {});
  const installProfile = normalizeInstallProfile(
    state.installProfile,
    environment,
    entries.length > 0,
  );
  const accountSessions = Object.fromEntries(
    entries
      .map((session) =>
        normalizeAccountSession(session, installProfile, environment, true),
      )
      .filter((session): session is LocalAgentAccountSession => session !== null)
      .map((session) => [session.sessionKey, session]),
  );
  const activeSessionKey =
    state.activeSessionKey && accountSessions[state.activeSessionKey]
      ? state.activeSessionKey
      : null;

  return {
    installProfile,
    accountSessions,
    activeSessionKey,
  };
}

function normalizePersistedLocalAgentState(
  state: Partial<LocalAgentState>,
  environment: BindingEnvironment,
): LocalAgentState {
  const installProfile = normalizeInstallProfile(
    state.installProfile,
    environment,
    Object.keys(state.accountSessions ?? {}).length > 0,
  );
  const accountSessions = Object.fromEntries(
    Object.values(state.accountSessions ?? {})
      .map((session) =>
        normalizeAccountSession(session, installProfile, environment, false),
      )
      .filter((session): session is LocalAgentAccountSession => session !== null)
      .map((session) => [session.sessionKey, session]),
  );

  return { installProfile, accountSessions, activeSessionKey: null };
}

export function projectLocalAgentStateMetadata(
  state: LocalAgentState,
): LocalAgentStateMetadata {
  return {
    version: 2,
    installProfile: state.installProfile,
    accountSessions: Object.fromEntries(
      Object.entries(state.accountSessions).map(([sessionKey, session]) => [
        sessionKey,
        {
          sessionKey: session.sessionKey,
          apiBaseUrl: session.apiBaseUrl,
          email: session.email,
          activeSpaceKey: session.activeSpaceKey,
          teamId: session.teamId,
          userId: session.userId,
          deviceId: session.deviceId,
          deviceName: session.deviceName,
          lastLoginAt: session.lastLoginAt,
          lastUsedAt: session.lastUsedAt,
        },
      ]),
    ),
    activeSessionKey: null,
  };
}

function persistLocalAgentStateMetadata(
  storage: StorageLike,
  state: LocalAgentState,
): void {
  storage.setItem(
    AGENT_STATE_STORAGE_KEY,
    JSON.stringify(projectLocalAgentStateMetadata(state)),
  );
}

function removeLegacyBinding(storage: StorageLike): void {
  if (storage.removeItem) {
    storage.removeItem(AGENT_BINDING_STORAGE_KEY);
    return;
  }
  storage.setItem(AGENT_BINDING_STORAGE_KEY, "");
}

export function createDefaultAgentBinding(input: {
  fallbackDeviceName: string;
}): AgentBinding {
  const deviceName = normalizeRequiredText(
    input.fallbackDeviceName,
    "humanthread-device",
  );

  return {
    apiBaseUrl: DEFAULT_AGENT_API_BASE_URL,
    teamId: DEFAULT_AGENT_TEAM_ID,
    userId: DEFAULT_AGENT_USER_ID,
    userEmail: "",
    bindingCode: "",
    deviceId: normalizeDeviceId(deviceName),
    deviceName,
    deviceToken: "",
    pollIntervalMs: DEFAULT_AGENT_POLL_INTERVAL_MS,
    apiToken: "",
    commandTemplate: DEFAULT_AGENT_COMMAND_TEMPLATE,
  };
}

export function normalizeAgentBinding(
  binding: Partial<AgentBinding>,
  input: {
    fallbackDeviceName: string;
  },
): AgentBinding {
  const defaults = createDefaultAgentBinding(input);
  const deviceName = normalizeRequiredText(binding.deviceName, defaults.deviceName);

  return {
    apiBaseUrl: normalizeApiBaseUrl(binding.apiBaseUrl ?? defaults.apiBaseUrl),
    teamId: normalizeRequiredText(binding.teamId, defaults.teamId),
    userId: normalizeRequiredText(binding.userId, defaults.userId),
    userEmail: normalizeEmail(binding.userEmail ?? defaults.userEmail),
    bindingCode: normalizeOptionalText(binding.bindingCode ?? defaults.bindingCode),
    deviceId: normalizeDeviceId(deviceName, binding.deviceId ?? defaults.deviceId),
    deviceName,
    deviceToken: normalizeOptionalText(binding.deviceToken ?? defaults.deviceToken),
    pollIntervalMs: normalizePollInterval(binding.pollIntervalMs),
    apiToken: normalizeOptionalText(binding.apiToken ?? defaults.apiToken),
    commandTemplate: normalizeCommandTemplate(
      binding.commandTemplate ?? defaults.commandTemplate,
    ),
  };
}

function mapSessionToLegacyBinding(
  session: LocalAgentAccountSession,
): AgentBinding {
  return {
    apiBaseUrl: session.apiBaseUrl,
    teamId: session.teamId,
    userId: session.userId,
    userEmail: session.email,
    bindingCode: "",
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    deviceToken: session.deviceToken,
    pollIntervalMs: DEFAULT_AGENT_POLL_INTERVAL_MS,
    apiToken: session.apiToken,
    commandTemplate: DEFAULT_AGENT_COMMAND_TEMPLATE,
  };
}

export function buildAccountSessionKey(apiBaseUrl: string, email: string): string {
  return `${normalizeApiBaseUrl(apiBaseUrl)}::${normalizeEmail(email)}`;
}

function migrateLegacyBinding(environment: BindingEnvironment): LocalAgentState {
  const raw = environment.storage.getItem(AGENT_BINDING_STORAGE_KEY);

  if (!raw) {
    const state = createDefaultLocalAgentState(environment);
    persistLocalAgentStateMetadata(environment.storage, state);
    return state;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AgentBinding>;
    const normalized = normalizeAgentBinding(parsed, {
      fallbackDeviceName: environment.fallbackDeviceName,
    });

    if (
      !normalized.userEmail ||
      !normalized.deviceId
    ) {
      const state = createDefaultLocalAgentState(environment);
      persistLocalAgentStateMetadata(environment.storage, state);
      removeLegacyBinding(environment.storage);
      return state;
    }

    const installProfile = createDefaultInstallProfile(environment);
    const session = normalizeAccountSession(
      {
        apiBaseUrl: normalized.apiBaseUrl,
        email: normalized.userEmail,
        teamId: normalized.teamId,
        userId: normalized.userId,
        deviceId: normalized.deviceId,
        deviceName: normalized.deviceName,
        deviceToken: "",
        apiToken: "",
        lastLoginAt: resolveNow(environment),
        lastUsedAt: resolveNow(environment),
      },
      installProfile,
      environment,
      false,
    );

    if (!session) {
      const state = {
        installProfile,
        accountSessions: {},
        activeSessionKey: null,
      };
      persistLocalAgentStateMetadata(environment.storage, state);
      removeLegacyBinding(environment.storage);
      return state;
    }

    const state: LocalAgentState = {
      installProfile,
      accountSessions: {
        [session.sessionKey]: session,
      },
      activeSessionKey: null,
    };

    persistLocalAgentStateMetadata(environment.storage, state);
    removeLegacyBinding(environment.storage);

    return state;
  } catch {
    const state = createDefaultLocalAgentState(environment);
    persistLocalAgentStateMetadata(environment.storage, state);
    removeLegacyBinding(environment.storage);
    return state;
  }
}

export function loadAgentState(environment: BindingEnvironment): LocalAgentState {
  const raw = environment.storage.getItem(AGENT_STATE_STORAGE_KEY);

  if (!raw) {
    return migrateLegacyBinding(environment);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalAgentState>;
    const normalized = normalizePersistedLocalAgentState(parsed, environment);

    persistLocalAgentStateMetadata(environment.storage, normalized);
    removeLegacyBinding(environment.storage);
    return normalized;
  } catch {
    return migrateLegacyBinding(environment);
  }
}

export function saveAgentState(
  environment: BindingEnvironment,
  state: LocalAgentState,
): LocalAgentState {
  const normalized = normalizeRuntimeLocalAgentState(state, environment);

  persistLocalAgentStateMetadata(environment.storage, normalized);

  return normalized;
}

export function clearActiveAccountSession(
  environment: BindingEnvironment,
): LocalAgentState {
  const state = loadAgentState(environment);

  return saveAgentState(environment, {
    ...state,
    activeSessionKey: null,
  });
}

export function resolveActiveAgentBinding(
  state: LocalAgentState,
): ActiveAgentBinding | null {
  if (!state.activeSessionKey) {
    return null;
  }

  const session = state.accountSessions[state.activeSessionKey];

  if (!session) {
    return null;
  }

  return {
    sessionKey: session.sessionKey,
    apiBaseUrl: session.apiBaseUrl,
    teamId: session.teamId,
    userId: session.userId,
    userEmail: session.email,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    deviceToken: session.deviceToken,
    apiToken: session.apiToken,
    pollIntervalMs: DEFAULT_AGENT_POLL_INTERVAL_MS,
    commandTemplate: DEFAULT_AGENT_COMMAND_TEMPLATE,
  };
}

export function loadAgentBinding(environment: BindingEnvironment): AgentBinding {
  const state = loadAgentState(environment);
  const activeBinding = resolveActiveAgentBinding(state);

  if (!activeBinding) {
    return createDefaultAgentBinding({
      fallbackDeviceName: state.installProfile.defaultDeviceName,
    });
  }

  const activeSession = state.accountSessions[activeBinding.sessionKey];

  if (!activeSession) {
    return createDefaultAgentBinding({
      fallbackDeviceName: state.installProfile.defaultDeviceName,
    });
  }

  return {
    ...mapSessionToLegacyBinding(activeSession),
    pollIntervalMs: activeBinding.pollIntervalMs,
    commandTemplate: activeBinding.commandTemplate,
  };
}

export function saveAgentBinding(
  environment: BindingEnvironment,
  binding: Partial<AgentBinding>,
): AgentBinding {
  const normalized = normalizeAgentBinding(binding, {
    fallbackDeviceName: environment.fallbackDeviceName,
  });
  const state = loadAgentState(environment);

  if (!normalized.userEmail) {
    saveAgentState(environment, {
      ...state,
      activeSessionKey: null,
    });

    return normalized;
  }

  const sessionKey = buildAccountSessionKey(
    normalized.apiBaseUrl,
    normalized.userEmail,
  );
  const existingSession = state.accountSessions[sessionKey];
  const now = resolveNow(environment);

  saveAgentState(environment, {
    ...state,
    activeSessionKey: sessionKey,
    accountSessions: {
      ...state.accountSessions,
      [sessionKey]: {
        sessionKey,
        apiBaseUrl: normalized.apiBaseUrl,
        email: normalized.userEmail,
        desktopSessionId: existingSession?.desktopSessionId ?? "",
        activeSpaceKey: existingSession?.activeSpaceKey ?? "personal",
        teamId: normalized.teamId,
        userId: normalized.userId,
        deviceId: normalized.deviceId,
        deviceName: normalized.deviceName,
        deviceToken: normalized.deviceToken || existingSession?.deviceToken || "",
        apiToken: normalized.apiToken || existingSession?.apiToken || "",
        lastLoginAt: existingSession?.lastLoginAt ?? now,
        lastUsedAt: now,
      },
    },
  });

  return normalized;
}
