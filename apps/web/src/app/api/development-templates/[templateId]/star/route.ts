import { toggleDevelopmentTemplateMarketStar } from "@humanthread/db";
import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { developmentTemplateApiError } from "../../../../../lib/templates/development-template-contracts";

export async function POST(request: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    const [{ templateId }, actor] = await Promise.all([context.params, resolveWorkbenchApiActor(request)]);
    const result = await toggleDevelopmentTemplateMarketStar({ templateId, userId: actor.userId });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
