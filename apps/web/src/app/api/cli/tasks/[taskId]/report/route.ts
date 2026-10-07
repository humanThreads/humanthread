import { NextResponse } from "next/server";
import { authenticateCliTaskReport, reportCliTaskStatusAction } from "@/lib/tasks/cli-report-actions";

interface CliReportRequestBody {
  status: "completed" | "interrupted" | "follow_up" | "blocked";
  exitCode?: number | null;
  durationSeconds?: number;
  outputSummary?: string;
  payload?: unknown;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  const body = (await request.json()) as CliReportRequestBody;

  if (!body.status) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing status",
      },
      { status: 400 },
    );
  }

  try {
    await authenticateCliTaskReport({
      taskId,
      authorizationHeader: request.headers.get("authorization"),
    });
    const result = await reportCliTaskStatusAction({
      taskId,
      status: body.status,
      ...(body.exitCode !== undefined ? { exitCode: body.exitCode } : {}),
      ...(body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
      ...(body.outputSummary !== undefined ? { outputSummary: body.outputSummary } : {}),
      ...(body.payload !== undefined ? { payload: body.payload } : {}),
    });

    return NextResponse.json({
      ok: true,
      reportedStatus: result.reportedStatus,
      workflow: result.workflow,
      task: result.task,
      nextTask: result.nextTask,
      events: result.events,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown CLI report error";

    const status = message.includes("authorization token")
      || message.includes("Agent user")
      || message.includes("requested team")
      ? 401
      : 400;
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
