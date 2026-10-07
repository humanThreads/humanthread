import { parseForwardCompatibleResponse } from "@humanthread/workbench-client";
import type { ZodType } from "zod";

import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
  logDesktopRequestFailure,
} from "./desktop-cors";

const METHODS = ["GET", "OPTIONS"] as const;

export function createDesktopReadPreflightResponse(request: Request): Response {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function createDesktopReadResponse(
  request: Request,
  read: (request: Request) => Promise<unknown>,
  responseSchema: ZodType,
): Promise<Response> {
  try {
    const data = await read(request);
    const body = parseForwardCompatibleResponse(responseSchema, { ok: true, data });
    return createDesktopJsonResponse(request, METHODS, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop read request failed";
    if (message === "Workbench API authentication required") {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "authentication_required", error: message },
        { status: 401 },
      );
    }
    if (message === "Space access denied") {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "authorization_denied", error: message },
        { status: 403 },
      );
    }
    if (message === "Task not found") {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "task_not_found", error: message },
        { status: 404 },
      );
    }
    if (message === "Project not found") {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "project_not_found", error: message },
        { status: 404 },
      );
    }
    if (message === "Document not found") {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "document_not_found", error: message },
        { status: 404 },
      );
    }
    if (message === "Loop not found") {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "loop_not_found", error: message },
        { status: 404 },
      );
    }
    logDesktopRequestFailure("desktop_read_request_failed", request, error);
    return createDesktopJsonResponse(
      request,
      METHODS,
      { ok: false, code: "internal_error", error: "Desktop read request failed" },
      { status: 500 },
    );
  }
}
