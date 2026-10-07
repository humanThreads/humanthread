import { NextResponse } from "next/server";
import { startTaskAction } from "@/lib/tasks/task-status-actions";
import { resolveWorkbenchApiActor } from "../../../../../lib/workbench/workbench-api-session";
import { taskApiErrorResponse } from "../../../../../lib/tasks/task-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const result = await startTaskAction({
      taskId,
      actorUserId: actor.userId,
    });

    return NextResponse.json({
      ok: true,
      workflow: result.workflow,
      task: result.task,
      events: result.events,
    });
  } catch (error) {
    return taskApiErrorResponse(error);
  }
}
