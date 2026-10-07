import Link from "next/link";
import { GitBranch, Layers3, PlayCircle } from "lucide-react";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  WORKBENCH_SPACE_COOKIE,
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  type WorkbenchSearchParams,
} from "../../lib/workbench/workbench-space-filters";
import { listLoopDefinitionsForUser } from "../../lib/orchestration/loop-product-read-model";
import { WorkbenchShell } from "../components/workbench-shell";
import { Callout, EmptyState, StatusPill } from "../components/workbench-ui";
import { LoopCreateButton } from "../components/loops/loop-library";

export const dynamic = "force-dynamic";
export const LOOP_LIBRARY_PAGE_TITLE = "Loop 中心";
export const LOOP_LIBRARY_ACTION_LABEL = "编辑 Loop";
export const LOOP_SCOPE_SEARCH_PARAM = "scope";

export function parseRequestedLoopScope(value: string | undefined): "task" | "project" | null {
  return value === "task" || value === "project" ? value : null;
}

type LoopSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  draftRevision: number | null;
  latestVersion: number | null;
  scope: "task" | "project";
  origin: "space" | "platform";
};

type LoopDefinitionRecord = {
  id: string;
  [key: string]: unknown;
};

type LoopDefinitionLoadResult =
  | { ok: true; definitions: LoopDefinitionRecord[] }
  | { ok: false };

export async function loadLoopDefinitionsForSpaces({
  userId,
  spaceIds,
  scope = "task",
  listDefinitions = listLoopDefinitionsForUser,
}: {
  userId: string;
  spaceIds: string[];
  scope?: "task" | "project";
  listDefinitions?: (input: { userId: string; spaceId: string }) => Promise<LoopDefinitionRecord[]>;
}): Promise<LoopDefinitionLoadResult> {
  try {
    const definitionGroups = await Promise.all(spaceIds.map((spaceId) => (
      listDefinitions({ userId, spaceId })
    )));
    return {
      ok: true,
      definitions: dedupeDefinitions(definitionGroups.flat()).filter((definition) => (
        (definition.scope === "project" ? "project" : "task") === scope
      )),
    };
  } catch {
    return { ok: false };
  }
}

export default async function LoopsPage({
  searchParams,
}: { searchParams?: Promise<WorkbenchSearchParams> } = {}) {
  const raw = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/loops");
  const filters = await getWorkbenchCompanyFilters({ userId: session.context.userId });
  const selected = getWorkbenchSelectedSpaceFilter({
    filters,
    searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });
  const scopedFilters = selected.spaceId
    ? [selected]
    : filters.filter((filter) => Boolean(filter.spaceId));
  const scopeParam = getSingleWorkbenchSearchParam(raw, LOOP_SCOPE_SEARCH_PARAM);
  const requestedScope = parseRequestedLoopScope(scopeParam);
  let scope: "task" | "project" = requestedScope ?? "task";
  let loadResult = await loadLoopDefinitionsForSpaces({
    userId: session.context.userId,
    spaceIds: scopedFilters.map((filter) => filter.spaceId as string),
    scope,
  });
  // Platform projects may be the only available definitions in a Space. Keep
  // the default entry useful by showing them without requiring a hidden tab
  // switch; an explicit ?scope=task still preserves the requested filter.
  if (!requestedScope && loadResult.ok && loadResult.definitions.length === 0) {
    const projectResult = await loadLoopDefinitionsForSpaces({
      userId: session.context.userId,
      spaceIds: scopedFilters.map((filter) => filter.spaceId as string),
      scope: "project",
    });
    if (projectResult.ok && projectResult.definitions.length > 0) {
      scope = "project";
      loadResult = projectResult;
    }
  }
  const definitions = loadResult.ok ? loadResult.definitions.map(toLoopSummary) : [];

  return (
    <WorkbenchShell
      activeKey="loops"
      title={LOOP_LIBRARY_PAGE_TITLE}
      subtitle="配置可发布、可绑定项目的执行图；人工确认是可选节点，自动化授权仍由平台策略约束。"
      loginEmail={session.loginEmail}
      selectedSpaceKey={selected.key}
      spaceFilters={filters}
      actions={loadResult.ok ? <div className="flex flex-wrap items-center gap-2">
          <Link href="/loop-runs" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#d0d7de] bg-white px-3 text-xs font-semibold text-[#24292f] hover:bg-[#f6f8fa]">
            <PlayCircle aria-hidden="true" className="h-3.5 w-3.5" />
            运行工作区
          </Link>
          <LoopCreateButton
            spaces={filters.flatMap((filter) => filter.spaceId ? [{ id: filter.spaceId, label: filter.label }] : [])}
            {...(selected.spaceId ? { defaultSpaceId: selected.spaceId } : {})}
          />
        </div> : undefined}
      {...getWorkbenchShellLoginProps(session)}
    >
      <section aria-label="Loop 定义列表" className="mx-auto w-full max-w-6xl">
        <div className="mb-3 flex items-center justify-between border-b border-[#d0d7de] pb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#24292f]">
            <Layers3 aria-hidden="true" className="h-4 w-4 text-[#57606a]" />
            Loop 定义
          </div>
          <span className="text-xs text-[#6e7781]">
            {loadResult.ok ? `${definitions.length} 个 Loop` : "暂不可用"}
          </span>
        </div>
        <nav aria-label="Loop 级别" className="mb-3 flex gap-1" role="tablist">
          {(["task", "project"] as const).map((candidate) => (
            <Link
              key={candidate}
              href={`/loops?${LOOP_SCOPE_SEARCH_PARAM}=${candidate}`}
              role="tab"
              aria-selected={scope === candidate}
              className={scope === candidate
                ? "rounded-md bg-[#1f883d] px-3 py-1.5 text-xs font-semibold text-white"
                : "rounded-md border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-semibold text-[#24292f] hover:bg-[#f6f8fa]"}
            >
              {candidate === "task" ? "任务级" : "项目级"}
            </Link>
          ))}
        </nav>
        {!loadResult.ok ? (
          <Callout title="Loop 数据暂不可用">
            Loop 存储正在初始化，请稍后刷新页面。
          </Callout>
        ) : definitions.length === 0 ? (
          <EmptyState
            title="当前 Space 还没有 Loop"
            description="Loop 定义创建后会在这里管理草稿、当前激活状态和项目绑定。"
          />
        ) : (
          <div className="divide-y divide-[#d0d7de] border-y border-[#d0d7de] bg-white">
            {definitions.map((definition) => (
              <article key={definition.id} className="grid gap-3 px-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <GitBranch aria-hidden="true" className="h-4 w-4 shrink-0 text-[#57606a]" />
                    <h2 className="truncate text-sm font-semibold text-[#24292f]">{definition.name}</h2>
                    <StatusPill tone={definition.latestVersion === null ? "warning" : "success"}>
                      {definition.latestVersion === null ? "仅草稿" : "已激活"}
                    </StatusPill>
                    <StatusPill>{definition.scope === "project" ? "项目级" : "任务级"}</StatusPill>
                    {definition.origin === "platform" ? <StatusPill>平台内置</StatusPill> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#57606a]">
                    {definition.description ?? "未填写说明"}
                  </p>
                  <div className="mt-2 flex gap-4 text-[11px] text-[#6e7781]">
                    <span>状态 {definition.status}</span>
                    {definition.draftRevision === null ? null : <span>草稿修订 {definition.draftRevision}</span>}
                  </div>
                </div>
                <Link
                  href={`/loops/${encodeURIComponent(definition.id)}`}
                  className="inline-flex min-h-8 items-center justify-center rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 text-xs font-semibold text-[#24292f] hover:bg-[#f3f4f6]"
                >
                  {definition.origin === "platform" ? "查看 Loop" : LOOP_LIBRARY_ACTION_LABEL}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </WorkbenchShell>
  );
}

function dedupeDefinitions(definitions: LoopDefinitionRecord[]) {
  return [...new Map(definitions.map((definition) => [definition.id, definition])).values()];
}

function toLoopSummary(value: { id: string; [key: string]: unknown }): LoopSummary {
  const latest = value.latestPublishedVersion;
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : "未命名 Loop",
    description: typeof value.description === "string" ? value.description : null,
    status: typeof value.status === "string" ? value.status : "draft",
    draftRevision: typeof value.draftRevision === "number" ? value.draftRevision : null,
    latestVersion: latest && typeof latest === "object" && typeof Reflect.get(latest, "versionNumber") === "number"
      ? Reflect.get(latest, "versionNumber") as number
      : null,
    scope: value.scope === "project" ? "project" : "task",
    origin: value.origin === "platform" ? "platform" : "space",
  };
}
