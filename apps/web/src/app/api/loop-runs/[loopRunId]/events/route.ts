import { NextResponse } from "next/server";
import { z } from "zod";
import { loopApiError } from "../../../../../lib/orchestration/loop-definition-contracts";
import { readLoopEventsAfterCursor } from "@/lib/orchestration/loop-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const cursorSchema = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
type Context = { params: Promise<{ loopRunId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const [{ loopRunId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const cursor = cursorSchema.parse(new URL(request.url).searchParams.get("cursor") ?? "0");
    const result = await readLoopEventsAfterCursor({ userId: actor.userId, loopRunId, cursor });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
