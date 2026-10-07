import { readProjectLoopCatalogV2 } from "../../../../../../lib/orchestration/project-loop-catalog";
import { authenticateAgentRequest } from "../../../../../../lib/agent/agent-auth";
import {
  createAgentCorsPreflightResponse,
  createAgentJsonResponse,
} from "../../../../../../lib/agent/agent-cors";

type Context = { params: Promise<{ projectId: string }> };
const METHODS = ["OPTIONS", "GET"] as const;

export function OPTIONS(request: Request) {
  return createAgentCorsPreflightResponse(request, METHODS);
}

export async function GET(request: Request, context: Context) {
  const [{ projectId }, url] = await Promise.all([context.params, Promise.resolve(new URL(request.url))]);
  const userId = url.searchParams.get("userId")?.trim() ?? "";
  const deviceId = url.searchParams.get("deviceId")?.trim() ?? "";
  if (!userId || !deviceId) {
    return createAgentJsonResponse(request, METHODS, { ok: false, error: "Missing agent user or device ID" }, { status: 400 });
  }
  try {
    const teamId = url.searchParams.get("teamId")?.trim();
    await authenticateAgentRequest({
      authorizationHeader: request.headers.get("authorization"),
      userId,
      ...(teamId ? { expectedTeamId: teamId } : {}),
      deviceId,
      deviceTokenHeader: request.headers.get("x-agent-device-token"),
      requireAuthorizedDevice: true,
      allowDeviceTokenOnly: true,
    });
    const catalog = await readProjectLoopCatalogV2({ userId, projectId });
    if (!catalog) return createAgentJsonResponse(request, METHODS, { ok: false, error: "Project not found" }, { status: 404 });
    return createAgentJsonResponse(request, METHODS, { ok: true, result: catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = loopCatalogErrorStatus(message);
    return createAgentJsonResponse(request, METHODS, {
      ok: false,
      error: status === 500 ? "Loop catalog request failed" : message,
    }, { status });
  }
}

function loopCatalogErrorStatus(message: string): number {
  if (/project not found/iu.test(message)) return 404;
  if (/authorization token|Agent user|requested team|agent device|device token/iu.test(message)) return 401;
  if (/access denied/iu.test(message)) return 403;
  return 500;
}
