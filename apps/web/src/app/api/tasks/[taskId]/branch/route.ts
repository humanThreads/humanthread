import { NextResponse } from "next/server";
import { assignTaskBranch } from "@/lib/tasks/task-branch-command";
import { taskApiErrorResponse, taskCommandMetadataSchema } from "../../../../../lib/tasks/task-api";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { applyDesktopCors, createDesktopCorsPreflightResponse } from "../../../../../lib/desktop/desktop-cors";

const METHODS = ["OPTIONS", "POST"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (process.env.HUMANTHREAD_DEVELOPMENT_MODES !== "true") {
    return applyDesktopCors(
      NextResponse.json({ ok: false, code: "not_found", error: "Task branch assignment is unavailable" }, { status: 404 }),
      request,
      METHODS,
    );
  }

  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = taskCommandMetadataSchema.parse(await request.json());
    const result = await assignTaskBranch({
      actor: { type: "user", id: actor.userId },
      commandId: body.commandId,
      correlationId: `task:${taskId}`,
      taskId,
      expectedVersion: body.expectedVersion,
    });
    return applyDesktopCors(NextResponse.json({ ok: true, result }), request, METHODS);
  } catch (error) {
    return applyDesktopCors(taskApiErrorResponse(error), request, METHODS);
  }
}
