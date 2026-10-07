import { listDevelopmentTemplatesForSpace, listPublicDevelopmentTemplates, listStarredDevelopmentTemplateIds } from "@humanthread/db";
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
import { DevelopmentTemplateLibrary } from "../components/templates/development-template-library";
import { WorkbenchShell } from "../components/workbench-shell";
import { Callout } from "../components/workbench-ui";

export const dynamic = "force-dynamic";
export const DEVELOPMENT_TEMPLATE_CATEGORY_SEARCH_PARAM = "category";
export const DEVELOPMENT_TEMPLATE_CATEGORY_TABS = [] as const;

export const TEMPLATES_PAGE_SECTION_TITLES = [
  "Loop 市场",
  "我的模版",
] as const;

export default async function TemplatesPage({ searchParams }: { searchParams?: Promise<WorkbenchSearchParams> } = {}) {
  const raw = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/templates");
  const { context, loginEmail } = session;
  const companyFilters = await getWorkbenchCompanyFilters({
    userId: context.userId,
  });
  const selected = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });
  const selectedSpace = selected.spaceId ? selected : companyFilters.find((filter) => filter.spaceId);
  let developmentTemplates: Awaited<ReturnType<typeof listDevelopmentTemplatesForSpace>> = [];
  let marketTemplates: Awaited<ReturnType<typeof listPublicDevelopmentTemplates>> = [];
  let starredTemplateIds: string[] = [];
  let developmentError: string | null = null;
  if (!selectedSpace?.spaceId) developmentError = "请选择一个 Space 后查看开发模板。";
  else {
    try {
      [developmentTemplates, marketTemplates] = await Promise.all([listDevelopmentTemplatesForSpace({
        spaceId: selectedSpace.spaceId,
        statuses: ["draft", "published", "deprecated"],
      }), listPublicDevelopmentTemplates({ sort: "published", actorUserId: session.context.userId })]);
      starredTemplateIds = await listStarredDevelopmentTemplateIds({ templateIds: marketTemplates.map((template) => template.id), userId: session.context.userId });
    } catch {
      developmentError = "开发模板暂时无法加载，请稍后刷新页面。";
    }
  }

  return (
    <WorkbenchShell
      activeKey="templates"
      title="模板库"
      subtitle="把需求确认、Agent 派单和文档沉淀这些高频执行套路固定下来，降低每次从零组织上下文的成本。"
      loginEmail={loginEmail}
      selectedSpaceKey={selected.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      {developmentError || !selectedSpace?.spaceId ? <Callout title="Loop 模板不可用">{developmentError ?? "请选择一个 Space 后查看 Loop 模板。"}</Callout> : <DevelopmentTemplateLibrary spaceId={selectedSpace.spaceId} spaceKey={selectedSpace.key} templates={developmentTemplates} marketTemplates={marketTemplates} starredTemplateIds={starredTemplateIds} currentUserId={session.context.userId} spaceRole={selectedSpace.role} />}
    </WorkbenchShell>
  );
}
