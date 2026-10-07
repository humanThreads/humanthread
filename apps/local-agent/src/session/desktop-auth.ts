import {
  desktopBootstrapResponseSchema,
  desktopLoginResponseSchema,
  desktopRefreshResponseSchema,
  normalizeWorkbenchApiError,
  parseForwardCompatibleResponse,
  type DesktopBootstrapResponse,
  type DesktopLoginResponse,
  type WorkbenchApiError,
} from "@humanthread/workbench-client";
import type { ZodType } from "zod";

export type DesktopFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const DESKTOP_LOGIN_TIMEOUT_MS = 15_000;

export function withDesktopLoginTimeout<T>(
  operation: Promise<T>,
  input: {
    message: string;
    timeoutMs?: number;
    onTimeout?: () => void;
  },
): Promise<T> {
  const timeoutMs = input.timeoutMs ?? DESKTOP_LOGIN_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(input.message));
      try {
        input.onTimeout?.();
      } catch {
        // The timeout result must remain stable even if cancellation fails.
      }
    }, timeoutMs);

    void operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export interface DesktopAccessSession {
  accessToken: string;
  accessExpiresAt: string;
  sessionId: string;
}

export interface DesktopRuntimeSession extends DesktopAccessSession {
  refreshToken: string;
}

interface HttpResponseError {
  status: number;
  body: unknown;
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Desktop deployment must use HTTP or HTTPS");
  }
  return url.toString().replace(/\/$/u, "");
}

async function responseError(response: Response): Promise<WorkbenchApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return normalizeWorkbenchApiError({ status: response.status, body } satisfies HttpResponseError);
}

function mergeHeaders(
  input: HeadersInit | undefined,
  values: Record<string, string>,
): Headers {
  const headers = new Headers(input);
  for (const [name, value] of Object.entries(values)) {
    headers.set(name, value);
  }
  return headers;
}

export async function loginDesktopSession(
  input: {
    apiBaseUrl: string;
    email: string;
    password: string;
    installationId: string;
    deviceId: string;
    deviceName: string;
    platform: "macos" | "windows" | "linux";
    currentDeviceToken?: string;
  },
  dependencies: { fetch?: DesktopFetch; timeoutMs?: number } = {},
): Promise<DesktopLoginResponse["data"]> {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const controller = new AbortController();
  const loginOperation = (async () => {
    const response = await fetchImplementation(
      `${normalizeApiBaseUrl(input.apiBaseUrl)}/api/desktop/session`,
      {
        method: "POST",
        signal: controller.signal,
        headers: mergeHeaders(undefined, {
          accept: "application/json",
          "content-type": "application/json",
          ...(input.currentDeviceToken
            ? { "x-agent-device-token": input.currentDeviceToken }
            : {}),
        }),
        body: JSON.stringify({
          email: input.email.trim().toLowerCase(),
          password: input.password,
          installationId: input.installationId,
          deviceId: input.deviceId,
          deviceName: input.deviceName,
          platform: input.platform,
        }),
      },
    );

    if (!response.ok) throw await responseError(response);
    return parseForwardCompatibleResponse(
      desktopLoginResponseSchema,
      await response.json(),
    ).data;
  })();

  return withDesktopLoginTimeout(loginOperation, {
    message: "登录服务器响应超时，请检查网络后重试。",
    ...(dependencies.timeoutMs === undefined
      ? {}
      : { timeoutMs: dependencies.timeoutMs }),
    onTimeout: () => controller.abort(),
  });
}

export function createDesktopAuthClient(input: {
  apiBaseUrl: string;
  sessionId: string;
  accessToken?: string;
  accessExpiresAt?: string;
  refreshToken?: string;
  fetch?: DesktopFetch;
}) {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const fetchImplementation = input.fetch ?? fetch;
  let session: DesktopAccessSession = {
    accessToken: input.accessToken ?? "",
    accessExpiresAt: input.accessExpiresAt ?? "",
    sessionId: input.sessionId,
  };
  let refreshToken = input.refreshToken?.trim() ?? "";
  let refreshFlight: Promise<void> | null = null;
  let refreshController: AbortController | null = null;
  let generation = 0;
  let closed = false;

  function clearRuntimeCredentials(): void {
    session = {
      accessToken: "",
      accessExpiresAt: "",
      sessionId: "",
    };
    refreshToken = "";
  }

  function sessionUnavailableError(): WorkbenchApiError {
    return normalizeWorkbenchApiError({ status: 401, body: {
      code: "desktop_refresh_missing",
      error: "Desktop refresh credential is unavailable",
    } });
  }

  async function rotateSession(): Promise<void> {
    if (closed || !refreshToken) throw sessionUnavailableError();
    const requestGeneration = generation;
    const requestSessionId = session.sessionId;
    const requestRefreshToken = refreshToken;
    const controller = new AbortController();
    refreshController = controller;
    const refreshed = await withDesktopLoginTimeout((async () => {
      const response = await fetchImplementation(
        `${apiBaseUrl}/api/desktop/session/refresh`,
        {
          method: "POST",
          signal: controller.signal,
          headers: mergeHeaders(undefined, {
            accept: "application/json",
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            sessionId: requestSessionId,
            refreshToken: requestRefreshToken,
          }),
        },
      );
      if (!response.ok) throw await responseError(response);
      return parseForwardCompatibleResponse(
        desktopRefreshResponseSchema,
        await response.json(),
      ).data;
    })(), {
      message: "会话刷新响应超时，请重新登录。",
      onTimeout: () => controller.abort(),
    }).finally(() => {
      if (refreshController === controller) refreshController = null;
    });
    if (closed || generation !== requestGeneration) {
      throw sessionUnavailableError();
    }
    refreshToken = refreshed.refreshToken;
    session = {
      accessToken: refreshed.accessToken,
      accessExpiresAt: refreshed.accessExpiresAt,
      sessionId: refreshed.sessionId,
    };
  }

  function refreshOnce(): Promise<void> {
    if (closed) return Promise.reject(sessionUnavailableError());
    if (!refreshFlight) {
      let flight: Promise<void>;
      flight = rotateSession().finally(() => {
        if (refreshFlight === flight) refreshFlight = null;
      });
      refreshFlight = flight;
    }
    return refreshFlight;
  }

  async function fetchAuthorized(path: string, init?: RequestInit): Promise<Response> {
    if (closed) throw sessionUnavailableError();
    if (!session.accessToken) await refreshOnce();
    if (closed) throw sessionUnavailableError();

    const request = () => fetchImplementation(`${apiBaseUrl}${path}`, {
      ...init,
      headers: mergeHeaders(init?.headers, {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
      }),
    });
    let response = await request();
    if (response.status === 401) {
      await refreshOnce();
      if (closed) throw sessionUnavailableError();
      response = await request();
    }
    return response;
  }

  async function fetchDeviceAuthorized(path: string, init?: RequestInit): Promise<Response> {
    if (closed) throw sessionUnavailableError();
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    headers.set("accept", "application/json");
    return fetchImplementation(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  return {
    getSession(): DesktopAccessSession {
      return { ...session };
    },
    getRuntimeCredentials(): DesktopRuntimeSession {
      return { ...session, refreshToken };
    },
    async request<T>(
      path: string,
      schema: ZodType<T>,
      init?: RequestInit,
    ): Promise<T> {
      const response = await fetchAuthorized(path, init);
      if (!response.ok) throw await responseError(response);
      return parseForwardCompatibleResponse(schema, await response.json());
    },
    async requestDeviceAuthorized<T>(
      path: string,
      schema: ZodType<T>,
      init?: RequestInit,
    ): Promise<T> {
      const response = await fetchDeviceAuthorized(path, init);
      if (!response.ok) throw await responseError(response);
      return parseForwardCompatibleResponse(schema, await response.json());
    },
    async bootstrap(
      spaceKey?: string,
      init?: Pick<RequestInit, "signal">,
    ): Promise<DesktopBootstrapResponse["data"]> {
      const search = spaceKey
        ? `?${new URLSearchParams({ space: spaceKey }).toString()}`
        : "";
      const response = await fetchAuthorized(
        `/api/desktop/session/bootstrap${search}`,
        init,
      );
      if (!response.ok) throw await responseError(response);
      return parseForwardCompatibleResponse(
        desktopBootstrapResponseSchema,
        await response.json(),
      ).data;
    },
    async logout(): Promise<void> {
      if (closed) return;
      const logoutSessionId = session.sessionId;
      const logoutRefreshToken = refreshToken;
      closed = true;
      generation += 1;
      refreshController?.abort();
      clearRuntimeCredentials();
      const controller = new AbortController();
      try {
        if (!logoutRefreshToken) return;
        await withDesktopLoginTimeout(
          (async () => {
            const result = await fetchImplementation(
              `${apiBaseUrl}/api/desktop/session/logout`,
              {
                method: "POST",
                signal: controller.signal,
                headers: mergeHeaders(undefined, {
                  accept: "application/json",
                  "content-type": "application/json",
                }),
                body: JSON.stringify({
                  sessionId: logoutSessionId,
                  refreshToken: logoutRefreshToken,
                }),
              },
            );
            if (!result.ok) throw await responseError(result);
            return result;
          })(),
          {
            message: "退出登录响应超时，本机会话已清除。",
            onTimeout: () => controller.abort(),
          },
        );
      } finally {
        clearRuntimeCredentials();
      }
    },
  };
}
