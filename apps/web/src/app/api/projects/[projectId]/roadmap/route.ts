import { NextResponse } from "next/server";
import { z } from "zod";
import { commandProjectRoadmap, type ProjectRoadmapAction } from "@/lib/orchestration/project-roadmap-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const id = z.string().trim().min(1);
const version = z.number().int().positive();
const optionalDate = z.string().trim().min(1).nullable().optional();
const optionalText = z.string().optional();
const roadmapActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage.create"), name: id, status: optionalText, startAt: optionalDate, targetAt: optionalDate }).strict(),
  z.object({ type: z.literal("stage.update"), stageId: id, expectedNodeVersion: version, name: optionalText, status: optionalText, startAt: optionalDate, targetAt: optionalDate }).strict(),
  z.object({ type: z.literal("stage.reorder"), stageIds: z.array(id) }).strict(),
  z.object({ type: z.literal("stage.delete"), stageId: id, expectedNodeVersion: version }).strict(),
  z.object({ type: z.literal("milestone.create"), stageId: id, name: id, status: optionalText, targetAt: optionalDate }).strict(),
  z.object({ type: z.literal("milestone.update"), milestoneId: id, expectedNodeVersion: version, name: optionalText, status: optionalText, targetAt: optionalDate, riskSummary: z.string().nullable().optional() }).strict(),
  z.object({ type: z.literal("milestone.reorder"), stageId: id, milestoneIds: z.array(id) }).strict(),
  z.object({ type: z.literal("milestone.delete"), milestoneId: id, expectedNodeVersion: version }).strict(),
  z.object({ type: z.literal("task.move"), taskId: id, milestoneId: id.nullable(), expectedTaskVersion: version }).strict(),
]);

function errorResponse(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  const status = message === "Workbench API authentication required" ? 401 : message.includes("access denied") ? 403 : code === "not_found" ? 404 : code === "version_conflict" ? 409 : code === "validation_failed" ? 400 : 500;
  if (status === 500) return NextResponse.json({ ok: false, code: "internal_error", error: "Project roadmap update failed" }, { status });
  return NextResponse.json({ ok: false, code: code || (status === 403 ? "authorization_denied" : "invalid_request"), error: message || "Project roadmap update failed" }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = roadmapActionSchema.safeParse(body.action);
    if (typeof body.commandId !== "string" || typeof body.expectedVersion !== "number" || !action.success) return NextResponse.json({ ok: false, code: "validation_failed", error: "Invalid Project roadmap command" }, { status: 400 });
    const { projectId } = await context.params;
    const actor = await resolveWorkbenchApiActor(request);
    const result = await commandProjectRoadmap({ projectId, actor: { type: "user", id: actor.userId }, commandId: body.commandId, correlationId: typeof body.correlationId === "string" ? body.correlationId : `project:${projectId}`, expectedVersion: body.expectedVersion, action: action.data as ProjectRoadmapAction });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
