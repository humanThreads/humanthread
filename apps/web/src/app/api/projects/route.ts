import { NextResponse } from "next/server";
import { z } from "zod";
import { assertCanWriteSpace, prisma } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { createWorkbenchProject } from "@/lib/workbench/workbench-project-commands";
import { initializeProjectKnowledgeAfterCreate } from "@/lib/workbench/project-knowledge-bootstrap";

const optionalDate = z.string().datetime().transform((value) => new Date(value)).optional();
const createProjectSchema = z.object({
  spaceId: z.string().trim().min(1).max(96),
  name: z.string().trim().min(1).max(191),
  shortCode: z.string().trim().min(2).max(12).optional(),
  objective: z.string().trim().min(1).max(10000),
  managerUserId: z.string().trim().min(1).max(64),
  startAt: optionalDate,
  targetAt: optionalDate,
  developmentTemplateKey: z.string().trim().min(1).max(96).optional(),
  developmentTemplateVersion: z.number().int().positive().optional(),
  developmentTemplateConfig: z.unknown().optional(),
}).superRefine((value, context) => {
  const fields = [value.developmentTemplateKey, value.developmentTemplateVersion, value.developmentTemplateConfig];
  if (fields.some((field) => field !== undefined) && fields.some((field) => field === undefined)) {
    context.addIssue({ code: "custom", message: "Development template fields are required together", path: ["developmentTemplateKey"] });
  }
});

function projectErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, code: "validation_failed", error: "Invalid Project request", issues: error.issues }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Project creation failed";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "authorization_denied" || message.toLowerCase().includes("access denied")
      ? 403
      : code === "not_found"
        ? 404
        : code === "validation_failed"
          ? 400
          : 500;
  if (status === 500) {
    return NextResponse.json({ ok: false, code: "internal_error", error: "Project creation failed" }, { status });
  }
  return NextResponse.json({ ok: false, code: code || "request_failed", error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = createProjectSchema.parse(await request.json());
    const result = await createWorkbenchProject({
      userId: actor.userId,
      spaceId: body.spaceId,
      name: body.name,
      ...(body.shortCode ? { shortCode: body.shortCode } : {}),
      objective: body.objective,
      managerUserId: body.managerUserId,
      dependencies: {
        assertCanWriteSpace,
        db: prisma as never,
        initializeKnowledge: initializeProjectKnowledgeAfterCreate,
      },
      ...(body.startAt ? { startAt: body.startAt } : {}),
      ...(body.targetAt ? { targetAt: body.targetAt } : {}),
      ...(body.developmentTemplateKey ? {
        developmentTemplateKey: body.developmentTemplateKey,
        developmentTemplateVersion: body.developmentTemplateVersion!,
        developmentTemplateConfig: body.developmentTemplateConfig,
      } : {}),
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
