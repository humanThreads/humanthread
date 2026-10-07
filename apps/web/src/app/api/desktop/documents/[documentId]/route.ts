import {
  desktopDocumentDetailResponseSchema,
  desktopDocumentUpdateRequestSchema,
  desktopDocumentUpdateResponseSchema,
} from "@humanthread/workbench-client";
import { z } from "zod";

import {
  DesktopDocumentVersionConflictError,
  readDesktopDocumentDetail,
  updateDesktopDocument,
} from "@/lib/desktop/desktop-document-models";
import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
} from "../../../../../lib/desktop/desktop-cors";

const METHODS = ["GET", "PUT", "OPTIONS"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

function errorResponse(request: Request, error: unknown): Response {
  const message = error instanceof Error ? error.message : "Desktop Document request failed";
  if (error instanceof DesktopDocumentVersionConflictError) {
    return createDesktopJsonResponse(request, METHODS, {
      ok: false,
      code: "version_conflict",
      error: message,
      currentVersion: error.currentVersion,
    }, { status: 409 });
  }
  const status = message === "Workbench API authentication required"
    ? 401
    : message === "Space access denied" || /access denied|write access/iu.test(message)
      ? 403
      : message === "Document not found"
        ? 404
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
  const code = status === 401
    ? "authentication_required"
    : status === 403
      ? "authorization_denied"
      : status === 404
        ? "document_not_found"
        : status === 400
          ? "validation_failed"
          : "internal_error";
  return createDesktopJsonResponse(request, METHODS, {
    ok: false,
    code,
    error: status === 500 ? "Desktop Document request failed" : message,
  }, { status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;
  try {
    const data = await readDesktopDocumentDetail(request, documentId);
    return createDesktopJsonResponse(
      request,
      METHODS,
      desktopDocumentDetailResponseSchema.parse({ ok: true, data }),
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;
  try {
    const input = desktopDocumentUpdateRequestSchema.parse(await request.json());
    const data = await updateDesktopDocument(request, documentId, input);
    return createDesktopJsonResponse(
      request,
      METHODS,
      desktopDocumentUpdateResponseSchema.parse({ ok: true, data }),
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
