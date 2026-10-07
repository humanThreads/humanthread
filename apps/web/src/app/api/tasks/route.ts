import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserTask } from "@/lib/tasks/task-commands";
import { taskApiErrorResponse } from "../../../lib/tasks/task-api";
import { parseTaskQuery } from "../../../lib/tasks/task-query";
import { getTaskCollection } from "@/lib/tasks/task-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const optionalDate = z.string().datetime().transform((value) => new Date(value)).optional();
const createTaskSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  correlationId: z.string().trim().min(1).max(128).optional(),
  spaceId: z.string().trim().min(1).max(96),
  title: z.string().trim().min(1).max(191),
  contentMarkdown: z.string().optional(),
  projectId: z.string().trim().min(1).max(64).optional(),
  milestoneId: z.string().trim().min(1).max(96).optional(),
  assigneeUserId: z.string().trim().min(1).max(64).optional(),
  visibility: z.enum(["private", "project", "company"]).optional(),
  priority: z.number().int().optional(),
  startAt: optionalDate,
  dueAt: optionalDate,
  recurrenceRule: z.string().trim().max(512).nullable().optional(),
  loopBinding: z.object({ bindingId: z.string().trim().min(1).max(96), bindingType: z.enum(["task", "project"]) }).nullable().optional(),
  acceptanceMode: z.enum(["none", "human", "automated", "hybrid"]).optional(),
  requiredChecks: z.array(z.string().trim().min(1).max(96)).max(32).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, context) => {
  if (value.acceptanceMode !== "automated" && value.acceptanceMode !== "hybrid") return;
  if (!value.projectId) {
    context.addIssue({
      code: "custom",
      path: ["projectId"],
      message: "自动或混合验收必须关联项目",
    });
  }
  if (!value.requiredChecks || value.requiredChecks.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["requiredChecks"],
      message: "自动或混合验收至少需要一项必需检查",
    });
  }
});

export async function GET(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const url = new URL(request.url);
    const searchParams = Object.fromEntries(url.searchParams.entries());
    const collection = await getTaskCollection({
      userId: actor.userId,
      ...(url.searchParams.get("spaceId") ? { spaceId: url.searchParams.get("spaceId")! } : {}),
      query: parseTaskQuery(searchParams),
      timeZone: url.searchParams.get("timeZone") || "Asia/Shanghai",
    });
    return NextResponse.json({ ok: true, collection });
  } catch (error) {
    return taskApiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = createTaskSchema.parse(await request.json());
    const result = await createUserTask({
      actor: { type: "user", id: actor.userId },
      commandId: body.commandId,
      correlationId: body.correlationId ?? `task:create:${body.commandId}`,
      payload: {
        spaceId: body.spaceId,
        title: body.title,
        ...(body.contentMarkdown !== undefined ? { contentMarkdown: body.contentMarkdown } : {}),
        ...(body.projectId ? { projectId: body.projectId } : {}),
        ...(body.milestoneId ? { milestoneId: body.milestoneId } : {}),
        ...(body.assigneeUserId ? { assigneeUserId: body.assigneeUserId } : {}),
        ...(body.visibility ? { visibility: body.visibility } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.startAt ? { startAt: body.startAt } : {}),
        ...(body.dueAt ? { dueAt: body.dueAt } : {}),
        ...(body.recurrenceRule !== undefined ? { recurrenceRule: body.recurrenceRule } : {}),
        ...(body.loopBinding !== undefined ? { loopBinding: body.loopBinding } : {}),
        ...(body.acceptanceMode ? { acceptanceMode: body.acceptanceMode } : {}),
        ...(body.requiredChecks ? { acceptancePolicy: { requiredChecks: body.requiredChecks } } : {}),
        ...(body.customFields ? { customFields: body.customFields } : {}),
      },
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    return taskApiErrorResponse(error);
  }
}
