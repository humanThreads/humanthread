import { NextResponse } from "next/server";
import {
  deleteWorkbenchDocumentDirectory,
  updateWorkbenchDocumentDirectory,
} from "@/lib/workbench/workbench-documents";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Document directory request failed";
  const status = message === "Workbench API authentication required"
    ? 401
    : /access denied/iu.test(message)
      ? 403
      : /not found/iu.test(message)
        ? 404
        : /conflict|not empty|cycle|crosses containers/iu.test(message)
          ? 409
          : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ directoryId: string }> },
) {
  try {
    const { directoryId } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      parentId?: string | null;
      sortOrder?: number;
    };
    if (body.name === undefined && body.parentId === undefined && body.sortOrder === undefined) {
      return NextResponse.json({ ok: false, error: "Document directory update is empty" }, { status: 400 });
    }
    const directory = await updateWorkbenchDocumentDirectory({
      userId: (await resolveWorkbenchApiActor(request)).userId,
      directoryId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    });
    return NextResponse.json({ ok: true, directory });
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ directoryId: string }> },
) {
  try {
    const { directoryId } = await context.params;
    const directory = await deleteWorkbenchDocumentDirectory({
      userId: (await resolveWorkbenchApiActor(request)).userId,
      directoryId,
    });
    return NextResponse.json({ ok: true, directory });
  } catch (error) {
    return responseError(error);
  }
}
