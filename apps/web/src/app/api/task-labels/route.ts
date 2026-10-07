import { NextResponse } from "next/server";
import { z } from "zod";
import { createTaskLabelDefinition, deleteTaskLabelDefinition, listTaskLabelDefinitions } from "@/lib/tasks/task-settings";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { taskApiErrorResponse } from "../../../lib/tasks/task-api";

const createSchema = z.object({
  id: z.string().trim().min(1).max(96), spaceId: z.string().trim().min(1).max(96),
  name: z.string().trim().min(1).max(64), color: z.string().regex(/^#[0-9a-f]{6}$/iu),
});
const deleteSchema = z.object({ spaceId: z.string().trim().min(1).max(96), labelId: z.string().trim().min(1).max(96) });

export async function GET(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const spaceId = new URL(request.url).searchParams.get("spaceId") ?? "";
    const labels = await listTaskLabelDefinitions({ userId: actor.userId, spaceId });
    return NextResponse.json({ ok: true, labels });
  } catch (error) { return taskApiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = createSchema.parse(await request.json());
    const label = await createTaskLabelDefinition({ userId: actor.userId, ...body });
    return NextResponse.json({ ok: true, label }, { status: 201 });
  } catch (error) { return taskApiErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = deleteSchema.parse(await request.json());
    const result = await deleteTaskLabelDefinition({ userId: actor.userId, ...body });
    return NextResponse.json({ ok: true, result });
  } catch (error) { return taskApiErrorResponse(error); }
}
