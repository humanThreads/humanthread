import { loopAuthoringGraphSchema } from "@humanthread/orchestration-core";
import { notFound } from "next/navigation";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { readLoopDefinitionEditor } from "../../../lib/orchestration/loop-product-read-model";
import { LoopEditor } from "../../components/loops/loop-editor";
import { LoopDefinitionLifecycle } from "../../components/loops/loop-definition-lifecycle";
import { WorkbenchShell } from "../../components/workbench-shell";
import { Callout } from "../../components/workbench-ui";

export const dynamic = "force-dynamic";
export const LOOP_EDITOR_CONTENT_MODE = "workspace" as const;
export const LOOP_EDITOR_PAGE_TITLE = "Loop 图编辑器";
export const LOOP_EDITOR_SHOWS_LIFECYCLE = true;
export const LOOP_EDITOR_WORKSPACE_CLASS = "grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]";

/**
 * Resolve the graph shown by the editor. A definition can legitimately have
 * an empty/legacy draft while its active published version is still valid;
 * the active version is the canonical fallback for viewing in that case.
 */
export function resolveLoopEditorGraph(definition: {
  draftGraph: unknown;
  latestPublishedVersion?: unknown;
}) {
  const draft = loopAuthoringGraphSchema.safeParse(definition.draftGraph);
  if (draft.success) return draft;

  if (definition.latestPublishedVersion && typeof definition.latestPublishedVersion === "object" && !Array.isArray(definition.latestPublishedVersion)) {
    const published = loopAuthoringGraphSchema.safeParse(Reflect.get(definition.latestPublishedVersion, "graph"));
    if (published.success) return published;
  }

  return draft;
}

export default async function LoopEditorPage({
  params,
}: {
  params: Promise<{ loopDefinitionId: string }>;
}) {
  const { loopDefinitionId } = await params;
  const requestedPath = `/loops/${encodeURIComponent(loopDefinitionId)}`;
  const { session } = await requireWorkbenchSession(requestedPath);
  const [model, filters] = await Promise.all([
    readLoopDefinitionEditor({ userId: session.context.userId, loopDefinitionId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  if (!model) notFound();
  const graph = resolveLoopEditorGraph(model.definition);
  const definitionName = typeof model.definition.name === "string" ? model.definition.name : "未命名 Loop";
  const description = typeof model.definition.description === "string" ? model.definition.description : null;
  const selectedSpace = filters.find((filter) => filter.spaceId === model.definition.spaceId);

  return (
    <WorkbenchShell
      activeKey="loops"
      title={LOOP_EDITOR_PAGE_TITLE}
      subtitle={definitionName}
      contentMode={LOOP_EDITOR_CONTENT_MODE}
      loginEmail={session.loginEmail}
      {...(selectedSpace ? { selectedSpaceKey: selectedSpace.key } : {})}
      spaceFilters={filters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <div className={LOOP_EDITOR_WORKSPACE_CLASS}>
        {graph.success ? (
          <LoopEditor initial={{
            definition: {
              id: model.definition.id,
              name: definitionName,
              description,
              scope: model.definition.scope === "project" ? "project" : "task",
              origin: model.definition.origin === "platform" ? "platform" : "space",
              readOnly: model.definition.readOnly === true,
              activeVersionId: typeof model.definition.latestPublishedVersion === "object"
                && model.definition.latestPublishedVersion !== null
                && typeof Reflect.get(model.definition.latestPublishedVersion, "id") === "string"
                ? Reflect.get(model.definition.latestPublishedVersion, "id") as string
                : null,
            },
            graph: graph.data,
            draftRevision: model.draftRevision,
            versions: model.versions,
            subloopOptions: model.subloopOptions,
            platformCaps: model.platformCaps,
          }} />
        ) : (
          <div className="p-5">
            <Callout title="草稿图无法载入">
              当前草稿不符合受支持的 Loop Graph 结构，需要先通过 API 或数据修复恢复有效结构。
            </Callout>
          </div>
        )}
        <LoopDefinitionLifecycle
          definitionId={model.definition.id}
          draftRevision={model.draftRevision}
          origin={model.definition.origin === "platform" ? "platform" : "space"}
          status={typeof model.definition.status === "string" ? model.definition.status : "draft"}
          lifecycle={model.lifecycle}
        />
      </div>
    </WorkbenchShell>
  );
}
