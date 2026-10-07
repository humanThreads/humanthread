import { NextResponse } from "next/server";
import { z } from "zod";
import { taskCommandMetadataSchema, taskApiErrorResponse } from "../../../../lib/tasks/task-api";
import { updateUserTaskContent, updateUserTaskFields } from "@/lib/tasks/task-commands";
import { getTaskDetailView } from "@/lib/tasks/task-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const updateTaskSchema = taskCommandMetadataSchema.extend({
  contentMarkdown: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const detail = await getTaskDetailView({ userId: actor.userId, taskId });
    if (!detail) return NextResponse.json({ ok: false, code: "task_not_found", error: "Task not found" }, { status: 404 });
    return NextResponse.json({ ok: true, detail });
  } catch (error) {
    return taskApiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = updateTaskSchema.parse(await request.json());
    if (body.contentMarkdown === undefined && body.customFields === undefined) {
      return NextResponse.json({ ok: false, code: "validation_failed", error: "Task content or custom fields are required" }, { status: 400 });
    }
    const result = body.customFields !== undefined
      ? await updateUserTaskFields({
          actor: { type: "user", id: actor.userId },
          commandId: body.commandId,
          correlationId: `task:${taskId}`,
          taskId,
          expectedVersion: body.expectedVersion,
          ...(body.contentMarkdown !== undefined ? { contentMarkdown: body.contentMarkdown } : {}),
          customFields: body.customFields,
        })
      : await updateUserTaskContent({
          actor: { type: "user", id: actor.userId },
          commandId: body.commandId,
          correlationId: `task:${taskId}`,
          taskId,
          expectedVersion: body.expectedVersion,
          contentMarkdown: body.contentMarkdown!,
        });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return taskApiErrorResponse(error);
  }
}
