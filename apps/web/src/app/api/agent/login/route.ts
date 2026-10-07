import type {
  AgentLoginBindRequest,
  LocalAgentPlatform,
} from "@humanthread/shared";
import { loginAndRegisterAgentDevice } from "../../../../lib/agent/agent-login-binding";
import {
  createAgentCorsPreflightResponse,
  createAgentJsonResponse,
} from "../../../../lib/agent/agent-cors";

interface AgentLoginRequestBody extends Partial<AgentLoginBindRequest> {
  platform?: LocalAgentPlatform;
}

const AGENT_LOGIN_CORS_METHODS = ["OPTIONS", "POST"] as const;

export function OPTIONS(request: Request) {
  return createAgentCorsPreflightResponse(request, AGENT_LOGIN_CORS_METHODS);
}

export async function POST(request: Request) {
  const body = (await request.json()) as AgentLoginRequestBody;
  const currentDeviceToken = request.headers.get("x-agent-device-token")?.trim();

  if (!body.deviceId || !body.deviceName || !body.platform) {
    return createAgentJsonResponse(
      request,
      AGENT_LOGIN_CORS_METHODS,
      {
        ok: false,
        error: "Missing required agent login fields",
      },
      { status: 400 },
    );
  }

  try {
    const result = await loginAndRegisterAgentDevice({
      ...(body.email ? { email: body.email } : {}),
      ...(body.password ? { password: body.password } : {}),
      ...(body.userId ? { userId: body.userId } : {}),
      ...(body.bindingCode ? { bindingCode: body.bindingCode } : {}),
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      platform: body.platform,
      ...(currentDeviceToken ? { currentDeviceToken } : {}),
    });

    return createAgentJsonResponse(request, AGENT_LOGIN_CORS_METHODS, {
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown agent login error";
    const status = message.includes("user") || message.includes("User") ? 401 : 400;

    return createAgentJsonResponse(
      request,
      AGENT_LOGIN_CORS_METHODS,
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
