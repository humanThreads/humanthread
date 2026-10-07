import { NextResponse } from "next/server";
import {
  createWorkbenchDocumentDirectory,
  listWorkbenchDocumentTree,
} from "@/lib/workbench/workbench-documents";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Document tree request failed";
  const status = message === "Workbench API authentication required"
    ? 401
    : /access denied/iu.test(message)
      ? 403
      : /not found/iu.test(message)
        ? 404
        : /conflict|not empty|crosses containers/iu.test(message)
          ? 409
          : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await context.params;
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const tree = await listWorkbenchDocumentTree({
      userId: (await resolveWorkbenchApiActor(request)).userId,
      spaceId,
      ...(projectId ? { projectId } : {}),
    });
    return NextResponse.json({ ok: true, tree });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ spaceId: string }> },
) {
  try {
    const { spaceId } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      projectId?: string;
      parentId?: string;
    };
    if (!body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "Document directory name is required" }, { status: 400 });
    }
    const directory = await createWorkbenchDocumentDirectory({
      userId: (await resolveWorkbenchApiActor(request)).userId,
      spaceId,
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.parentId ? { parentId: body.parentId } : {}),
      name: body.name,
    });
    return NextResponse.json({ ok: true, directory }, { status: 201 });
  } catch (error) {
    return responseError(error);
  }
}
