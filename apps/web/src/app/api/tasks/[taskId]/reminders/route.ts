import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserTaskReminder, removeUserTaskReminder } from "@/lib/tasks/task-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { taskApiErrorResponse, taskCommandMetadataSchema } from "../../../../../lib/tasks/task-api";
import { applyDesktopCors, createDesktopCorsPreflightResponse } from "../../../../../lib/desktop/desktop-cors";

const createSchema = taskCommandMetadataSchema.extend({ remindAt: z.string().datetime().transform((value) => new Date(value)) });
const removeSchema = taskCommandMetadataSchema.extend({ reminderId: z.string().trim().min(1).max(96) });
const METHODS = ["OPTIONS", "POST", "DELETE"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = createSchema.parse(await request.json());
    const result = await createUserTaskReminder({
      actor: { type: "user", id: actor.userId }, commandId: body.commandId,
      correlationId: `task:${taskId}`, taskId, expectedVersion: body.expectedVersion, remindAt: body.remindAt,
    });
    return applyDesktopCors(NextResponse.json({ ok: true, result }, { status: 201 }), request, METHODS);
  } catch (error) { return applyDesktopCors(taskApiErrorResponse(error), request, METHODS); }
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = removeSchema.parse(await request.json());
    const result = await removeUserTaskReminder({
      actor: { type: "user", id: actor.userId }, commandId: body.commandId,
      correlationId: `task:${taskId}`, taskId, expectedVersion: body.expectedVersion, reminderId: body.reminderId,
    });
    return applyDesktopCors(NextResponse.json({ ok: true, result }), request, METHODS);
  } catch (error) { return applyDesktopCors(taskApiErrorResponse(error), request, METHODS); }
}
