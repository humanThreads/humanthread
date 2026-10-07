import { NextResponse } from "next/server";
import { transferTaskAction } from "@/lib/tasks/task-status-actions";
import { resolveWorkbenchApiActor } from "../../../../../lib/workbench/workbench-api-session";
import { taskApiErrorResponse } from "../../../../../lib/tasks/task-api";

interface TransferTaskRequestBody {
  targetUserId: string;
  reason: string;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = (await request.json()) as TransferTaskRequestBody;
    if (!body.targetUserId || !body.reason) {
      return NextResponse.json({ ok: false, error: "Missing targetUserId or reason" }, { status: 400 });
    }
    const result = await transferTaskAction({
      taskId,
      actorUserId: actor.userId,
      targetUserId: body.targetUserId,
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
