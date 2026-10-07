import { NextResponse } from "next/server";
import { z } from "zod";
import { createTaskStatusDefinition, deleteTaskStatusDefinition, listTaskStatusDefinitions } from "@/lib/tasks/task-settings";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { taskApiErrorResponse } from "../../../lib/tasks/task-api";

const createSchema = z.object({
  id: z.string().trim().min(1).max(96), spaceId: z.string().trim().min(1).max(96),
  projectId: z.string().trim().min(1).max(64).optional(), key: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(191),
  category: z.enum(["backlog", "todo", "in_progress", "in_review", "completed", "cancelled"]),
  color: z.string().regex(/^#[0-9a-f]{6}$/iu), sortOrder: z.number().int(),
});
const deleteSchema = z.object({ spaceId: z.string().trim().min(1).max(96), definitionId: z.string().trim().min(1).max(96) });

export async function GET(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const search = new URL(request.url).searchParams;
    const spaceId = search.get("spaceId") ?? "";
    const projectId = search.get("projectId");
    const definitions = await listTaskStatusDefinitions({
      userId: actor.userId,
      spaceId,
      ...(projectId ? { projectId } : {}),
    });
    return NextResponse.json({ ok: true, definitions });
  } catch (error) { return taskApiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = createSchema.parse(await request.json());
    const definition = await createTaskStatusDefinition({
      userId: actor.userId,
      id: body.id,
      spaceId: body.spaceId,
      key: body.key,
      name: body.name,
      category: body.category,
      color: body.color,
      sortOrder: body.sortOrder,
      ...(body.projectId ? { projectId: body.projectId } : {}),
    });
    return NextResponse.json({ ok: true, definition }, { status: 201 });
  } catch (error) { return taskApiErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = deleteSchema.parse(await request.json());
    const result = await deleteTaskStatusDefinition({ userId: actor.userId, ...body });
    return NextResponse.json({ ok: true, result });
  } catch (error) { return taskApiErrorResponse(error); }
}
