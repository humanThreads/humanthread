import {
  desktopBootstrapResponseSchema,
  type DesktopBootstrapResponse,
  type DesktopUser,
} from "@humanthread/workbench-client";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ZodType } from "zod";

import {
  createDesktopApiClient,
  type DesktopApiClient,
  type DesktopTokenSet,
} from "../api/desktop-api";
import {
  resolvePreviewIdentity,
  type PreviewIdentity,
  type PreviewIdentityStorage,
  type PreviewPlatform,
} from "../api/preview-identity";
import { previewQueryKey, type PreviewQueryContext } from "../api/query-keys";

export type PreviewSessionStatus =
  | "signed_out"
  | "authenticating"
  | "bootstrapping"
  | "ready"
  | "error";

export interface PreviewSessionValue {
  status: PreviewSessionStatus;
  error: string | null;
  user: DesktopUser | null;
  bootstrap: DesktopBootstrapResponse["data"] | null;
  identity: PreviewIdentity;
  api: DesktopApiClient;
  activeSpaceKey: string;
  login(input: { email: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  switchSpace(spaceKey: string): Promise<void>;
}

const PreviewSessionContext = createContext<PreviewSessionValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "桌面会话请求失败";
}

export function PreviewSessionProvider(props: {
  children: ReactNode;
  storage: PreviewIdentityStorage;
  fetch?: typeof fetch;
  platform?: PreviewPlatform;
}) {
  const [identity] = useState(() => {
    const detected = props.platform ?? (
      typeof navigator === "undefined" ? "linux" : navigator.platform
    );
    return resolvePreviewIdentity(props.storage, detected);
  });
  const [status, setStatus] = useState<PreviewSessionStatus>("signed_out");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<DesktopUser | null>(null);
  const [bootstrap, setBootstrap] = useState<DesktopBootstrapResponse["data"] | null>(null);
  const tokenRef = useRef<DesktopTokenSet | null>(null);

  const [api] = useState(() => createDesktopApiClient({
    ...(props.fetch ? { fetch: props.fetch } : {}),
    getTokens: () => tokenRef.current,
    refreshTokens: async () => {
      const client = createDesktopApiClient({
        ...(props.fetch ? { fetch: props.fetch } : {}),
        getTokens: () => tokenRef.current,
        refreshTokens: async () => {
          throw new Error("nested refresh is unavailable");
        },
      });
      const refreshed = await client.refresh();
      tokenRef.current = refreshed;
      return refreshed;
    },
  }));

  const loadBootstrap = useCallback(async (spaceKey?: string) => {
    const search = spaceKey ? `?${new URLSearchParams({ space: spaceKey }).toString()}` : "";
    const response = await api.request(
      `/api/desktop/session/bootstrap${search}`,
      desktopBootstrapResponseSchema,
    );
    setBootstrap(response.data);
    return response.data;
  }, [api]);

  const login = useCallback(async (credentials: { email: string; password: string }) => {
    setStatus("authenticating");
    setError(null);
    try {
      const loginResult = await api.login({
        ...credentials,
        identity,
        platform: identity.platform,
      });
      tokenRef.current = {
        accessToken: loginResult.accessToken,
        refreshToken: loginResult.refreshToken,
        sessionId: loginResult.sessionId,
        accessExpiresAt: loginResult.accessExpiresAt,
      };
      setUser(loginResult.user);
      setStatus("bootstrapping");
      await loadBootstrap();
      setStatus("ready");
    } catch (loginError) {
      tokenRef.current = null;
      setUser(null);
      setBootstrap(null);
      setError(errorMessage(loginError));
      setStatus("error");
    }
  }, [api, identity, loadBootstrap]);

  const switchSpace = useCallback(async (spaceKey: string) => {
    if (!tokenRef.current) return;
    setStatus("bootstrapping");
    setError(null);
    try {
      await loadBootstrap(spaceKey);
      setStatus("ready");
    } catch (switchError) {
      setError(errorMessage(switchError));
      setStatus("error");
    }
  }, [loadBootstrap]);

  const logout = useCallback(async () => {
    const tokens = tokenRef.current;
    tokenRef.current = null;
    setUser(null);
    setBootstrap(null);
    setError(null);
    setStatus("signed_out");
    if (!tokens) return;
    try {
      await api.logout(tokens);
    } catch {
      // Local sign-out always completes even when the remote session cannot be reached.
    }
  }, [api]);

  const value = useMemo<PreviewSessionValue>(() => ({
    status,
    error,
    user,
    bootstrap,
    identity,
    api,
    activeSpaceKey: bootstrap?.activeSpaceKey ?? "personal",
    login,
    logout,
    switchSpace,
  }), [api, bootstrap, error, identity, login, logout, status, switchSpace, user]);

  return (
    <PreviewSessionContext.Provider value={value}>
      {props.children}
    </PreviewSessionContext.Provider>
  );
}

export function usePreviewSession(): PreviewSessionValue {
  const value = useContext(PreviewSessionContext);
  if (!value) {
    throw new Error("usePreviewSession must be used within PreviewSessionProvider");
  }
  return value;
}

export function usePreviewReadModel<T>(input: {
  domain: string;
  endpoint: string;
  schema: ZodType<T>;
  parameters?: Readonly<Record<string, string | number | undefined>>;
  enabled?: boolean;
}) {
  const session = usePreviewSession();
  const parameters = input.parameters ?? {};
  const context: PreviewQueryContext | null = session.status === "ready"
    ? { sessionId: session.identity.installationId, spaceKey: session.activeSpaceKey }
    : null;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) search.set(key, String(value));
  }
  search.set("space", session.activeSpaceKey);

  return useQuery({
    enabled: session.status === "ready" && (input.enabled ?? true),
    queryKey: previewQueryKey(context, input.domain, parameters),
    queryFn: () => session.api.request(
      `${input.endpoint}?${search.toString()}`,
      input.schema,
    ),
  });
}
