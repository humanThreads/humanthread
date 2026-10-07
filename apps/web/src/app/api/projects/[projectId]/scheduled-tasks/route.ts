import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createProjectScheduledTask,
} from "@humanthread/db";
import { createProjectScheduledTaskSchema } from "@humanthread/shared";
import { loopApiError } from "@/lib/orchestration/loop-definition-contracts";
import { readProjectScheduledTaskList } from "@/lib/orchestration/scheduled-task-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

type Context = { params: Promise<{ projectId: string }> };

const statusQuerySchema = z.enum(["inactive", "enabled", "disabled"]).optional();

export async function GET(request: Request, context: Context) {
  try {
    const [{ projectId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const status = statusQuerySchema.parse(
      new URL(request.url).searchParams.get("status") ?? undefined,
    );
    const result = await readProjectScheduledTaskList({
      userId: actor.userId,
      projectId,
      ...(status === undefined ? {} : { status }),
    });
    if (!result) {
      throw Object.assign(new Error("Project not found"), { code: "not_found" });
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const [{ projectId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = createProjectScheduledTaskSchema.parse(await request.json());
    const result = await createProjectScheduledTask({
      actorUserId: actor.userId,
      projectId,
      commandId: body.commandId,
      name: body.name,
      description: body.description,
      loopBindingId: body.loopBindingId,
      cronExpression: body.cronExpression,
      timezone: body.timezone,
      contentMode: body.contentMode,
      ...(body.contentMarkdown === undefined ? {} : { contentMarkdown: body.contentMarkdown }),
      executionTarget: body.executionTarget,
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
