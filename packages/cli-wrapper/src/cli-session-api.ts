import type { CliSession } from "./cli-session";

type SessionResponse = {
  ok: true;
  data: {
    accessToken: string;
    accessExpiresAt: string;
    refreshToken: string;
    sessionId: string;
    device?: { id: string };
  };
};

function requestError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function parseResponse(response: Response, requiresDevice: boolean): Promise<SessionResponse> {
  let payload: unknown;
  try { payload = await response.json(); } catch { throw requestError("authentication_required", "HumanThread login failed"); }
  if (!response.ok || !payload || typeof payload !== "object" || Reflect.get(payload, "ok") !== true) {
    throw requestError("authentication_required", "HumanThread login failed");
  }
  const data = Reflect.get(payload, "data");
  if (!data || typeof data !== "object") throw requestError("authentication_required", "HumanThread login failed");
  const values = ["accessToken", "accessExpiresAt", "refreshToken", "sessionId"]
    .map((key) => Reflect.get(data, key));
  if (values.some((value) => typeof value !== "string" || !value.trim())) throw requestError("authentication_required", "HumanThread login failed");
  const device = Reflect.get(data, "device");
  if (requiresDevice && (!device || typeof device !== "object" || typeof Reflect.get(device, "id") !== "string")) {
    throw requestError("authentication_required", "HumanThread login failed");
  }
  return payload as SessionResponse;
}

export async function loginCliSession(input: {
  baseUrl: string;
  email: string;
  password: string;
  installationId: string;
  deviceId: string;
  fetch?: typeof fetch;
}): Promise<CliSession> {
  const baseUrl = input.baseUrl.replace(/\/+$/u, "");
  const response = await (input.fetch ?? fetch)(`${baseUrl}/api/desktop/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      installationId: input.installationId,
      deviceId: input.deviceId,
      deviceName: "HumanThread CLI",
      platform: process.platform === "linux" ? "linux" : process.platform === "win32" ? "windows" : "macos",
    }),
  });
  const payload = await parseResponse(response, true);
  return {
    baseUrl,
    installationId: input.installationId,
    deviceId: payload.data.device!.id,
    sessionId: payload.data.sessionId,
    accessToken: payload.data.accessToken,
    accessExpiresAt: payload.data.accessExpiresAt,
    refreshToken: payload.data.refreshToken,
  };
}

export async function refreshCliSession(input: CliSession, request: typeof fetch = fetch): Promise<CliSession> {
  const response = await request(`${input.baseUrl}/api/desktop/session/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: input.sessionId, refreshToken: input.refreshToken }),
  });
  const payload = await parseResponse(response, false);
  return { ...input, sessionId: payload.data.sessionId, accessToken: payload.data.accessToken, accessExpiresAt: payload.data.accessExpiresAt, refreshToken: payload.data.refreshToken };
}
