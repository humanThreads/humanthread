import {
  desktopLoginResponseSchema,
  desktopRefreshResponseSchema,
  normalizeWorkbenchApiError,
  parseForwardCompatibleResponse,
  type DesktopDevice,
  type DesktopUser,
} from "@humanthread/workbench-client";
import type { ZodType } from "zod";

import type { PreviewIdentity } from "./preview-identity";

export interface DesktopTokenSet {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  accessExpiresAt: string;
}

export interface DesktopLoginResult extends DesktopTokenSet {
  user: DesktopUser;
  device: DesktopDevice;
}

export interface DesktopApiClient {
  request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T>;
  login(input: {
    email: string;
    password: string;
    identity: PreviewIdentity;
    platform: "macos" | "windows" | "linux";
  }): Promise<DesktopLoginResult>;
  refresh(): Promise<DesktopTokenSet>;
  logout(tokens: DesktopTokenSet): Promise<void>;
}

export interface DesktopApiClientInput {
  fetch?: typeof fetch;
  getTokens: () => DesktopTokenSet | null;
  refreshTokens: () => Promise<DesktopTokenSet>;
}

function tokenSet(input: {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  accessExpiresAt: string;
}): DesktopTokenSet {
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    sessionId: input.sessionId,
    accessExpiresAt: input.accessExpiresAt,
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createDesktopApiClient(input: DesktopApiClientInput): DesktopApiClient {
  const fetchImplementation = input.fetch ?? fetch;

  async function send(
    path: string,
    init: RequestInit,
    tokens: DesktopTokenSet | null,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (tokens?.accessToken) {
      headers.set("authorization", `Bearer ${tokens.accessToken}`);
    }
    return fetchImplementation(path, { ...init, headers });
  }

  async function parseResponse<T>(response: Response, schema: ZodType<T>): Promise<T> {
    const body = await responseBody(response);
    if (!response.ok) {
      throw normalizeWorkbenchApiError({ status: response.status, body });
    }
    return parseForwardCompatibleResponse(schema, body);
  }

  async function request<T>(
    path: string,
    schema: ZodType<T>,
    init: RequestInit = {},
    allowRefresh = true,
    overrideTokens?: DesktopTokenSet,
  ): Promise<T> {
    const response = await send(path, init, overrideTokens ?? input.getTokens());
    if (response.status === 401 && allowRefresh && input.getTokens()) {
      const refreshed = await input.refreshTokens();
      return request(path, schema, init, false, refreshed);
    }
    return parseResponse(response, schema);
  }

  return {
    request,
    async login(loginInput) {
      const response = await send("/api/desktop/session", {
        method: "POST",
        body: JSON.stringify({
          email: loginInput.email.trim().toLowerCase(),
          password: loginInput.password,
          installationId: loginInput.identity.installationId,
          deviceId: loginInput.identity.deviceId,
          deviceName: loginInput.identity.deviceName,
          platform: loginInput.platform,
        }),
      }, null);
      const data = await parseResponse(response, desktopLoginResponseSchema);
      return {
        ...tokenSet(data.data),
        user: data.data.user,
        device: data.data.device,
      };
    },
    async refresh() {
      const current = input.getTokens();
      if (!current) {
        throw normalizeWorkbenchApiError({
          status: 401,
          body: { code: "authentication_required", error: "Desktop session is unavailable" },
        });
      }
      const response = await send("/api/desktop/session/refresh", {
        method: "POST",
        body: JSON.stringify({
          sessionId: current.sessionId,
          refreshToken: current.refreshToken,
        }),
      }, null);
      const data = await parseResponse(response, desktopRefreshResponseSchema);
      return tokenSet(data.data);
    },
    async logout(tokens) {
      const response = await send("/api/desktop/session/logout", {
        method: "POST",
        body: JSON.stringify({
          sessionId: tokens.sessionId,
          refreshToken: tokens.refreshToken,
        }),
      }, tokens);
      if (!response.ok) {
        throw normalizeWorkbenchApiError({
          status: response.status,
          body: await responseBody(response),
        });
      }
    },
  };
}
