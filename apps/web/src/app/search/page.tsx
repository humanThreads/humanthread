import Link from "next/link";
import {
  buildCompanySpaceId,
  buildPersonalSpaceId,
} from "@humanthread/db";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { listAccessibleProjectDocuments } from "../../lib/workbench/workbench-documents";
import { getWorkbenchOverview } from "../../lib/workbench/workbench-overview";
import { getWorkbenchProjects } from "../../lib/workbench/workbench-projects";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  buildWorkbenchSpaceHref,
  getPreferredWorkbenchSpaceKey,
  getSingleWorkbenchSearchParam,
  selectWorkbenchProjectSpaceFilter,
  WORKBENCH_SPACE_COOKIE,
  type WorkbenchSearchParams,
} from "../../lib/workbench/workbench-space-filters";
import {
  filterWorkbenchSearchResults,
  searchWorkbenchTasks,
} from "../../lib/workbench/workbench-search";
import { setWorkbenchSpaceAction } from "../workbench/actions";
import { WorkbenchShell } from "../components/workbench-shell";
import { formatWorkbenchDateTime } from "../components/workbench-sections";
import { EmptyState, KpiCard, Panel, StatusPill, WorkbenchButton } from "../components/workbench-ui";

export const dynamic = "force-dynamic";

export const SEARCH_PAGE_SECTION_TITLES = [
  "搜索结果",
  "项目",
  "文档",
  "任务",
  "成员",
] as const;

interface SearchPageProps {
  searchParams?: Promise<WorkbenchSearchParams>;
}

export default async function SearchPage({
  searchParams,
}: SearchPageProps = {}) {
  const resolvedSearchParams = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/search");
  const { context, loginEmail } = session;
  const query = getSingleWorkbenchSearchParam(resolvedSearchParams, "q") ?? "";
  const companyFilters = await getWorkbenchCompanyFilters({
    userId: context.userId,
  });
  const selectedFilter = selectWorkbenchProjectSpaceFilter(
    companyFilters,
    getPreferredWorkbenchSpaceKey({
      searchParamValue: getSingleWorkbenchSearchParam(
        resolvedSearchParams,
        PROJECT_SPACE_SEARCH_PARAM,
      ),
      cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
    }),
  );
  const [projects, overview] = await Promise.all([
    getWorkbenchProjects({
      userId: context.userId,
      ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
      ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
    }),
    getWorkbenchOverview({
      teamId: context.teamId,
      userId: context.userId,
      ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
      ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
    }),
  ]);
  const [tasks, documents] = await Promise.all([
    searchWorkbenchTasks({
      userId: context.userId,
      query,
      ...(selectedFilter.ownerType === "personal"
        ? { spaceId: buildPersonalSpaceId(context.userId) }
        : selectedFilter.companyId
          ? { spaceId: buildCompanySpaceId(selectedFilter.companyId) }
          : {}),
    }),
    listAccessibleProjectDocuments({
      userId: context.userId,
      ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
      ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
    }),
  ]);

  const searchResults = filterWorkbenchSearchResults({
    query,
    projects,
    documents,
    tasks,
    members: overview.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      status: member.user.status,
      lastSeenAt: member.user.lastSeenAt,
    })),
  });

  return (
    <WorkbenchShell
      activeKey="tasks"
      title="搜索"
      subtitle="在项目、文档、任务和成员之间快速查找。"
      loginEmail={loginEmail}
      {...getWorkbenchShellLoginProps(session)}
      actions={<WorkbenchButton href="/documents">文档中心</WorkbenchButton>}
    >
      <div className="grid gap-5">
        <Panel
          title="搜索条件"
          action={<StatusPill tone="blue">{selectedFilter.label}</StatusPill>}
        >
          <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid gap-3">
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="搜索任务、项目、文档、成员"
                className="h-11 rounded-md border border-[#d0d7de] bg-white px-3 text-sm outline-none placeholder:text-[#8c959f] focus:border-[#0969da]"
              />
              <input type="hidden" name={PROJECT_SPACE_SEARCH_PARAM} value={selectedFilter.key} />
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <button
                type="submit"
                className="h-11 rounded-md border border-[#1f883d] bg-[#1f883d] px-4 text-sm font-semibold text-white hover:bg-[#1a7f37]"
              >
                搜索
              </button>
              <WorkbenchButton href="/search">重置</WorkbenchButton>
            </div>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {companyFilters.map((filter) => (
              <form key={filter.key} action={setWorkbenchSpaceAction}>
                <input type="hidden" name="spaceKey" value={filter.key} />
                <button
                  type="submit"
                  className={
                    filter.key === selectedFilter.key
                      ? "rounded-md border border-[#0969da] bg-[#ddf4ff] px-3 py-1.5 text-xs font-semibold text-[#0969da]"
                      : "rounded-md border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-semibold text-[#24292f] hover:bg-[#f3f4f6]"
                  }
                >
                  {filter.label}
                </button>
              </form>
            ))}
            <noscript>
              {companyFilters.map((filter) => (
                <Link key={filter.key} href={buildWorkbenchSpaceHref("/search", filter)}>
                  {filter.label}
                </Link>
              ))}
            </noscript>
          </div>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="项目" value={searchResults.projects.length} caption="匹配结果" />
          <KpiCard label="文档" value={searchResults.documents.length} caption="Markdown" />
          <KpiCard label="任务" value={searchResults.tasks.length} caption="最近任务" />
          <KpiCard label="成员" value={searchResults.members.length} caption="团队成员" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
          <div className="grid content-start gap-5">
            <Panel title="项目">
              <div className="divide-y divide-[#d8dee4]">
                {searchResults.projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="block p-4 hover:bg-[#f6f8fa]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[#0969da]">
                          {project.name}
                        </div>
                        <div className="mt-1 text-xs text-[#57606a]">
                          {project.description ?? "暂无项目说明"}
                        </div>
                      </div>
                      <div className="text-xs text-[#57606a]">
                        {formatWorkbenchDateTime(project.updatedAt)}
                      </div>
                    </div>
                  </Link>
                ))}
                {searchResults.projects.length === 0 ? (
                  <EmptyState title="没有匹配项目" description="调整搜索词后再试。" />
                ) : null}
              </div>
            </Panel>

            <Panel title="文档">
              <div className="divide-y divide-[#d8dee4]">
                {searchResults.documents.map((document) => (
                  <Link
                    key={document.id}
                    href={`/projects/${document.projectId}/documents/${document.id}`}
                    className="block p-4 hover:bg-[#f6f8fa]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[#0969da]">
                          {document.title}
                        </div>
                        <div className="mt-1 text-xs text-[#57606a]">
                          {document.projectName} · {document.path}
                        </div>
                      </div>
                      <div className="grid justify-items-end gap-2">
                        <StatusPill>v{document.version}</StatusPill>
                        <div className="text-xs text-[#57606a]">
                          {formatWorkbenchDateTime(document.updatedAt)}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {searchResults.documents.length === 0 ? (
                  <EmptyState title="没有匹配文档" description="试试文档标题或路径关键词。" />
                ) : null}
              </div>
            </Panel>
          </div>

          <div className="grid content-start gap-5">
            <Panel title="任务">
              <div className="divide-y divide-[#d8dee4]">
                {searchResults.tasks.map((task) => (
                  <Link key={task.id} href={task.href} className="block p-4 hover:bg-[#f6f8fa]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[#0969da]">
                          {task.title}
                        </div>
                        <div className="mt-1 text-xs text-[#57606a]">
                          {task.projectName} · {task.assigneeName ?? "未指派"}
                        </div>
                      </div>
                      <StatusPill tone="blue">{task.status}</StatusPill>
                    </div>
                  </Link>
                ))}
                {searchResults.tasks.length === 0 ? (
                  <EmptyState title="没有匹配任务" description="试试任务标题或正文关键词。" />
                ) : null}
              </div>
            </Panel>

            <Panel title="成员">
              <div className="divide-y divide-[#d8dee4]">
                {searchResults.members.map((member) => (
                  <div key={member.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[#24292f]">
                          {member.name}
                        </div>
                        <div className="mt-1 text-xs text-[#57606a]">
                          {member.email ?? "未绑定邮箱"}
                        </div>
                      </div>
                      <StatusPill>{member.status}</StatusPill>
                    </div>
                  </div>
                ))}
                {searchResults.members.length === 0 ? (
                  <EmptyState title="没有匹配成员" description="试试姓名或邮箱关键词。" />
                ) : null}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </WorkbenchShell>
  );
}
