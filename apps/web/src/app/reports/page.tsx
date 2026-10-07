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
import {
  getDeliveryHealthReport,
  normalizeDeliveryHealthRange,
} from "../../lib/workbench/workbench-delivery-health-report";
import { DeliveryHealthReport } from "../components/delivery-health-report";
import { ReportFilters } from "../components/report-filters";
import { WorkbenchShell } from "../components/workbench-shell";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<WorkbenchSearchParams> } = {}) {
  const raw = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/reports");
  const filters = await getWorkbenchCompanyFilters({ userId: session.context.userId });
  const selected = getWorkbenchSelectedSpaceFilter({
    filters,
    searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM),
    cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value,
  });
  const range = normalizeDeliveryHealthRange(getSingleWorkbenchSearchParam(raw, "range"));
  const projectId = getSingleWorkbenchSearchParam(raw, "project");
  const report = await getDeliveryHealthReport({
    userId: session.context.userId,
    spaceKey: selected.key,
    ...(selected.spaceId ? { spaceId: selected.spaceId } : {}),
    ...(selected.companyId ? { companyId: selected.companyId } : {}),
    ...(selected.ownerType ? { ownerType: selected.ownerType } : {}),
    ...(projectId ? { projectId } : {}),
    range,
  });
  const selectedProjectId = report.availableProjects.some((project) => project.id === projectId) ? projectId : undefined;
  return <WorkbenchShell activeKey="reports" title="交付健康" subtitle="查看交付节奏、阻塞、人工等待与自动化结果。" loginEmail={session.loginEmail} spaceLabel={selected.label} selectedSpaceKey={selected.key} spaceFilters={filters} {...getWorkbenchShellLoginProps(session)}>
    <ReportFilters spaces={filters} projects={report.availableProjects} selectedSpaceKey={selected.key} selectedProjectId={selectedProjectId} range={range} />
    <DeliveryHealthReport report={report} selectedSpaceKey={selected.key} {...(selectedProjectId ? { selectedProjectId } : {})} />
  </WorkbenchShell>;
}
