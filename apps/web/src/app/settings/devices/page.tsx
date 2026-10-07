import { getWorkbenchOverview } from "../../../lib/workbench/workbench-overview";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSettingsContext } from "../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../lib/workbench/workbench-space-filters";
import { SettingsSection } from "../../components/settings-form";
import { SettingsLayout } from "../../components/settings-layout";
import { DeviceAgentPanel } from "../../components/workbench-sections";
import { WorkbenchShell } from "../../components/workbench-shell";

export const dynamic = "force-dynamic";
export const SETTINGS_DEVICES_ACTIONS = ["授权设备", "撤销授权"] as const;

export default async function DeviceSettingsPage() {
  const { session } = await requireWorkbenchSession("/settings/devices");
  const { context } = session;
  const [settingsContext, companyFilters, overview] = await Promise.all([
    getWorkbenchSettingsContext({ userId: context.userId }),
    getWorkbenchCompanyFilters({ userId: context.userId }),
    getWorkbenchOverview({ teamId: context.teamId, userId: context.userId }),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: undefined,
    cookieValue: undefined,
  });

  return (
    <WorkbenchShell
      activeKey="settings"
      title="Agent 设备"
      subtitle="设备授权、绑定码与设备 token 归当前个人账号所有。"
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <SettingsLayout activeKey="devices" context={settingsContext}>
        <div className="mx-auto max-w-3xl">
          <SettingsSection title="设备与授权" description="这些设备归当前个人账号所有，不属于任何公司。">
            <DeviceAgentPanel devices={overview.devices} userId={context.userId} />
          </SettingsSection>
        </div>
      </SettingsLayout>
    </WorkbenchShell>
  );
}
