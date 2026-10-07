import type { LocalAgentPlatform } from "@humanthread/shared";
import { reportAgentTaskEvent } from "../../../../lib/agent/agent-events";
import { authenticateAgentRequest } from "../../../../lib/agent/agent-auth";
import {
  createAgentCorsPreflightResponse,
  createAgentJsonResponse,
} from "../../../../lib/agent/agent-cors";

interface AgentEventRequestBody {
  taskId?: string;
  actorUserId?: string;
  eventType?: string;
  message?: string;
  payload?: unknown;
  localDevice?: {
    id?: string;
    name?: string;
    platform?: LocalAgentPlatform;
  };
}

const AGENT_EVENTS_CORS_METHODS = ["OPTIONS", "POST"] as const;

export function OPTIONS(request: Request) {
  return createAgentCorsPreflightResponse(request, AGENT_EVENTS_CORS_METHODS);
}

export async function POST(request: Request) {
  const body = (await request.json()) as AgentEventRequestBody;

  if (
    !body.taskId ||
    !body.actorUserId ||
    !body.eventType ||
    !body.localDevice?.id ||
    !body.localDevice?.name ||
    !body.localDevice?.platform
  ) {
    return createAgentJsonResponse(
      request,
      AGENT_EVENTS_CORS_METHODS,
      {
        ok: false,
        error: "Missing required agent event fields",
      },
      { status: 400 },
    );
  }

  try {
    const auth = await authenticateAgentRequest({
      authorizationHeader: request.headers.get("authorization"),
      userId: body.actorUserId,
      deviceId: body.localDevice.id,
      deviceTokenHeader: request.headers.get("x-agent-device-token"),
      requireAuthorizedDevice: true,
      allowDeviceTokenOnly: true,
    });

    const result = await reportAgentTaskEvent({
      taskId: body.taskId,
      actorUserId: body.actorUserId,
      actorTeamId: auth.teamId,
      eventType: body.eventType,
      ...(body.message ? { message: body.message } : {}),
      ...(body.payload !== undefined ? { payload: body.payload } : {}),
      localDevice: {
        id: body.localDevice.id,
        name: body.localDevice.name,
        platform: body.localDevice.platform,
      },
    });

    return createAgentJsonResponse(request, AGENT_EVENTS_CORS_METHODS, {
      ok: true,
      event: result.event,
      localDevice: result.localDevice,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown agent event error";
    const status =
      message.includes("authorization") ||
      message.includes("Agent user") ||
      message.includes("requested team")
        ? 401
        : 400;

    return createAgentJsonResponse(
      request,
      AGENT_EVENTS_CORS_METHODS,
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
