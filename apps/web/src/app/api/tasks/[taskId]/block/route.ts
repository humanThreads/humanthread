import { NextResponse } from "next/server";
import { blockTaskAction } from "@/lib/tasks/task-status-actions";
import { resolveWorkbenchApiActor } from "../../../../../lib/workbench/workbench-api-session";
import { taskApiErrorResponse } from "../../../../../lib/tasks/task-api";

interface BlockTaskRequestBody {
  reason: string;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = (await request.json()) as BlockTaskRequestBody;
    if (!body.reason) return NextResponse.json({ ok: false, error: "Missing reason" }, { status: 400 });
    const result = await blockTaskAction({
      taskId,
      actorUserId: actor.userId,
      reason: body.reason,
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
