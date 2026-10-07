import { NextResponse } from "next/server";
import { z } from "zod";
import { addUserTaskMember, removeUserTaskMember } from "@/lib/tasks/task-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { taskApiErrorResponse, taskCommandMetadataSchema } from "../../../../../lib/tasks/task-api";
import { applyDesktopCors, createDesktopCorsPreflightResponse } from "../../../../../lib/desktop/desktop-cors";

const addSchema = taskCommandMetadataSchema.extend({
  userId: z.string().trim().min(1).max(64),
  role: z.enum(["participant", "follower"]),
});
const removeSchema = taskCommandMetadataSchema.extend({ userId: z.string().trim().min(1).max(64) });
const METHODS = ["OPTIONS", "POST", "DELETE"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = addSchema.parse(await request.json());
    const result = await addUserTaskMember({
      actor: { type: "user", id: actor.userId },
      commandId: body.commandId,
      correlationId: `task:${taskId}`,
      taskId,
      expectedVersion: body.expectedVersion,
      userId: body.userId,
      role: body.role,
    });
    return applyDesktopCors(NextResponse.json({ ok: true, result }, { status: 201 }), request, METHODS);
  } catch (error) {
    return applyDesktopCors(taskApiErrorResponse(error), request, METHODS);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = removeSchema.parse(await request.json());
    const result = await removeUserTaskMember({
      actor: { type: "user", id: actor.userId },
      commandId: body.commandId,
      correlationId: `task:${taskId}`,
      taskId,
      expectedVersion: body.expectedVersion,
      userId: body.userId,
    });
    return applyDesktopCors(NextResponse.json({ ok: true, result }), request, METHODS);
  } catch (error) {
    return applyDesktopCors(taskApiErrorResponse(error), request, METHODS);
  }
}
