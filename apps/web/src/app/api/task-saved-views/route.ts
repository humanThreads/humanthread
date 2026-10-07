import { NextResponse } from "next/server";
import { z } from "zod";
import { taskApiErrorResponse } from "../../../lib/tasks/task-api";
import { parseTaskQuery } from "../../../lib/tasks/task-query";
import { deleteTaskSavedView, listTaskSavedViews, saveTaskView, updateTaskSavedView } from "@/lib/tasks/task-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  applyDesktopCors,
  createDesktopCorsPreflightResponse,
} from "../../../lib/desktop/desktop-cors";

const METHODS = ["DELETE", "GET", "OPTIONS", "PATCH", "POST"] as const;
const baseSchema = z.object({
  name: z.string().trim().min(1).max(191),
}).passthrough();

function desktopResponse(response: Response, request: Request) {
  return applyDesktopCors(response, request, METHODS);
}

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function GET(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const views = await listTaskSavedViews({ userId: actor.userId });
    return desktopResponse(NextResponse.json({ ok: true, views }), request);
  } catch (error) {
    return desktopResponse(taskApiErrorResponse(error), request);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const raw = await request.json() as Record<string, unknown>;
    const body = baseSchema.extend({ id: z.string().trim().min(1).max(96) }).parse(raw);
    const view = await saveTaskView({
      userId: actor.userId,
      id: body.id,
      name: body.name,
      query: parseTaskQuery(raw as Record<string, string | string[] | undefined>),
    });
    return desktopResponse(NextResponse.json({ ok: true, view }, { status: 201 }), request);
  } catch (error) {
    return desktopResponse(taskApiErrorResponse(error), request);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const raw = await request.json() as Record<string, unknown>;
    const body = baseSchema.extend({ viewId: z.string().trim().min(1).max(96) }).parse(raw);
    const result = await updateTaskSavedView({
      userId: actor.userId,
      viewId: body.viewId,
      name: body.name,
      query: parseTaskQuery(raw as Record<string, string | string[] | undefined>),
    });
    if (result.count !== 1) return desktopResponse(NextResponse.json({ ok: false, code: "not_found", error: "Saved view not found" }, { status: 404 }), request);
    return desktopResponse(NextResponse.json({ ok: true, result }), request);
  } catch (error) {
    return desktopResponse(taskApiErrorResponse(error), request);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { viewId } = z.object({ viewId: z.string().trim().min(1).max(96) }).parse(await request.json());
    const result = await deleteTaskSavedView({ userId: actor.userId, viewId });
    if (result.count !== 1) return desktopResponse(NextResponse.json({ ok: false, code: "not_found", error: "Saved view not found" }, { status: 404 }), request);
    return desktopResponse(NextResponse.json({ ok: true, result }), request);
  } catch (error) {
    return desktopResponse(taskApiErrorResponse(error), request);
  }
}
