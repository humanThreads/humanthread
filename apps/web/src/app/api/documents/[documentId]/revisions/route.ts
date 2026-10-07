import { NextResponse } from "next/server";
import { listWorkbenchDocumentRevisions } from "@/lib/workbench/workbench-documents";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown document error";
  const status =
    message === "Workbench API authentication required"
      ? 401
      : message.includes("access denied") || message.includes("Access denied")
      ? 403
      : message.includes("not found") || message.includes("not found")
        ? 404
        : 400;

  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;

  try {
    const revisions = await listWorkbenchDocumentRevisions({
      documentId,
      userId: (await resolveWorkbenchApiActor(request)).userId,
    });

    return NextResponse.json({
      ok: true,
      revisions,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
