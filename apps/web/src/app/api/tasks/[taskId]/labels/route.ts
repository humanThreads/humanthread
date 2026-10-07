import { NextResponse } from "next/server";
import { z } from "zod";
import { addUserTaskLabel, removeUserTaskLabel } from "@/lib/tasks/task-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { taskApiErrorResponse, taskCommandMetadataSchema } from "../../../../../lib/tasks/task-api";
import { applyDesktopCors, createDesktopCorsPreflightResponse } from "../../../../../lib/desktop/desktop-cors";

const schema = taskCommandMetadataSchema.extend({ labelId: z.string().trim().min(1).max(96) });
const METHODS = ["OPTIONS", "POST", "DELETE"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

async function mutate(request: Request, context: { params: Promise<{ taskId: string }> }, remove: boolean) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = schema.parse(await request.json());
    const command = remove ? removeUserTaskLabel : addUserTaskLabel;
    const result = await command({
      actor: { type: "user", id: actor.userId }, commandId: body.commandId,
      correlationId: `task:${taskId}`, taskId, expectedVersion: body.expectedVersion, labelId: body.labelId,
    });
    return applyDesktopCors(NextResponse.json({ ok: true, result }, { status: remove ? 200 : 201 }), request, METHODS);
  } catch (error) { return applyDesktopCors(taskApiErrorResponse(error), request, METHODS); }
}

export const POST = (request: Request, context: { params: Promise<{ taskId: string }> }) => mutate(request, context, false);
export const DELETE = (request: Request, context: { params: Promise<{ taskId: string }> }) => mutate(request, context, true);
