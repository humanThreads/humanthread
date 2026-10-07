import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import { WorkbenchShell } from "../components/workbench-shell";
import { WorkbenchButton } from "../components/workbench-ui";
import { createOssClient, readOssDownloadConfig } from "../../lib/downloads/oss-client";
import { readReleaseCatalog, type ReleaseCatalog } from "../../lib/downloads/release-catalog";
import { DownloadCatalog } from "./download-catalog";

export const dynamic = "force-dynamic";

const EMPTY_CATALOG: ReleaseCatalog = {
  schemaVersion: 1,
  publishedAt: null,
  artifacts: {},
};

export default async function DownloadsPage() {
  const { session } = await requireWorkbenchSession("/downloads");
  let catalog = EMPTY_CATALOG;
  let catalogError = false;
  try {
    catalog = await readReleaseCatalog(createOssClient(readOssDownloadConfig()));
  } catch (error) {
    catalogError = true;
    const code = error instanceof Error && error.name ? error.name : "release_catalog_failed";
    console.error("Release catalog page failed", { code });
  }

  return (
    <WorkbenchShell
      activeKey="agents"
      title="客户端下载"
      subtitle="从已验证的发行目录获取 Desktop、Android 和 Agent CLI。"
      loginEmail={session.loginEmail}
      {...getWorkbenchShellLoginProps(session)}
      actions={<WorkbenchButton href="/">返回工作台</WorkbenchButton>}
    >
      <DownloadCatalog catalog={catalog} error={catalogError} />
    </WorkbenchShell>
  );
}
