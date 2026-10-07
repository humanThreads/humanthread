import { NextResponse } from "next/server";
import {
  createWorkbenchDocument,
  listProjectDocuments,
} from "@/lib/workbench/workbench-documents";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

interface CreateDocumentRequestBody {
  title?: string;
  path?: string;
  contentMarkdown?: string;
  directoryId?: string;
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
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  try {
    const documents = await listProjectDocuments({
      projectId,
      userId: (await resolveWorkbenchApiActor(request)).userId,
    });

    return NextResponse.json({
      ok: true,
      documents,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const body = (await request.json()) as CreateDocumentRequestBody;

  if (!body.title || !body.path || body.contentMarkdown === undefined) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing required document fields",
      },
      { status: 400 },
    );
  }

  try {
    const document = await createWorkbenchDocument({
      projectId,
      userId: (await resolveWorkbenchApiActor(request)).userId,
      title: body.title,
      path: body.path,
      contentMarkdown: body.contentMarkdown,
      ...(body.directoryId ? { directoryId: body.directoryId } : {}),
      source: "web",
    });

    return NextResponse.json(
      {
        ok: true,
        document,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
