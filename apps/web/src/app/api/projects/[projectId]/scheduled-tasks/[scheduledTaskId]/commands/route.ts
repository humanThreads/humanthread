import { NextResponse } from "next/server";
import { z } from "zod";

import {
  changeProjectScheduledTaskStatus,
  triggerProjectScheduledTaskRun,
} from "@humanthread/db";
import { loopApiError } from "@/lib/orchestration/loop-definition-contracts";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

type Context = { params: Promise<{ projectId: string; scheduledTaskId: string }> };

const commandBodySchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("enable"),
    commandId: z.string().min(1).max(128),
    expectedVersion: z.number().int().positive(),
  }).strict(),
  z.object({
    command: z.literal("deactivate"),
    commandId: z.string().min(1).max(128),
    expectedVersion: z.number().int().positive(),
  }).strict(),
  z.object({
    command: z.literal("disable"),
    commandId: z.string().min(1).max(128),
    expectedVersion: z.number().int().positive(),
  }).strict(),
  z.object({
    command: z.literal("restore"),
    commandId: z.string().min(1).max(128),
    expectedVersion: z.number().int().positive(),
  }).strict(),
  z.object({
    command: z.literal("run_now"),
    commandId: z.string().min(1).max(128),
  }).strict(),
]);

function commandErrorResponse(error: unknown): NextResponse {
  const response = loopApiError(error);
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  if (code === "policy_denied" || code === "run_in_progress") {
    return NextResponse.json({
      ok: false,
      code,
      error: error instanceof Error ? error.message : "Loop request failed",
    }, { status: 409 });
  }
  return NextResponse.json(response.body, { status: response.status });
}

export async function POST(request: Request, context: Context) {
  try {
    const [{ projectId, scheduledTaskId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = commandBodySchema.parse(await request.json());

    if (body.command === "run_now") {
      const result = await triggerProjectScheduledTaskRun({
        actorUserId: actor.userId,
        projectId,
        scheduledTaskId,
        commandId: body.commandId,
        triggerSource: "manual",
      });
      return NextResponse.json({ ok: true, result }, { status: 201 });
    }

    const result = await changeProjectScheduledTaskStatus({
      actorUserId: actor.userId,
      projectId,
      scheduledTaskId,
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
      command: body.command,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return commandErrorResponse(error);
  }
}
