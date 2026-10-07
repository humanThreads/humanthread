import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { readLoopAttemptLiveStream } from "@/lib/live-session/loop-attempt-live-stream";

type Context = { params: Promise<{ loopRunId: string; attemptId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  let actor: { userId: string };
  try {
    actor = await resolveWorkbenchApiActor(request);
  } catch {
    return Response.json({ ok: false, errorCode: "unauthorized" }, { status: 401 });
  }
  const params = await context.params;
  let loopRunId: string;
  let attemptId: string;
  try {
    // Loop ids embed a namespace separator and arrive percent-encoded from the
    // browser. The read model decodes for the same reason; without it an
    // encoded attempt id never matched its primary key.
    loopRunId = decodeRouteId(params.loopRunId, "LoopRun id");
    attemptId = decodeRouteId(params.attemptId, "Attempt id");
  } catch {
    return Response.json({ ok: false, errorCode: "validation_failed" }, { status: 400 });
  }
  try {
    const result = await readLoopAttemptLiveStream({
      userId: actor.userId,
      loopRunId,
      attemptId,
    });
    if ("unavailableCode" in result) {
      return Response.json({ ok: false, errorCode: result.unavailableCode }, { status: 404 });
    }
    return Response.json({ ok: true, result });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(Reflect.get(error, "code"))
      : "validation_failed";
    const status = code === "unauthorized" || code === "forbidden" ? 401 : 400;
    return Response.json({ ok: false, errorCode: code }, { status });
  }
}

function decodeRouteId(value: string, name: string): string {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.length > 128 || decoded !== decoded.trim()) {
    throw new Error(`${name} is invalid`);
  }
  return decoded;
}
