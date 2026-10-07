import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { submitProjectPlan } from "@/lib/orchestration/project-commands";

function errorStatus(error: unknown): number {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Workbench API authentication required") return 401;
  if (message.includes("access denied")) return 403;
  if (code === "not_found") return 404;
  if (["version_conflict", "policy_denied"].includes(code)) return 409;
  if (code === "validation_failed" || message.includes("validation_failed")) return 400;
  return 500;
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { projectId } = await context.params;
    if (typeof body.commandId !== "string" || typeof body.expectedVersion !== "number" || typeof body.objective !== "string" || !Array.isArray(body.stages)) {
      return NextResponse.json({ ok: false, error: "Invalid project plan" }, { status: 400 });
    }
    const actor = await resolveWorkbenchApiActor(request);
    const result = await submitProjectPlan({
      projectId,
      actor: { type: "user", id: actor.userId },
      commandId: body.commandId,
      correlationId: typeof body.correlationId === "string" ? body.correlationId : `project:${projectId}`,
      expectedVersion: body.expectedVersion,
      payload: { objective: body.objective, stages: body.stages as Array<{ key: string; name: string; milestones: Array<{ name: string }> }> },
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Project plan failed";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(error) });
  }
}
