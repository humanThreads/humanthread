import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import { getAgentControlPlane } from "../../lib/orchestration/agent-read-model";
import { listWorkerPools } from "@humanthread/db";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  WORKBENCH_SPACE_COOKIE,
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  type WorkbenchSearchParams,
} from "../../lib/workbench/workbench-space-filters";
import { AgentControlPlane } from "../components/agent-control-plane";
import { AgentRunTabs } from "../components/agent-run-tabs";
import { WorkbenchShell } from "../components/workbench-shell";

export const dynamic = "force-dynamic";
export const AGENT_CENTER_SECTION_TITLES = ["Profiles", "Workers", "Loop Monitor", "执行尝试", "审批箱"] as const;
export const AGENT_CENTER_DISPATCH_LABELS = ["派发任务", "暂停运行", "审批操作"] as const;

export default async function AgentCenterPage({ searchParams }: { searchParams?: Promise<WorkbenchSearchParams> } = {}) {
  const raw = await searchParams;
  const { session, cookieStore } = await requireWorkbenchSession("/agents");
  const { context, loginEmail } = session;
  const companyFilters = await getWorkbenchCompanyFilters({ userId: context.userId });
  const selectedSpaceFilter = getWorkbenchSelectedSpaceFilter({ filters: companyFilters, searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM), cookieValue: cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value });
  const activeView = getSingleWorkbenchSearchParam(raw, "view") === "attempts" ? "attempts" : "monitor";
  const canManageProfiles = Boolean(
    selectedSpaceFilter.spaceId
    && (selectedSpaceFilter.role === "owner" || selectedSpaceFilter.role === "admin"),
  );
  const [data, workerPools] = await Promise.all([
    getAgentControlPlane({ userId: context.userId, ownerType: selectedSpaceFilter.ownerType, companyId: selectedSpaceFilter.companyId, includeRuns: activeView === "attempts", runCursor: activeView === "attempts" ? getSingleWorkbenchSearchParam(raw, "cursor") ?? null : null }),
    selectedSpaceFilter.ownerType === "personal"
      ? listWorkerPools({ scope: { ownerType: "personal", ownerUserId: context.userId, companyId: null } })
      : selectedSpaceFilter.ownerType === "company" && selectedSpaceFilter.companyId
        ? listWorkerPools({ scope: { ownerType: "company", ownerUserId: null, companyId: selectedSpaceFilter.companyId } })
        : Promise.resolve([]),
  ]);
  return <WorkbenchShell activeKey="agents" title="Agent 中心" subtitle="管理 Codex、Claude 执行配置，跟进 Worker、Run 与人工审批。" loginEmail={loginEmail} spaceLabel={selectedSpaceFilter.label} selectedSpaceKey={selectedSpaceFilter.key} spaceFilters={companyFilters} notificationUnreadCount={0} {...getWorkbenchShellLoginProps(session)}>
    <AgentControlPlane profiles={data.profiles} workers={data.workers} workerPools={workerPools} approvals={data.approvals} canManageProfiles={canManageProfiles} selectedSpaceId={selectedSpaceFilter.spaceId ?? null}><AgentRunTabs activeView={activeView} loops={data.loops} runs={data.runs} canManage={data.canManage} nextCursor={data.nextRunCursor} selectedSpaceKey={selectedSpaceFilter.key} /></AgentControlPlane>
  </WorkbenchShell>;
}
