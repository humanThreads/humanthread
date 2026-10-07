import { NextResponse } from "next/server";
import { z } from "zod";
import { addUserTaskComment } from "@/lib/tasks/task-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { taskApiErrorResponse, taskCommandMetadataSchema } from "../../../../../lib/tasks/task-api";
import { applyDesktopCors, createDesktopCorsPreflightResponse } from "../../../../../lib/desktop/desktop-cors";

const schema = taskCommandMetadataSchema.extend({ contentMarkdown: z.string().trim().min(1).max(10_000) });
const METHODS = ["OPTIONS", "POST"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = schema.parse(await request.json());
    const result = await addUserTaskComment({
      actor: { type: "user", id: actor.userId }, commandId: body.commandId,
      correlationId: `task:${taskId}`, taskId, expectedVersion: body.expectedVersion,
      contentMarkdown: body.contentMarkdown,
    });
    return applyDesktopCors(NextResponse.json({ ok: true, result }, { status: 201 }), request, METHODS);
  } catch (error) { return applyDesktopCors(taskApiErrorResponse(error), request, METHODS); }
}
