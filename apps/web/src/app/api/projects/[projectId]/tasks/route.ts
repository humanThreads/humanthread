import { NextResponse } from "next/server";
import { createTask } from "@/lib/orchestration/project-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { projectId } = await context.params;
    const actor = await resolveWorkbenchApiActor(request);
    const splitList = (value: unknown) => typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
    const result = await createTask({
      projectId,
      actor: { type: "user", id: actor.userId },
      commandId: typeof body.commandId === "string" ? body.commandId : crypto.randomUUID(),
      correlationId: `project:${projectId}`,
      payload: {
        title: typeof body.title === "string" ? body.title : "",
        objective: typeof body.objective === "string" ? body.objective : "",
        ...(typeof body.milestoneId === "string" && body.milestoneId ? { milestoneId: body.milestoneId } : {}),
        ...(typeof body.preferredAgentProfileId === "string" && body.preferredAgentProfileId ? { preferredAgentProfileId: body.preferredAgentProfileId } : {}),
        allowedPaths: splitList(body.allowedPaths),
        requiredChecks: splitList(body.requiredChecks),
        maxAttempts: Number(body.maxAttempts),
        timeoutMinutes: Number(body.timeoutMinutes),
      },
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task dispatch failed";
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const status = message === "Workbench API authentication required" ? 401 : message.includes("access denied") ? 403 : code === "version_conflict" ? 409 : code === "validation_failed" || message.includes("validation_failed") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
