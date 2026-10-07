import { listPublicDevelopmentTemplates, listStarredDevelopmentTemplateIds } from "@humanthread/db";
import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { developmentTemplateApiError, developmentTemplateMarketQuerySchema } from "../../../../lib/templates/development-template-contracts";

export async function GET(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const query = developmentTemplateMarketQuerySchema.parse({ sort: new URL(request.url).searchParams.get("sort") ?? undefined });
    const templates = await listPublicDevelopmentTemplates({ sort: query.sort, actorUserId: actor.userId });
    const starredTemplateIds = await listStarredDevelopmentTemplateIds({ templateIds: templates.map((template) => template.id), userId: actor.userId });
    return NextResponse.json({ ok: true, result: { templates, starredTemplateIds } });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
