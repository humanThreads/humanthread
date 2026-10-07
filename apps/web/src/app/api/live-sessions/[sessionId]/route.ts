import { resolveWorkbenchApiActor } from "../../../../lib/workbench/workbench-api-session";
import { getLiveSessionControl } from "../../../../lib/live-session/live-session-store";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { sessionId } = await context.params;
    await getLiveSessionControl().close({ userId: actor.userId }, sessionId);
    return Response.json({ ok: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "validation_failed";
    return Response.json({
      ok: false,
      code,
      error: error instanceof Error ? error.message : "Live session close failed",
    }, { status: code === "live_session_not_found" ? 404 : 400 });
  }
}
