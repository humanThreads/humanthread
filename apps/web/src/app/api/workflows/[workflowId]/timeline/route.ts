import { NextResponse } from "next/server";
import { getWorkflowTimeline } from "@/lib/overviews/task-overviews";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await context.params;
  const result = await getWorkflowTimeline({
    workflowId,
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
