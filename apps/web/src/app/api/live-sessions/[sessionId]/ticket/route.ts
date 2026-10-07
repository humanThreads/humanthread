import { resolveWorkbenchApiActor } from "../../../../../lib/workbench/workbench-api-session";
import { z } from "zod";
import {
  getLiveSessionControl,
  issueLiveSessionControlTicket,
  issueLiveSessionViewerTicket,
} from "../../../../../lib/live-session/live-session-store";

const ticketRequestSchema = z.object({
  kind: z.enum(["control", "viewer"]).default("control"),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { sessionId } = await context.params;
    const { kind } = ticketRequestSchema.parse(await readJsonBody(request));
    const sessions = await getLiveSessionControl().list({ userId: actor.userId });
    if (!sessions.some((session) => session.id === sessionId)) {
      return Response.json({ ok: false, code: "live_session_not_found", error: "Live session was not found" }, { status: 404 });
    }
    const ticket = kind === "viewer"
      ? issueLiveSessionViewerTicket({ sessionId })
      : issueLiveSessionControlTicket({ sessionId });
    return Response.json({ ok: true, result: { ticket } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "validation_failed";
    return Response.json({
      ok: false,
      code,
      error: error instanceof Error ? error.message : "Live session ticket failed",
    }, { status: code === "live_session_not_found" ? 404 : 401 });
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}
