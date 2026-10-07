import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { deleteProjectTaskField, projectTaskFieldId, upsertProjectTaskField } from "@/lib/workbench/project-task-fields";

const fieldSchema = z.object({
  key: z.string().trim().min(2).max(64),
  name: z.string().trim().min(1).max(191),
  type: z.enum(["text", "number", "date", "boolean", "select", "user"]),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(191)).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, code: "validation_failed", error: "Invalid task field request", issues: error.issues }, { status: 400 });
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Task field request failed";
  const status = message === "Workbench API authentication required" ? 401 : code === "authorization_denied" || /access denied/iu.test(message) ? 403 : code === "not_found" ? 404 : code === "validation_failed" ? 400 : 500;
  return NextResponse.json({ ok: false, code: code || "internal_error", error: status === 500 ? "Task field request failed" : message }, { status });
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; fieldId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId, fieldId } = await context.params;
    const field = fieldSchema.parse(await request.json());
    if (fieldId !== projectTaskFieldId(projectId, field.key)) {
      return NextResponse.json({ ok: false, code: "validation_failed", error: "Field key cannot change through this route" }, { status: 400 });
    }
    const result = await upsertProjectTaskField({ userId: actor.userId, projectId, field: {
      key: field.key,
      name: field.name,
      type: field.type,
      ...(field.required !== undefined ? { required: field.required } : {}),
      ...(field.options !== undefined ? { options: field.options } : {}),
      ...(field.sortOrder !== undefined ? { sortOrder: field.sortOrder } : {}),
      ...(field.isActive !== undefined ? { isActive: field.isActive } : {}),
    } });
    return NextResponse.json({ ok: true, field: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string; fieldId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId, fieldId } = await context.params;
    return NextResponse.json({ ok: true, result: await deleteProjectTaskField({ userId: actor.userId, projectId, fieldId }) });
  } catch (error) {
    return errorResponse(error);
  }
}
