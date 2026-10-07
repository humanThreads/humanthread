import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSettingsContext } from "../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../lib/workbench/workbench-space-filters";
import { SettingsSection } from "../../components/settings-form";
import { SettingsLayout } from "../../components/settings-layout";
import { WorkbenchShell } from "../../components/workbench-shell";
import { PasswordForm } from "./password-form";
import { LoginDeviceList } from "./login-device-list";
import { listActiveWebSessions } from "../../../lib/workbench/web-session-store";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const { session } = await requireWorkbenchSession("/settings/security");
  const [context, spaceFilters, sessions] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    listActiveWebSessions({ userId: session.context.userId }),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({
    filters: spaceFilters,
    searchParamValue: undefined,
    cookieValue: undefined,
  });

  return (
    <WorkbenchShell
      activeKey="settings"
      title="安全设置"
      subtitle="管理当前个人账号的密码与 Web 登录设备。"
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={spaceFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <SettingsLayout activeKey="security" context={context}>
        <div className="mx-auto max-w-3xl">
          <SettingsSection title="修改密码" description="保存后，下次登录需要使用新密码。">
            <PasswordForm />
          </SettingsSection>
          <SettingsSection title="登录设备" description="查看当前有效的 Web 登录，并让其他设备立即退出。">
            <LoginDeviceList
              currentSessionId={session.webSessionId as string}
              sessions={sessions}
            />
          </SettingsSection>
        </div>
      </SettingsLayout>
    </WorkbenchShell>
  );
}
