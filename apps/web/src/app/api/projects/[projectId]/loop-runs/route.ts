import { NextResponse } from "next/server";
import {
  loopApiError,
  loopTriggerRequestSchema,
} from "../../../../../lib/orchestration/loop-definition-contracts";
import { triggerProjectLoop } from "@/lib/orchestration/loop-trigger-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const [{ projectId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = loopTriggerRequestSchema.parse(await request.json());
    const result = await triggerProjectLoop({
      actorUserId: actor.userId,
      projectId,
      commandId: body.commandId,
      bindingId: body.bindingId,
      payload: body.payload,
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
