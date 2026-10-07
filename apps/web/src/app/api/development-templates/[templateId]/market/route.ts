import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { setDevelopmentTemplateMarketVisibility } from "@/lib/templates/development-template-commands";
import { developmentTemplateApiError, marketVisibilityRequestSchema } from "../../../../../lib/templates/development-template-contracts";

export async function PATCH(request: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    const [{ templateId }, actor, body] = await Promise.all([context.params, resolveWorkbenchApiActor(request), request.json()]);
    const input = marketVisibilityRequestSchema.parse(body);
    const result = await setDevelopmentTemplateMarketVisibility({ actorUserId: actor.userId, templateId, ...input });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
