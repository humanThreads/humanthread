import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { compareDevelopmentTemplateVersions } from "@/lib/templates/development-template-commands";
import { compareDevelopmentTemplateQuerySchema, developmentTemplateApiError } from "../../../../../lib/templates/development-template-contracts";

export async function GET(request: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    const [{ templateId }, actor] = await Promise.all([context.params, resolveWorkbenchApiActor(request)]);
    const url = new URL(request.url);
    const input = compareDevelopmentTemplateQuerySchema.parse({
      spaceId: url.searchParams.get("spaceId") ?? "",
      fromVersion: url.searchParams.get("fromVersion"),
      toVersion: url.searchParams.get("toVersion"),
    });
    const result = await compareDevelopmentTemplateVersions({ actorUserId: actor.userId, templateId, ...input });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
