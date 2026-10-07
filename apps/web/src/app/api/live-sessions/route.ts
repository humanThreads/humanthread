import { createLiveSessionInputSchema } from "../../../../../../packages/shared/src/index";

import { resolveWorkbenchApiActor } from "../../../lib/workbench/workbench-api-session";
import { getLiveSessionControl } from "../../../lib/live-session/live-session-store";

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const sessions = await getLiveSessionControl().list({ userId: actor.userId });
    return Response.json({ ok: true, result: { sessions } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const input = createLiveSessionInputSchema.parse(await request.json());
    const result = await getLiveSessionControl().create(input, { userId: actor.userId });
    return Response.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "validation_failed";
  const status = code === "live_session_not_found"
    ? 404
    : code === "agent_device_offline" || code === "worker_pool_unavailable" || code === "task_not_open"
      ? 409
      : 400;
  return Response.json({
    ok: false,
    code,
    error: error instanceof Error ? error.message : "Live session request failed",
  }, { status });
}
