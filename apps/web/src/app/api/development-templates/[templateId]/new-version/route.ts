import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { createDevelopmentTemplateRevisionDraft } from "@/lib/templates/development-template-commands";
import { developmentTemplateApiError } from "../../../../../lib/templates/development-template-contracts";

export async function POST(request: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    const [{ templateId }, actor, body] = await Promise.all([context.params, resolveWorkbenchApiActor(request), request.json()]);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).commandId !== "string") {
      throw Object.assign(new Error("A command ID is required"), { code: "validation_failed" });
    }
    const result = await createDevelopmentTemplateRevisionDraft({
      actorUserId: actor.userId,
      templateId,
      commandId: (body as Record<string, unknown>).commandId as string,
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
