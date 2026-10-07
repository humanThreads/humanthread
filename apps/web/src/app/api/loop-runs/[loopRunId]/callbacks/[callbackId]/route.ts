import { NextResponse } from "next/server";
import { z } from "zod";
import { completeLoopCallback } from "@/lib/orchestration/loop-callback-commands";
import { loopApiError } from "../../../../../../lib/orchestration/loop-definition-contracts";

const callbackRequestSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  secret: z.string().min(1).max(4_096),
  payload: z.record(z.string(), z.unknown()),
}).strict();

type Context = { params: Promise<{ loopRunId: string; callbackId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { loopRunId, callbackId } = await context.params;
    const body = callbackRequestSchema.parse(await request.json());
    const result = await completeLoopCallback({
      loopRunId,
      callbackId,
      commandId: body.commandId,
      secret: body.secret,
      payload: body.payload,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
