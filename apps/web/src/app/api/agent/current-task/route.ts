import { getAgentCurrentTask } from "../../../../lib/agent/agent-current-task";
import { authenticateAgentRequest } from "../../../../lib/agent/agent-auth";
import {
  createAgentCorsPreflightResponse,
  createAgentJsonResponse,
} from "../../../../lib/agent/agent-cors";

const AGENT_CURRENT_TASK_CORS_METHODS = ["OPTIONS", "GET"] as const;

export function OPTIONS(request: Request) {
  return createAgentCorsPreflightResponse(request, AGENT_CURRENT_TASK_CORS_METHODS);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId") ?? "team_1";
  const userId = searchParams.get("userId") ?? "user_owner";
  const deviceId = searchParams.get("deviceId") ?? "";

  if (!deviceId.trim()) {
    return createAgentJsonResponse(
      request,
      AGENT_CURRENT_TASK_CORS_METHODS,
      {
        ok: false,
        error: "Missing agent device ID",
      },
      { status: 400 },
    );
  }

  try {
    await authenticateAgentRequest({
      authorizationHeader: request.headers.get("authorization"),
      userId,
      expectedTeamId: teamId,
      deviceId,
      deviceTokenHeader: request.headers.get("x-agent-device-token"),
      requireAuthorizedDevice: true,
      allowDeviceTokenOnly: true,
    });

    const result = await getAgentCurrentTask({
      teamId,
      userId,
    });

    return createAgentJsonResponse(request, AGENT_CURRENT_TASK_CORS_METHODS, {
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown agent auth error";

    return createAgentJsonResponse(
      request,
      AGENT_CURRENT_TASK_CORS_METHODS,
      {
        ok: false,
        error: message,
      },
      { status: 401 },
    );
  }
}
