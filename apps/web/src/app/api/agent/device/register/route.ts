import { agentDeviceRegisterRequestSchema } from "../../../../../../../../packages/shared/src/index";
import { authenticateAgentRequest } from "../../../../../lib/agent/agent-auth";
import {
  createAgentCorsPreflightResponse,
  createAgentJsonResponse,
} from "../../../../../lib/agent/agent-cors";
import { registerAgentDevice } from "../../../../../lib/agent/agent-device-registration";

const AGENT_DEVICE_REGISTER_CORS_METHODS = ["OPTIONS", "POST"] as const;

export function OPTIONS(request: Request) {
  return createAgentCorsPreflightResponse(
    request,
    AGENT_DEVICE_REGISTER_CORS_METHODS,
  );
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = agentDeviceRegisterRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return createAgentJsonResponse(
      request,
      AGENT_DEVICE_REGISTER_CORS_METHODS,
      {
        ok: false,
        error: "Missing required device registration fields",
      },
      { status: 400 },
    );
  }

  const body = parsed.data;

  try {
    const authorizationHeader = request.headers.get("authorization");
    const deviceTokenHeader = request.headers.get("x-agent-device-token");
    await authenticateAgentRequest(deviceTokenHeader?.trim()
      ? {
          authorizationHeader,
          userId: body.userId,
          deviceId: body.deviceId,
          deviceTokenHeader,
          requireAuthorizedDevice: true,
          allowDeviceTokenOnly: true,
        }
      : {
          authorizationHeader,
          userId: body.userId,
        });

    const result = await registerAgentDevice({
      userId: body.userId,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      platform: body.platform,
      capabilitySnapshot: body.capabilitySnapshot,
      ...(body.agentVersion === undefined ? {} : { agentVersion: body.agentVersion }),
      ...(deviceTokenHeader?.trim()
        ? {
            currentDeviceToken: deviceTokenHeader.trim(),
          }
        : {}),
    });

    return createAgentJsonResponse(
      request,
      AGENT_DEVICE_REGISTER_CORS_METHODS,
      {
        ok: true,
        ...result,
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown device register error";
    const status =
      message.includes("authorization") || message.includes("Agent user")
        ? 401
        : 400;

    return createAgentJsonResponse(
      request,
      AGENT_DEVICE_REGISTER_CORS_METHODS,
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
