import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createWorkbenchContextIdentity,
  type DesktopBootstrapResponse,
  type DesktopUser,
  type WorkbenchContextIdentity,
} from "@humanthread/workbench-client";

import {
  buildAccountSessionKey,
  createDefaultAgentBinding,
  resolveInstallationScopedDeviceName,
  resolveLoginDeviceId,
  saveAgentState,
  type BindingEnvironment,
  type LocalAgentState,
} from "../lib/binding";
import { workbenchContextQueryPrefix } from "../lib/query-client";
import {
  createDesktopAuthClient,
  loginDesktopSession,
  withDesktopLoginTimeout,
  type DesktopFetch,
} from "./desktop-auth";
import { switchWorkbenchContext } from "./context-switch";

type DesktopAuthClient = ReturnType<typeof createDesktopAuthClient>;
type DesktopBootstrap = DesktopBootstrapResponse["data"];
type DesktopSessionStatus =
  | "signed_out"
  | "bootstrapping"
  | "authenticating"
  | "switching"
  | "ready"
  | "error";

interface DesktopLoginInput {
  apiBaseUrl: string;
  email: string;
  password: string;
}

export interface DesktopRuntimeCredentials {
  deviceToken: string;
  apiToken: string;
}

export interface DesktopSessionValue {
  status: DesktopSessionStatus;
  error: string | null;
  user: DesktopUser | null;
  bootstrap: DesktopBootstrap | null;
  context: WorkbenchContextIdentity | null;
  client: DesktopAuthClient | null;
  runtimeCredentials: DesktopRuntimeCredentials | null;
  localDeviceId: string | null;
  generation: number;
  actionsEnabled: boolean;
  updateRuntimeCredentials: (
    credentials: DesktopRuntimeCredentials,
    generation: number,
  ) => void;
  login: (input: DesktopLoginInput) => Promise<void>;
  logout: () => Promise<void>;
  switchSpace: (spaceKey: string) => Promise<void>;
}

const DesktopSessionContext = createContext<DesktopSessionValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "桌面会话初始化失败。";
}

export function DesktopSessionProvider(props: {
  children: ReactNode;
  state: LocalAgentState;
  environment: BindingEnvironment;
  platform: "macos" | "windows" | "linux";
  fetch?: DesktopFetch;
  onStateChange?: (state: LocalAgentState) => void;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DesktopSessionStatus>("signed_out");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<DesktopUser | null>(null);
  const [bootstrap, setBootstrap] = useState<DesktopBootstrap | null>(null);
  const [context, setContext] = useState<WorkbenchContextIdentity | null>(null);
  const [client, setClient] = useState<DesktopAuthClient | null>(null);
  const [runtimeCredentials, setRuntimeCredentials] = useState<DesktopRuntimeCredentials | null>(null);
  const [localDeviceId, setLocalDeviceId] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [actionsEnabled, setActionsEnabled] = useState(false);
  const generationRef = useRef(0);
  const statusRef = useRef<DesktopSessionStatus>("signed_out");
  const setSessionStatus = useCallback((nextStatus: DesktopSessionStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);
  const advanceGeneration = useCallback(() => {
    generationRef.current += 1;
    setGeneration(generationRef.current);
    return generationRef.current;
  }, []);
  const updateRuntimeCredentials = useCallback((
    credentials: DesktopRuntimeCredentials,
    expectedGeneration: number,
  ) => {
    if (
      statusRef.current !== "ready"
      || generationRef.current !== expectedGeneration
    ) return;
    setRuntimeCredentials({ ...credentials });
  }, []);

  const persistState = useCallback((state: LocalAgentState) => {
    const persisted = saveAgentState(props.environment, state);
    props.onStateChange?.(persisted);
    return persisted;
  }, [props.environment, props.onStateChange]);

  const login = useCallback(async (input: DesktopLoginInput) => {
    const loginGeneration = advanceGeneration();
    setSessionStatus("authenticating");
    setActionsEnabled(false);
    setRuntimeCredentials(null);
    setLocalDeviceId(null);
    setError(null);
    try {
      const email = input.email.trim().toLowerCase();
      if (!email) throw new Error("请填写登录邮箱。");
      if (!input.password) throw new Error("请填写登录密码。");

      const apiBaseUrl = new URL(input.apiBaseUrl.trim()).toString().replace(/\/$/u, "");
      const sessionKey = buildAccountSessionKey(apiBaseUrl, email);
      const existing = props.state.accountSessions[sessionKey];
      const defaultBinding = createDefaultAgentBinding({
        fallbackDeviceName: props.state.installProfile.defaultDeviceName,
      });
      const storedDeviceName = existing?.deviceName ?? defaultBinding.deviceName;
      const deviceId = resolveLoginDeviceId({
        deviceName: storedDeviceName,
        installationId: props.state.installProfile.installationId,
        ...(existing?.deviceId ? { existingDeviceId: existing.deviceId } : {}),
      });
      const deviceName = resolveInstallationScopedDeviceName({
        deviceName: storedDeviceName,
        installationId: props.state.installProfile.installationId,
      });
      const loginResult = await loginDesktopSession({
        apiBaseUrl,
        email,
        password: input.password,
        installationId: props.state.installProfile.installationId,
        deviceId,
        deviceName,
        platform: props.platform,
      }, props.fetch ? { fetch: props.fetch } : {});

      const nextClient = createDesktopAuthClient({
        apiBaseUrl,
        sessionId: loginResult.sessionId,
        accessToken: loginResult.accessToken,
        accessExpiresAt: loginResult.accessExpiresAt,
        refreshToken: loginResult.refreshToken,
        ...(props.fetch ? { fetch: props.fetch } : {}),
      });
      const bootstrapController = new AbortController();
      const nextBootstrap = await withDesktopLoginTimeout(
        nextClient.bootstrap(existing?.activeSpaceKey, {
          signal: bootstrapController.signal,
        }),
        {
          message: "登录后初始化响应超时，请检查网络后重试。",
          onTimeout: () => bootstrapController.abort(),
        },
      );
      if (generationRef.current !== loginGeneration) {
        await nextClient.logout().catch(() => undefined);
        return;
      }
      const now = props.environment.now
        ? props.environment.now()
        : new Date().toISOString();
      const nextState = persistState({
        ...props.state,
        activeSessionKey: sessionKey,
        accountSessions: {
          ...props.state.accountSessions,
          [sessionKey]: {
            sessionKey,
            apiBaseUrl,
            email,
            desktopSessionId: loginResult.sessionId,
            activeSpaceKey: nextBootstrap.activeSpaceKey,
            teamId: existing?.teamId ?? defaultBinding.teamId,
            userId: loginResult.user.id,
            deviceId: loginResult.device.id,
            deviceName,
            deviceToken: loginResult.device.deviceToken,
            apiToken: existing?.apiToken ?? "",
            lastLoginAt: now,
            lastUsedAt: now,
          },
        },
      });
      const active = nextState.accountSessions[sessionKey];
      const nextContext = createWorkbenchContextIdentity({
        deploymentUrl: apiBaseUrl,
        sessionId: loginResult.sessionId,
        spaceKey: nextBootstrap.activeSpaceKey,
      });

      setUser(loginResult.user);
      setClient(nextClient);
      setRuntimeCredentials({
        deviceToken: loginResult.device.deviceToken,
        apiToken: "",
      });
      setLocalDeviceId(loginResult.device.id);
      setBootstrap(nextBootstrap);
      setContext(nextContext);
      setActionsEnabled(Boolean(active));
      setSessionStatus("ready");
    } catch (loginError) {
      if (generationRef.current !== loginGeneration) return;
      setActionsEnabled(false);
      setUser(null);
      setClient(null);
      setBootstrap(null);
      setContext(null);
      setRuntimeCredentials(null);
      setLocalDeviceId(null);
      setError(errorMessage(loginError));
      setSessionStatus("error");
    }
  }, [
    advanceGeneration,
    persistState,
    props.environment,
    props.fetch,
    props.platform,
    props.state,
    setSessionStatus,
  ]);

  const switchSpace = useCallback(async (spaceKey: string) => {
    if (!client || !context || !props.state.activeSessionKey) return;
    const switchGeneration = generationRef.current;
    const active = props.state.accountSessions[props.state.activeSessionKey];
    if (!active) return;

    setSessionStatus("switching");
    setError(null);
    const nextContext = createWorkbenchContextIdentity({
      deploymentUrl: active.apiBaseUrl,
      sessionId: active.desktopSessionId,
      spaceKey,
    });
    try {
      const nextBootstrap = await switchWorkbenchContext(nextContext, {
        previousContext: context,
        queryClient,
        setActionsEnabled: (enabled) => {
          if (generationRef.current === switchGeneration) {
            setActionsEnabled(enabled);
          }
        },
        bootstrap: (target) => client.bootstrap(target.spaceKey),
      });
      if (generationRef.current !== switchGeneration) return;
      persistState({
        ...props.state,
        accountSessions: {
          ...props.state.accountSessions,
          [active.sessionKey]: {
            ...active,
            activeSpaceKey: nextBootstrap.activeSpaceKey,
            lastUsedAt: new Date().toISOString(),
          },
        },
      });
      setBootstrap(nextBootstrap);
      setContext(createWorkbenchContextIdentity({
        deploymentUrl: active.apiBaseUrl,
        sessionId: active.desktopSessionId,
        spaceKey: nextBootstrap.activeSpaceKey,
      }));
      setSessionStatus("ready");
    } catch (switchError) {
      if (generationRef.current !== switchGeneration) return;
      setError(errorMessage(switchError));
      setSessionStatus("error");
    }
  }, [client, context, persistState, props.state, queryClient, setSessionStatus]);

  const logout = useCallback(async () => {
    advanceGeneration();
    const logoutClient = client;
    const logoutContext = context;
    setActionsEnabled(false);
    setUser(null);
    setBootstrap(null);
    setContext(null);
    setClient(null);
    setRuntimeCredentials(null);
    setLocalDeviceId(null);
    setError(null);
    setSessionStatus("signed_out");
    const active = props.state.activeSessionKey
      ? props.state.accountSessions[props.state.activeSessionKey]
      : null;
    persistState({
      ...props.state,
      activeSessionKey: null,
      accountSessions: active ? {
        ...props.state.accountSessions,
        [active.sessionKey]: {
          ...active,
          desktopSessionId: "",
          lastUsedAt: new Date().toISOString(),
        },
      } : props.state.accountSessions,
    });
    try {
      await logoutClient?.logout();
    } catch {
      // Local sign-out still completes when the remote session is unreachable.
    }
    if (logoutContext) {
      const prefix = workbenchContextQueryPrefix(logoutContext);
      await queryClient.cancelQueries({ queryKey: prefix });
      queryClient.removeQueries({ queryKey: prefix });
    }
  }, [
    advanceGeneration,
    client,
    context,
    persistState,
    props.state,
    queryClient,
    setSessionStatus,
  ]);

  const value = useMemo<DesktopSessionValue>(() => ({
    status,
    error,
    user,
    bootstrap,
    context,
    client,
    runtimeCredentials,
    localDeviceId,
    generation,
    actionsEnabled,
    updateRuntimeCredentials,
    login,
    logout,
    switchSpace,
  }), [
    actionsEnabled,
    bootstrap,
    client,
    context,
    error,
    generation,
    login,
    logout,
    runtimeCredentials,
    localDeviceId,
    status,
    switchSpace,
    updateRuntimeCredentials,
    user,
  ]);

  return (
    <DesktopSessionContext.Provider value={value}>
      {props.children}
    </DesktopSessionContext.Provider>
  );
}

export function useDesktopSession(): DesktopSessionValue {
  const value = useContext(DesktopSessionContext);
  if (!value) {
    throw new Error("useDesktopSession must be used within DesktopSessionProvider");
  }
  return value;
}

export function useOptionalDesktopSession(): DesktopSessionValue | null {
  return useContext(DesktopSessionContext);
}
