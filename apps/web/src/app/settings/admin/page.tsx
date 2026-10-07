import { redirect } from "next/navigation";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSettingsContext } from "../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../lib/workbench/workbench-space-filters";
import { getWorkbenchSiteSettings } from "../../../lib/workbench/workbench-site-settings";
import { getSingleWorkbenchSearchParam, type WorkbenchSearchParams } from "../../../lib/workbench/workbench-space-filters";
import { SettingsSection } from "../../components/settings-form";
import { SettingsLayout } from "../../components/settings-layout";
import { WorkbenchShell } from "../../components/workbench-shell";
import { SiteSettingsForm } from "./site-settings-form";
import { StorageSettingsForm } from "./storage-settings-form";
import { getStorageSettings } from "../../../lib/storage/storage-settings";
import { listWorkerImageCatalog } from "@humanthread/db";
import { WorkerImageCatalogForm } from "./worker-image-catalog-form";
import { updateWorkerImageCatalogAction } from "../../workbench/actions";
import { AdminSettingsTabs, type AdminSettingsTab } from "./admin-settings-tabs";

export const dynamic = "force-dynamic";

function resolveAdminSettingsTab(value: string | undefined): AdminSettingsTab {
  return value === "storage" || value === "worker-images" ? value : "site";
}

export default async function AdminSettingsPage({ searchParams }: { searchParams?: Promise<WorkbenchSearchParams> } = {}) {
  const { session } = await requireWorkbenchSession("/settings/admin");

  if (!session.account?.isSiteAdmin) {
    redirect("/settings");
  }

  const rawSearchParams = await searchParams;
  const activeTab = resolveAdminSettingsTab(getSingleWorkbenchSearchParam(rawSearchParams, "tab"));
  const [settingsContext, siteSettings, storageSettings, companyFilters, imageSources] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchSiteSettings(),
    getStorageSettings(),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    listWorkerImageCatalog({ scope: { ownerType: "platform", companyId: null } }),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: undefined,
    cookieValue: undefined,
  });

  return (
    <WorkbenchShell
      activeKey="settings"
      title="平台设置"
      subtitle="站点级配置独立于个人账号和公司管理权限。"
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <SettingsLayout activeKey="admin" context={settingsContext}>
        <div className="mx-auto max-w-4xl">
          <AdminSettingsTabs activeTab={activeTab} />
          {activeTab === "site" ? <SettingsSection title="站点域名" description="该地址用于 MCP 入口和 Agent 默认 API 地址，仅 site admin 可以修改。">
            <SiteSettingsForm initialSiteBaseUrl={siteSettings.siteBaseUrl} mcpUrl={siteSettings.mcpUrl} />
          </SettingsSection> : null}
          {activeTab === "storage" ? <SettingsSection title="文件存储" description="任务附件、文档附件和验收证据统一使用此配置；凭据只填写 Secret 引用，不写入业务数据。">
            <StorageSettingsForm initial={storageSettings} />
          </SettingsSection> : null}
          {activeTab === "worker-images" ? <SettingsSection title="平台 Worker 镜像目录" description="站点管理员维护对所有项目可用的镜像来源与不可变版本；公司专属镜像在公司管理中单独维护。">
            <WorkerImageCatalogForm sources={imageSources.map((source) => ({ id: source.id, name: source.name, repository: source.repository, status: source.status, versions: source.versions.map((version) => ({ id: version.id, tag: version.tag, digest: version.digest, status: version.status })) }))} action={updateWorkerImageCatalogAction} />
          </SettingsSection> : null}
        </div>
      </SettingsLayout>
    </WorkbenchShell>
  );
}
