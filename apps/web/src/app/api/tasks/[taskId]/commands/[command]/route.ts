import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addUserTaskBlocker,
  assignUserTask,
  archiveUserTask,
  changeUserTaskStatus,
  dispatchUserTaskToAgent,
  rejectUserTask,
  resolveUserTaskBlocker,
  restoreUserTask,
  updateUserTaskFields,
  updateUserTaskSchedule,
} from "@/lib/tasks/task-commands";
import { submitTaskAcceptanceEvidence } from "@/lib/tasks/task-acceptance-evidence";
import { taskApiErrorResponse, taskCommandMetadataSchema } from "../../../../../../lib/tasks/task-api";
import {
  applyDesktopCors,
  createDesktopCorsPreflightResponse,
} from "../../../../../../lib/desktop/desktop-cors";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const METHODS = ["OPTIONS", "POST"] as const;
const commandSchema = taskCommandMetadataSchema.extend({
  reason: z.string().optional(),
  blockerId: z.string().optional(),
  ownerUserId: z.string().optional(),
  agentProfileId: z.string().optional(),
  assigneeUserId: z.string().trim().min(1).max(64).optional(),
  priority: z.number().int().min(0).max(3).optional(),
  projectId: z.string().trim().min(1).max(64).nullable().optional(),
  title: z.string().trim().min(1).max(191).optional(),
  startAt: z.iso.datetime().transform((value) => new Date(value)).nullable().optional(),
  dueAt: z.iso.datetime().transform((value) => new Date(value)).nullable().optional(),
  recurrenceRule: z.string().trim().max(512).nullable().optional(),
  loopBinding: z.object({
    bindingId: z.string().trim().min(1).max(96),
    bindingType: z.enum(["task", "project"]),
  }).nullable().optional(),
  checkKey: z.string().trim().min(1).max(96).optional(),
  status: z.enum(["passed", "failed", "inconclusive", "skipped"]).optional(),
  summary: z.string().trim().min(1).max(2_000).optional(),
  evidenceMarkdown: z.string().trim().max(10_000).optional(),
  startedAt: z.iso.datetime().transform((value) => new Date(value)).optional(),
  finishedAt: z.iso.datetime().transform((value) => new Date(value)).optional(),
});
const STATUS_COMMANDS = new Set([
  "move_to_todo", "start", "complete", "submit_for_review", "accept", "reject", "cancel", "reopen",
] as const);

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string; command: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId, command } = await context.params;
    const body = commandSchema.parse(await request.json());
    const base = {
      actor: { type: "user" as const, id: actor.userId },
      commandId: body.commandId,
      correlationId: `task:${taskId}`,
      taskId,
      expectedVersion: body.expectedVersion,
    };
    let result: unknown;
    if (command === "submit_acceptance_evidence") {
      if (!body.checkKey || !body.status || !body.summary) {
        throw new z.ZodError([{
          code: "custom",
          path: [],
          message: "checkKey, status, and summary are required",
        }]);
      }
      result = await submitTaskAcceptanceEvidence({
        ...base,
        source: "user",
        checkKey: body.checkKey,
        status: body.status,
        summary: body.summary,
        ...(body.evidenceMarkdown ? { evidenceMarkdown: body.evidenceMarkdown } : {}),
        ...(body.startedAt ? { startedAt: body.startedAt } : {}),
        ...(body.finishedAt ? { finishedAt: body.finishedAt } : {}),
      });
    } else if (command === "reject") {
      if (!body.reason?.trim()) throw new z.ZodError([{ code: "custom", path: ["reason"], message: "reason is required" }]);
      result = await rejectUserTask({ ...base, reason: body.reason });
    } else if (STATUS_COMMANDS.has(command as never)) {
      result = await changeUserTaskStatus({
        ...base,
        command: command as "move_to_todo" | "start" | "complete" | "submit_for_review" | "accept" | "reject" | "cancel" | "reopen",
        ...(body.reason ? { reason: body.reason } : {}),
      });
    } else if (command === "add_blocker") {
      result = await addUserTaskBlocker({ ...base, reason: body.reason ?? "", ...(body.ownerUserId ? { ownerUserId: body.ownerUserId } : {}) });
    } else if (command === "resolve_blocker") {
      result = await resolveUserTaskBlocker({ ...base, blockerId: body.blockerId ?? "" });
    } else if (command === "archive") {
      result = await archiveUserTask(base);
    } else if (command === "restore") {
      result = await restoreUserTask(base);
    } else if (command === "dispatch_agent") {
      if (!body.agentProfileId) throw new z.ZodError([{ code: "custom", path: ["agentProfileId"], message: "agentProfileId is required" }]);
      result = await dispatchUserTaskToAgent({ ...base, agentProfileId: body.agentProfileId });
    } else if (command === "assign") {
      if (!body.assigneeUserId) throw new z.ZodError([{ code: "custom", path: ["assigneeUserId"], message: "assigneeUserId is required" }]);
      result = await assignUserTask({ ...base, assigneeUserId: body.assigneeUserId });
    } else if (command === "update_fields") {
      if (body.title === undefined && body.priority === undefined && body.projectId === undefined) throw new z.ZodError([{ code: "custom", path: [], message: "Task field is required" }]);
      result = await updateUserTaskFields({
        ...base,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      });
    } else if (command === "update_schedule") {
      if (body.startAt === undefined && body.dueAt === undefined && body.recurrenceRule === undefined && body.loopBinding === undefined) throw new z.ZodError([{ code: "custom", path: [], message: "Task schedule field is required" }]);
      result = await updateUserTaskSchedule({
        ...base,
        ...(body.startAt !== undefined ? { startAt: body.startAt } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
        ...(body.recurrenceRule !== undefined ? { recurrenceRule: body.recurrenceRule } : {}),
        ...(body.loopBinding !== undefined ? { loopBinding: body.loopBinding } : {}),
      });
    } else {
      return applyDesktopCors(
        NextResponse.json({ ok: false, code: "validation_failed", error: "Unknown Task command" }, { status: 400 }),
        request,
        METHODS,
      );
    }
    return applyDesktopCors(NextResponse.json({ ok: true, result }), request, METHODS);
  } catch (error) {
    return applyDesktopCors(taskApiErrorResponse(error), request, METHODS);
  }
}
