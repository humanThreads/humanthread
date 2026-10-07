import { NextResponse } from "next/server";
import { z } from "zod";

import { updateProjectScheduledTask } from "@humanthread/db";
import { updateProjectScheduledTaskSchema } from "@humanthread/shared";
import { loopApiError } from "@/lib/orchestration/loop-definition-contracts";
import { readProjectScheduledTaskDetail } from "@/lib/orchestration/scheduled-task-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

type Context = { params: Promise<{ projectId: string; scheduledTaskId: string }> };

const runQuerySchema = z.string().trim().regex(/^[a-f0-9]{32}$/u).optional();

export async function GET(request: Request, context: Context) {
  try {
    const [{ projectId, scheduledTaskId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const runId = runQuerySchema.parse(
      new URL(request.url).searchParams.get("run") ?? undefined,
    );
    const result = await readProjectScheduledTaskDetail({
      userId: actor.userId,
      projectId,
      scheduledTaskId,
      ...(runId === undefined ? {} : { runId }),
    });
    if (!result) {
      throw Object.assign(new Error("Scheduled task not found"), { code: "not_found" });
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const [{ projectId, scheduledTaskId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = updateProjectScheduledTaskSchema.parse(await request.json());
    const result = await updateProjectScheduledTask({
      actorUserId: actor.userId,
      projectId,
      scheduledTaskId,
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.loopBindingId === undefined ? {} : { loopBindingId: body.loopBindingId }),
      ...(body.cronExpression === undefined ? {} : { cronExpression: body.cronExpression }),
      ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
      ...(body.contentMode === undefined ? {} : { contentMode: body.contentMode }),
      ...(body.contentMarkdown === undefined ? {} : { contentMarkdown: body.contentMarkdown }),
      ...(body.executionTarget === undefined ? {} : { executionTarget: body.executionTarget }),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
