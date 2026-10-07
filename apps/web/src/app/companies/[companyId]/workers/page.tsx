import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import { getWorkbenchCompanySettingsDetails, getWorkbenchSettingsContext } from "../../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../../lib/workbench/workbench-space-filters";
import { CompanySettingsLayout } from "../../../components/company-settings-layout";
import { SettingsSection } from "../../../components/settings-form";
import { WorkerPoolSettings } from "../../../components/worker-pools/worker-pool-settings";
import { WorkbenchShell } from "../../../components/workbench-shell";
import { EmptyState } from "../../../components/workbench-ui";

export const dynamic = "force-dynamic";

export default async function CompanyWorkerSettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const { session } = await requireWorkbenchSession(`/companies/${companyId}/workers`);
  const [settingsContext, details, filters] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanySettingsDetails({ userId: session.context.userId, companyId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  const selected = getWorkbenchSelectedSpaceFilter({ filters, searchParamValue: companyId, cookieValue: undefined });
  const common = { activeKey: "settings" as const, loginEmail: session.account?.email ?? session.loginEmail, spaceLabel: selected.label, selectedSpaceKey: selected.key, spaceFilters: filters, ...getWorkbenchShellLoginProps(session) };
  if (!details || !details.context.membership.canManageIntegrations) {
    return <WorkbenchShell {...common} title="公司 Linux Worker" subtitle="公司 Worker 资源需要 owner 或 admin 权限。"><SettingsSection title="访问受限"><EmptyState title="无权管理公司 Worker" description="请联系该公司的 owner 或 admin。" /></SettingsSection></WorkbenchShell>;
  }
  return <WorkbenchShell {...common} title={`${details.context.company.name} Linux Worker`} subtitle="公司 Pool、启动 Token 与模型站点仅供本公司项目调度。">
    <CompanySettingsLayout activeKey="workers" context={details.context} companies={settingsContext.companies}>
      <div className="mx-auto max-w-4xl"><SettingsSection title="公司 Worker 资源"><WorkerPoolSettings companyId={companyId} /></SettingsSection></div>
    </CompanySettingsLayout>
  </WorkbenchShell>;
}
