import { prisma, readDevelopmentTemplate } from "@humanthread/db";
import { loopAuthoringGraphSchema } from "@humanthread/orchestration-core";
import { notFound } from "next/navigation";
import { DevelopmentTemplateEditor, type DevelopmentTemplateLoopVersion } from "../../../components/templates/development-template-editor";
import { projectLoopGraphToFlow } from "../../../components/loops/project-loop-flow";
import { WorkbenchShell } from "../../../components/workbench-shell";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  WORKBENCH_SPACE_COOKIE,
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  type WorkbenchSearchParams,
} from "../../../../lib/workbench/workbench-space-filters";

export const dynamic = "force-dynamic";
export const DEVELOPMENT_TEMPLATE_EDITOR_PAGE_TITLE = "开发模板编辑器";

export function developmentTemplateEditorPath(templateId: string) {
  return `/templates/development/${encodeURIComponent(templateId)}`;
}

export default async function DevelopmentTemplateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams?: Promise<WorkbenchSearchParams>;
}) {
  const [{ templateId }, raw] = await Promise.all([params, searchParams]);
  const { session, cookieStore } = await requireWorkbenchSession(developmentTemplateEditorPath(templateId));
  const [template, filters] = await Promise.all([
    readDevelopmentTemplate({ templateId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  if (!template || template.deletedAt) notFound();
  const selected = getWorkbenchSelectedSpaceFilter({
    filters,
    searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });
  const selectedSpace = selected.spaceId ? selected : filters.find((filter) => filter.spaceId);
  if (!selectedSpace?.spaceId || (template.origin === "space" && template.spaceId !== selectedSpace.spaceId)) notFound();
  const referencedVersionIds = [...new Set([
    template.developmentLoopVersionId,
    template.releaseLoopVersionId,
    ...templateLoopGroupVersionIds(template.loopGroupConfig),
  ].filter((id): id is string => Boolean(id)))];
  const [definitions, referencedVersions] = await Promise.all([
    prisma.loopDefinition.findMany({
      where: {
        scope: { in: ["task", "project"] },
        status: { not: "archived" },
        latestPublishedVersionId: { not: null },
        OR: [{ origin: "platform" }, { origin: "space", spaceId: selectedSpace.spaceId }],
      },
      include: { latestPublishedVersion: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    referencedVersionIds.length === 0 ? Promise.resolve([]) : prisma.loopVersion.findMany({
      where: {
        id: { in: referencedVersionIds },
        status: "published",
        loopDefinition: {
          is: {
            scope: { in: ["task", "project"] },
            status: { not: "archived" },
            OR: [{ origin: "platform" }, { origin: "space", spaceId: selectedSpace.spaceId }],
          },
        },
      },
      include: { loopDefinition: true },
      orderBy: [{ versionNumber: "desc" }, { id: "asc" }],
    }),
  ]);
  const loops = mergeDevelopmentTemplateLoopVersions({
    latestDefinitions: definitions,
    referencedVersions,
    spaceId: selectedSpace.spaceId,
  });

  const canManage = template.origin === "space" && (template.createdByUserId === session.context.userId || selectedSpace.role === "owner" || selectedSpace.role === "admin");
  return <WorkbenchShell activeKey="templates" title={DEVELOPMENT_TEMPLATE_EDITOR_PAGE_TITLE} subtitle={template.name} loginEmail={session.loginEmail} selectedSpaceKey={selectedSpace.key} spaceFilters={filters} {...getWorkbenchShellLoginProps(session)}><DevelopmentTemplateEditor template={template} loops={loops} spaceId={selectedSpace.spaceId} canManage={canManage} /></WorkbenchShell>;
}

function templateLoopGroupVersionIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidate = (value as Record<string, unknown>).presets;
  const presets: unknown[] = Array.isArray(candidate) ? candidate : [];
  return presets.flatMap((preset) => {
    if (!preset || typeof preset !== "object" || Array.isArray(preset)) return [];
    const item = preset as Record<string, unknown>;
    return [...(Array.isArray(item.taskLoopIds) ? item.taskLoopIds : []), ...(Array.isArray(item.projectLoopIds) ? item.projectLoopIds : [])].filter((id): id is string => typeof id === "string" && id.length > 0);
  });
}

export function mergeDevelopmentTemplateLoopVersions({
  latestDefinitions,
  referencedVersions,
  spaceId,
}: {
  latestDefinitions: readonly unknown[];
  referencedVersions: readonly unknown[];
  spaceId: string;
}): DevelopmentTemplateLoopVersion[] {
  const latest = latestDefinitions.flatMap((value) => normalizeLatestDefinition(value, spaceId));
  const referenced = referencedVersions.flatMap((value) => normalizeReferencedVersion(value, spaceId));
  return [...new Map([...latest, ...referenced].map((version) => [version.id, version])).values()];
}

function normalizeLatestDefinition(value: unknown, spaceId: string): DevelopmentTemplateLoopVersion[] {
  const definition = record(value);
  return definition ? normalizeLoopVersion(definition.latestPublishedVersion, definition, spaceId) : [];
}

function normalizeReferencedVersion(value: unknown, spaceId: string): DevelopmentTemplateLoopVersion[] {
  const version = record(value);
  const definition = version ? record(version.loopDefinition) : null;
  return version && definition ? normalizeLoopVersion(version, definition, spaceId) : [];
}

function normalizeLoopVersion(value: unknown, definition: Record<string, unknown>, spaceId: string): DevelopmentTemplateLoopVersion[] {
  const version = record(value);
  const authorized = (definition.scope === "task" || definition.scope === "project")
    && (definition.origin === "platform" || (definition.origin === "space" && definition.spaceId === spaceId));
  const graph = version ? loopAuthoringGraphSchema.safeParse(version.graph) : null;
  if (!authorized || !version || version.status !== "published" || typeof version.id !== "string" || !Number.isInteger(version.versionNumber) || !graph?.success || typeof definition.id !== "string" || typeof definition.name !== "string") return [];
  return [{
    id: version.id,
    versionNumber: version.versionNumber as number,
    status: "published",
    definition: {
      id: definition.id,
      name: definition.name,
      scope: definition.scope === "task" ? "task" : "project",
      origin: definition.origin === "platform" ? "platform" : "space",
      spaceId: typeof definition.spaceId === "string" ? definition.spaceId : null,
    },
    graph: { nodes: graph.data.nodes.map((node) => ({ key: node.key, label: node.label, type: node.type })) },
    flow: projectLoopGraphToFlow(graph.data),
  }];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
