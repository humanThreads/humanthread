import { NextResponse } from "next/server";
import {
  archiveLoopDefinitionCommand,
  activateLoopVersionCommand,
  deleteLoopDefinitionCommand,
  updateLoopDraftCommand,
} from "@/lib/orchestration/loop-definition-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  loopApiError,
  activateLoopVersionRequestSchema,
  loopDefinitionLifecycleRequestSchema,
  updateLoopDraftRequestSchema,
} from "../../../../lib/orchestration/loop-definition-contracts";
import { readLoopDefinitionEditor } from "@/lib/orchestration/loop-product-read-model";

type Context = { params: Promise<{ loopDefinitionId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const [{ loopDefinitionId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const result = await readLoopDefinitionEditor({ userId: actor.userId, loopDefinitionId });
    if (!result) throw Object.assign(new Error("Loop definition not found"), { code: "not_found" });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const [{ loopDefinitionId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = updateLoopDraftRequestSchema.parse(await request.json());
    const result = await updateLoopDraftCommand({
      actorUserId: actor.userId,
      loopDefinitionId,
      commandId: body.commandId,
      expectedDraftRevision: body.expectedRevision,
      name: body.name,
      ...(body.description === undefined ? {} : { description: body.description }),
      graph: body.graph,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const [{ loopDefinitionId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = activateLoopVersionRequestSchema.parse(await request.json());
    const result = await activateLoopVersionCommand({
      actorUserId: actor.userId,
      loopDefinitionId,
      commandId: body.commandId,
      activeVersionId: body.activeVersionId,
      expectedDraftRevision: body.expectedRevision,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const [{ loopDefinitionId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = loopDefinitionLifecycleRequestSchema.parse(await request.json());
    const input = {
      actorUserId: actor.userId,
      loopDefinitionId,
      commandId: body.commandId,
      expectedDraftRevision: body.expectedRevision,
    };
    const result = body.mode === "archive"
      ? await archiveLoopDefinitionCommand(input)
      : await deleteLoopDefinitionCommand(input);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
