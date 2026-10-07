import { NextResponse } from "next/server";
import {
  createWorkbenchSpaceDocument,
  listSpaceDocuments,
} from "@/lib/workbench/workbench-documents";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown document error";
  const status = message === "Workbench API authentication required"
    ? 401
    : /access denied|write access/iu.test(message)
      ? 403
      : /not found/iu.test(message)
        ? 404
        : /conflict|not empty|cycle|crosses containers|unique/iu.test(message)
          ? 409
          : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { spaceId } = await context.params;
    const documents = await listSpaceDocuments({
      spaceId,
      userId: (await resolveWorkbenchApiActor(request)).userId,
    });
    return NextResponse.json({ ok: true, documents });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { spaceId } = await context.params;
    const body = (await request.json()) as {
      title?: string;
      path?: string;
      contentMarkdown?: string;
      directoryId?: string;
    };
    const document = await createWorkbenchSpaceDocument({
      spaceId,
      userId: (await resolveWorkbenchApiActor(request)).userId,
      title: body.title ?? "",
      path: body.path ?? "",
      contentMarkdown: body.contentMarkdown ?? "",
      ...(body.directoryId ? { directoryId: body.directoryId } : {}),
      source: "web",
    });
    return NextResponse.json({ ok: true, document }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
