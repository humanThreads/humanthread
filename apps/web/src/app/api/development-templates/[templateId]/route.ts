import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { updateDevelopmentTemplateDraft } from "@/lib/templates/development-template-commands";
import { developmentTemplateApiError, updateDevelopmentTemplateRequestSchema } from "../../../../lib/templates/development-template-contracts";

export async function PATCH(request: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    const [{ templateId }, actor, body] = await Promise.all([context.params, resolveWorkbenchApiActor(request), request.json()]);
    const input = updateDevelopmentTemplateRequestSchema.parse(body);
    const result = await updateDevelopmentTemplateDraft({
      actorUserId: actor.userId,
      templateId,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.projectConfigSchema === undefined ? {} : { projectConfigSchema: input.projectConfigSchema }),
      ...(input.taskFieldSchema === undefined ? {} : { taskFieldSchema: input.taskFieldSchema }),
      ...(input.developmentLoopVersionId === undefined ? {} : { developmentLoopVersionId: input.developmentLoopVersionId }),
      ...(input.releaseLoopVersionId === undefined ? {} : { releaseLoopVersionId: input.releaseLoopVersionId }),
      ...(input.triggerPolicy === undefined ? {} : { triggerPolicy: input.triggerPolicy }),
      ...(input.executionPolicy === undefined ? {} : { executionPolicy: input.executionPolicy }),
      ...(input.loopGroupConfig === undefined ? {} : { loopGroupConfig: input.loopGroupConfig }),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
