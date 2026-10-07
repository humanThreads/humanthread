import { NextResponse } from "next/server";
import {
  getWorkbenchDocument,
  updateWorkbenchDocument,
  moveWorkbenchDocument,
  restoreWorkbenchDocument,
  trashWorkbenchDocument,
} from "@/lib/workbench/workbench-documents";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

interface UpdateDocumentRequestBody {
  expectedVersion?: number;
  title?: string;
  contentMarkdown?: string;
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
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;

  try {
    const document = await getWorkbenchDocument({
      documentId,
      userId: (await resolveWorkbenchApiActor(request)).userId,
    });

    return NextResponse.json({
      ok: true,
      document,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;
  const body = (await request.json()) as UpdateDocumentRequestBody;

  if (
    typeof body.expectedVersion !== "number" ||
    !body.title ||
    body.contentMarkdown === undefined
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing required document update fields",
      },
      { status: 400 },
    );
  }

  try {
    const document = await updateWorkbenchDocument({
      documentId,
      userId: (await resolveWorkbenchApiActor(request)).userId,
      expectedVersion: body.expectedVersion,
      title: body.title,
      contentMarkdown: body.contentMarkdown,
      source: "web",
    });

    return NextResponse.json({
      ok: true,
      document,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;
  const body = (await request.json()) as {
    operation?: "move" | "trash" | "restore";
    directoryId?: string | null;
    sortOrder?: number;
    path?: string;
  };
  try {
    const userId = (await resolveWorkbenchApiActor(request)).userId;
    const document = body.operation === "move"
      ? await moveWorkbenchDocument({
          userId,
          documentId,
          directoryId: body.directoryId ?? null,
          sortOrder: body.sortOrder ?? 0,
        })
      : body.operation === "trash"
        ? await trashWorkbenchDocument({ userId, documentId })
        : body.operation === "restore"
          ? await restoreWorkbenchDocument({
              userId,
              documentId,
              ...(body.directoryId !== undefined ? { directoryId: body.directoryId } : {}),
              ...(body.path ? { path: body.path } : {}),
            })
          : null;
    if (!document) {
      return NextResponse.json({ ok: false, error: "Invalid document operation" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, document });
  } catch (error) {
    return errorResponse(error);
  }
}
