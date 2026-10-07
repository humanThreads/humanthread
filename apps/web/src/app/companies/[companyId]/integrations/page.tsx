import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import {
  getWorkbenchCompanySettingsDetails,
  getWorkbenchSettingsContext,
} from "../../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../../lib/workbench/workbench-space-filters";
import { CompanySettingsLayout } from "../../../components/company-settings-layout";
import { SettingsSection } from "../../../components/settings-form";
import { SettingsLayout } from "../../../components/settings-layout";
import { WorkbenchShell } from "../../../components/workbench-shell";
import { EmptyState } from "../../../components/workbench-ui";
import { CompanyMailForm } from "./company-mail-form";

export const dynamic = "force-dynamic";

interface CompanyIntegrationsPageProps {
  params: Promise<{ companyId: string }>;
}

export default async function CompanyIntegrationsPage({ params }: CompanyIntegrationsPageProps) {
  const { companyId } = await params;
  const { session } = await requireWorkbenchSession(`/companies/${companyId}/integrations`);
  const [settingsContext, details, companyFilters] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanySettingsDetails({ userId: session.context.userId, companyId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({ filters: companyFilters, searchParamValue: companyId, cookieValue: undefined });

  if (!details || !details.context.membership.canManageIntegrations || !details.integration) {
    return (
      <WorkbenchShell
        activeKey="settings"
        title="公司集成"
        subtitle="公司集成需要当前公司的 owner 或 admin 权限。"
        loginEmail={session.account?.email ?? session.loginEmail}
        spaceLabel={selectedSpace.label}
        selectedSpaceKey={selectedSpace.key}
        spaceFilters={companyFilters}
        {...getWorkbenchShellLoginProps(session)}
      >
        <SettingsLayout activeKey="companies" context={settingsContext}>
          <div className="mx-auto max-w-3xl">
            <SettingsSection title="访问受限">
              <EmptyState title="无权管理公司集成" description="请联系该公司的 owner 或 admin。" />
            </SettingsSection>
          </div>
        </SettingsLayout>
      </WorkbenchShell>
    );
  }

  const { context, integration } = details;
  return (
    <WorkbenchShell
      activeKey="settings"
      title={`${context.company.name} 集成`}
      subtitle="公司级外部服务使用独立权限，不影响个人账号设置。"
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <CompanySettingsLayout activeKey="integrations" context={context} companies={settingsContext.companies}>
        <div className="mx-auto max-w-4xl">
          <SettingsSection title="邮件集成" description="配置公司通知邮件使用的服务器。密码只写入，不会从页面回显。">
            <CompanyMailForm companyId={companyId} initial={integration} />
          </SettingsSection>
        </div>
      </CompanySettingsLayout>
    </WorkbenchShell>
  );
}
