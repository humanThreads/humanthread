import { NextResponse } from "next/server";
import {
  createLoopDraftCommand,
} from "@/lib/orchestration/loop-definition-commands";
import {
  createLoopDraftRequestSchema,
  loopDefinitionListQuerySchema,
  loopApiError,
} from "../../../lib/orchestration/loop-definition-contracts";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { listLoopDefinitionsForUser } from "@/lib/orchestration/loop-product-read-model";

export async function GET(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const url = new URL(request.url);
    const query = loopDefinitionListQuerySchema.parse({ spaceId: url.searchParams.get("spaceId") ?? "" });
    const result = await listLoopDefinitionsForUser({ userId: actor.userId, spaceId: query.spaceId });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = createLoopDraftRequestSchema.parse(await request.json());
    const result = await createLoopDraftCommand({
      actorUserId: actor.userId,
      commandId: body.commandId,
      spaceId: body.spaceId,
      scope: body.scope,
      name: body.name,
      ...(body.description === undefined ? {} : { description: body.description }),
      graph: body.graph,
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
