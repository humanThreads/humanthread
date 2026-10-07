import { NextResponse } from "next/server";
import { publishLoopDefinitionCommand } from "@/lib/orchestration/loop-definition-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  loopApiError,
  publishLoopDefinitionRequestSchema,
} from "../../../../../lib/orchestration/loop-definition-contracts";

export async function POST(request: Request, context: { params: Promise<{ loopDefinitionId: string }> }) {
  try {
    const [{ loopDefinitionId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = publishLoopDefinitionRequestSchema.parse(await request.json());
    const result = await publishLoopDefinitionCommand({
      actorUserId: actor.userId,
      loopDefinitionId,
      commandId: body.commandId,
      expectedDraftRevision: body.expectedRevision,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
