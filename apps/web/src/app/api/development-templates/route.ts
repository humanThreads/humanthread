import { assertCanReadProject, assertCanReadSpace, listDevelopmentTemplatesForSpace, prisma } from "@humanthread/db";
import { loopAuthoringGraphSchema } from "@humanthread/orchestration-core";
import { NextResponse } from "next/server";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { createDevelopmentTemplateDraft } from "@/lib/templates/development-template-commands";
import {
  createDevelopmentTemplateRequestSchema,
  developmentTemplateApiError,
  developmentTemplateListQuerySchema,
} from "../../../lib/templates/development-template-contracts";

function enabled() {
  if (process.env.HUMANTHREAD_DEVELOPMENT_MODES !== "true") {
    throw Object.assign(new Error("Development templates are unavailable"), { code: "not_found" });
  }
}

export async function GET(request: Request) {
  try {
    enabled();
    const actor = await resolveWorkbenchApiActor(request);
    const query = developmentTemplateListQuerySchema.parse({
      spaceId: new URL(request.url).searchParams.get("spaceId") ?? "",
      ...(new URL(request.url).searchParams.get("projectId") ? { projectId: new URL(request.url).searchParams.get("projectId") } : {}),
    });
    const spaceId = query.spaceId;
    await assertCanReadSpace({ userId: actor.userId, spaceId });
    if (query.projectId) await assertCanReadProject({ userId: actor.userId, projectId: query.projectId });
    const [templates, agentProfiles, persistedBindings] = await Promise.all([
      listDevelopmentTemplatesForSpace({ spaceId, statuses: ["draft", "published"] }),
      prisma.agentProfile.findMany({
        where: { spaceId, status: "active" },
        select: { id: true, name: true, provider: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      query.projectId && prisma.projectLoopBinding?.findMany
        ? prisma.projectLoopBinding.findMany({ where: { projectId: query.projectId, project: { spaceId } }, select: { activeVersionId: true } })
        : Promise.resolve([]),
    ]);
    const loopIds = [...new Set([
      ...templates.flatMap((template) => [
        template.developmentLoopVersionId,
        template.releaseLoopVersionId,
        ...templateLoopGroupVersionIds(template.loopGroupConfig),
      ]),
      ...persistedBindings.flatMap((binding) => [binding.activeVersionId]),
    ].filter((id): id is string => Boolean(id)))];
    const loopVersions = loopIds.length ? await prisma.loopVersion.findMany({
      where: {
        id: { in: loopIds },
        status: "published",
        loopDefinition: {
        scope: { in: ["task", "project"] },
          OR: [{ origin: "platform" }, { origin: "space", spaceId }],
        },
      },
      select: { id: true, versionNumber: true, status: true, graph: true, loopDefinition: { select: { id: true, name: true, scope: true, origin: true, spaceId: true } } },
    }) : [];
    const publishedLoopVersions = loopVersions.flatMap((version) => {
      const definition = version.loopDefinition;
      if (version.status !== "published" || definition?.scope !== "project" || (definition.origin !== "platform" && !(definition.origin === "space" && definition.spaceId === spaceId))) return [];
      const graph = loopAuthoringGraphSchema.safeParse(version.graph);
      return graph.success ? [{ ...version, graph: graph.data, definition, loopDefinition: definition }] : [];
    });
    return NextResponse.json({ ok: true, result: { templates, loopVersions: publishedLoopVersions, agentProfiles } });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

function templateLoopGroupVersionIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const presets = Array.isArray(record.presets) ? record.presets : [];
  return presets.flatMap((preset) => {
    if (!preset || typeof preset !== "object" || Array.isArray(preset)) return [];
    const item = preset as Record<string, unknown>;
    return [
      ...(Array.isArray(item.taskLoopIds) ? item.taskLoopIds : []),
      ...(Array.isArray(item.projectLoopIds) ? item.projectLoopIds : []),
    ].filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  });
}

export async function POST(request: Request) {
  try {
    enabled();
    const [actor, body] = await Promise.all([resolveWorkbenchApiActor(request), request.json()]);
    const input = createDevelopmentTemplateRequestSchema.parse(body);
    const result = await createDevelopmentTemplateDraft({ actorUserId: actor.userId, ...input });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const response = developmentTemplateApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
