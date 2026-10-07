import { NextResponse } from "next/server";
import { z } from "zod";

import { archiveProject, completeProject } from "@/lib/orchestration/project-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const commandId = z.string().trim().min(1).max(128);
const expectedVersion = z.number().int().positive();

const lifecycleSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("complete"),
    commandId,
    expectedVersion,
    // Forcing past open milestones is deliberate: the UI requires a written
    // reason, and that reason is recorded on the project.completed event.
    force: z.boolean().optional(),
    reason: z.string().trim().max(2_000).optional(),
  }).strict(),
  z.object({
    command: z.literal("archive"),
    commandId,
    expectedVersion,
  }).strict(),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  let actor: { userId: string };
  try {
    actor = await resolveWorkbenchApiActor(request);
  } catch {
    return NextResponse.json({ ok: false, code: "authentication_required", error: "Workbench API authentication required" }, { status: 401 });
  }

  const { projectId } = await context.params;
  let body: z.infer<typeof lifecycleSchema>;
  try {
    body = lifecycleSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, code: "validation_failed", error: "Invalid project lifecycle command" }, { status: 400 });
  }

  const base = {
    projectId,
    actor: { type: "user" as const, id: actor.userId },
    commandId: body.commandId,
    correlationId: `project:${projectId}`,
    expectedVersion: body.expectedVersion,
  };
  try {
    const result = body.command === "complete"
      ? await completeProject({
          ...base,
          ...(body.force === undefined ? {} : { force: body.force }),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        })
      : await archiveProject(base);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "Project lifecycle change failed";
    const status = code === "not_found"
      ? 404
      : code === "version_conflict"
        ? 409
        : /access denied|authorization_denied/iu.test(message)
          ? 403
          : code === "validation_failed"
            ? 400
            : 500;
    if (status === 500) {
      return NextResponse.json({ ok: false, code: "internal_error", error: "Project lifecycle change failed" }, { status });
    }
    return NextResponse.json({ ok: false, code: code || "invalid_request", error: message }, { status });
  }
}
