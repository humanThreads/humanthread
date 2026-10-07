import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSettingsContext } from "../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../lib/workbench/workbench-space-filters";
import { SettingsSection } from "../../components/settings-form";
import { SettingsLayout } from "../../components/settings-layout";
import { WorkerPoolSettings } from "../../components/worker-pools/worker-pool-settings";
import { WorkbenchShell } from "../../components/workbench-shell";

export const dynamic = "force-dynamic";

export default async function WorkerSettingsPage() {
  const { session } = await requireWorkbenchSession("/settings/workers");
  const [context, filters] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  const selected = getWorkbenchSelectedSpaceFilter({ filters, searchParamValue: undefined, cookieValue: undefined });
  return <WorkbenchShell activeKey="settings" title="Linux Worker" subtitle="管理个人项目可用的 Pool、启动 Token 和模型站点。" loginEmail={session.account?.email ?? session.loginEmail} spaceLabel={selected.label} selectedSpaceKey={selected.key} spaceFilters={filters} {...getWorkbenchShellLoginProps(session)}>
    <SettingsLayout activeKey="workers" context={context}>
      <div className="mx-auto max-w-4xl"><SettingsSection title="个人 Worker 资源"><WorkerPoolSettings /></SettingsSection></div>
    </SettingsLayout>
  </WorkbenchShell>;
}
