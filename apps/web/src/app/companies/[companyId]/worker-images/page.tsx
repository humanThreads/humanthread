import { listWorkerImageCatalog } from "@humanthread/db";
import { getWorkbenchShellLoginProps } from "../../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";
import { getWorkbenchCompanySettingsDetails, getWorkbenchSettingsContext } from "../../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../../lib/workbench/workbench-space-filters";
import { CompanySettingsLayout } from "../../../components/company-settings-layout";
import { SettingsSection } from "../../../components/settings-form";
import { WorkerImageCatalogForm } from "../../../settings/admin/worker-image-catalog-form";
import { WorkbenchShell } from "../../../components/workbench-shell";
import { EmptyState } from "../../../components/workbench-ui";
import { updateCompanyWorkerImageCatalogAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CompanyWorkerImageSettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const { session } = await requireWorkbenchSession(`/companies/${companyId}/worker-images`);
  const [settingsContext, details, filters] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanySettingsDetails({ userId: session.context.userId, companyId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  const selected = getWorkbenchSelectedSpaceFilter({ filters, searchParamValue: companyId, cookieValue: undefined });
  const common = {
    activeKey: "settings" as const,
    loginEmail: session.account?.email ?? session.loginEmail,
    spaceLabel: selected.label,
    selectedSpaceKey: selected.key,
    spaceFilters: filters,
    ...getWorkbenchShellLoginProps(session),
  };
  if (!details || !details.context.membership.canManageIntegrations) {
    return <WorkbenchShell {...common} title="公司 Worker 镜像" subtitle="公司 Worker 镜像需要 owner 或 admin 权限。"><SettingsSection title="访问受限"><EmptyState title="无权管理公司 Worker 镜像" description="请联系该公司的 owner 或 admin。" /></SettingsSection></WorkbenchShell>;
  }
  const sources = await listWorkerImageCatalog({ scope: { ownerType: "company", companyId } });

  return <WorkbenchShell {...common} title={`${details.context.company.name} Worker 镜像`} subtitle="这些镜像仅对当前公司的项目可见；平台镜像仍在平台设置中统一维护。">
    <CompanySettingsLayout activeKey="worker-images" context={details.context} companies={settingsContext.companies}>
      <div className="mx-auto max-w-4xl">
        <SettingsSection title="公司 Worker 镜像目录" description="维护仅本公司项目可选择的镜像来源与不可变版本；部署命令仍固定使用 Digest。">
          <WorkerImageCatalogForm
            sources={sources.map((source) => ({
              id: source.id,
              name: source.name,
              repository: source.repository,
              status: source.status,
              versions: source.versions.map((version) => ({
                id: version.id,
                tag: version.tag,
                digest: version.digest,
                status: version.status,
              })),
            }))}
            action={updateCompanyWorkerImageCatalogAction.bind(null, companyId)}
          />
        </SettingsSection>
      </div>
    </CompanySettingsLayout>
  </WorkbenchShell>;
}
