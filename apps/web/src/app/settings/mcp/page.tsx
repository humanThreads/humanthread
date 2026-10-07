import { listWorkbenchMcpCredentials } from "../../../lib/workbench/workbench-settings";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { getWorkbenchSettingsContext } from "../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../lib/workbench/workbench-space-filters";
import { getWorkbenchSiteSettings } from "../../../lib/workbench/workbench-site-settings";
import { SettingsSection } from "../../components/settings-form";
import { SettingsLayout } from "../../components/settings-layout";
import { WorkbenchShell } from "../../components/workbench-shell";
import { McpCredentialForm } from "./mcp-credential-form";
import { McpCredentialList } from "./mcp-credential-list";

export const dynamic = "force-dynamic";
export const MCP_CONFIG_SNIPPET_LINES = ["server: humanthread", "transport: http", "auth: bearer"] as const;

function buildMcpConfigSnippet(mcpUrl: string) {
  return ["server: humanthread", `url: ${mcpUrl}`, "transport: http", "auth: bearer"].join("\n");
}

export default async function McpSettingsPage() {
  const { session } = await requireWorkbenchSession("/settings/mcp");
  const [settingsContext, companyFilters, credentials, siteSettings] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    listWorkbenchMcpCredentials({ userId: session.context.userId }),
    getWorkbenchSiteSettings(),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: undefined,
    cookieValue: undefined,
  });

  return (
    <WorkbenchShell
      activeKey="settings"
      title="MCP 凭据"
      subtitle="凭据归当前个人账号所有，并继承该用户可访问的空间与文档权限。"
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <SettingsLayout activeKey="mcp" context={settingsContext}>
        <div className="mx-auto max-w-3xl">
          <SettingsSection title="当前配置" description="将配置和个人 token 提供给受信任的 MCP 客户端。">
            <pre className="overflow-x-auto rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-4 text-sm leading-6 text-[#24292f]"><code>{buildMcpConfigSnippet(siteSettings.mcpUrl)}</code></pre>
          </SettingsSection>
          <SettingsSection title="个人 MCP 凭据" description="每个凭据都归当前个人账号所有，撤销后立即失效。">
            <McpCredentialList credentials={credentials} />
          </SettingsSection>
          <SettingsSection title="创建凭据" description="完整 token 只会在创建成功后展示一次。">
            <div className="md:max-w-xl"><McpCredentialForm /></div>
          </SettingsSection>
        </div>
      </SettingsLayout>
    </WorkbenchShell>
  );
}
