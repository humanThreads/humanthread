import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { deleteDevelopmentTemplate } from "@/lib/templates/development-template-commands";
import { deleteDevelopmentTemplateRequestSchema, developmentTemplateApiError } from "../../../../../lib/templates/development-template-contracts";

export async function POST(request: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    const [{ templateId }, actor, body] = await Promise.all([context.params, resolveWorkbenchApiActor(request), request.json()]);
    const input = deleteDevelopmentTemplateRequestSchema.parse(body);
    const result = await deleteDevelopmentTemplate({ actorUserId: actor.userId, templateId, ...input });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
