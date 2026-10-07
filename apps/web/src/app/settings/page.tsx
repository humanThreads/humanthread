import { ArrowRight, Building2, KeyRound, MonitorSmartphone, ServerCog, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { getWorkbenchShellLoginProps } from "../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../lib/workbench/workbench-route-auth";
import { getWorkbenchSettingsContext } from "../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../lib/workbench/workbench-space-filters";
import { SettingsSection } from "../components/settings-form";
import { SettingsLayout } from "../components/settings-layout";
import { WorkbenchShell } from "../components/workbench-shell";

export const dynamic = "force-dynamic";

interface SettingsDestination {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const PERSONAL_DESTINATIONS = [
  { href: "/settings/account", label: "个人资料", description: "头像、姓名与账号事实", icon: UserRound },
  { href: "/settings/security", label: "安全设置", description: "修改当前账号密码", icon: ShieldCheck },
  { href: "/settings/devices", label: "Agent 设备", description: "设备授权与撤销", icon: MonitorSmartphone },
  { href: "/settings/mcp", label: "MCP 凭据", description: "当前账号的工具访问凭据", icon: KeyRound },
  { href: "/settings/workers", label: "Linux Worker", description: "个人 Worker Pool、启动 Token 与模型站点", icon: ServerCog },
] as const satisfies readonly SettingsDestination[];

function DestinationLink({ href, label, description, icon: Icon }: SettingsDestination) {
  return (
    <Link href={href} className="group flex min-h-14 items-center gap-3 border-b border-[#d8dee4] py-3 last:border-b-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#f6f8fa] text-[#57606a] group-hover:text-[#0969da]">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#24292f]">{label}</span>
        <span className="mt-0.5 block text-xs text-[#57606a]">{description}</span>
      </span>
      <ArrowRight size={16} className="text-[#8c959f] group-hover:translate-x-0.5 group-hover:text-[#0969da] motion-reduce:transition-none" aria-hidden="true" />
    </Link>
  );
}

export default async function SettingsOverviewPage() {
  const { session } = await requireWorkbenchSession("/settings");
  const [context, spaceFilters] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({
    filters: spaceFilters,
    searchParamValue: undefined,
    cookieValue: undefined,
  });

  return (
    <WorkbenchShell
      activeKey="settings"
      title="设置"
      subtitle="管理当前个人账号、所属公司与平台级配置。"
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={spaceFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <SettingsLayout activeKey="overview" context={context}>
        <div className="mx-auto max-w-3xl">
          <SettingsSection title="个人设置" description={`当前账号：${context.user.email ?? context.user.name}`}>
            <div>{PERSONAL_DESTINATIONS.map((item) => <DestinationLink key={item.href} {...item} />)}</div>
          </SettingsSection>

          <SettingsSection title="公司" description="公司是独立组织，角色决定可查看和管理的范围。">
            {context.companies.length > 0 ? (
              <div>
                {context.companies.map((company) => (
                  <Link key={company.id} href={`/companies/${company.id}`} className="group flex min-h-14 items-center gap-3 border-b border-[#d8dee4] py-3 last:border-b-0">
                    <span className="grid h-9 w-9 place-items-center rounded-md bg-[#f6f8fa] text-[#57606a]"><Building2 size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[#24292f]">{company.name}</span>
                      <span className="mt-0.5 block text-xs text-[#57606a]">{company.role} · {company.canManage ? "可管理" : "只读"}</span>
                    </span>
                    <ArrowRight size={16} className="text-[#8c959f] group-hover:text-[#0969da]" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-[#57606a]">当前账号尚未加入公司。</div>
            )}
            <Link href="/settings/companies" className="mt-3 inline-flex text-sm font-semibold text-[#0969da] hover:underline">查看公司列表</Link>
          </SettingsSection>

          {context.isSiteAdmin ? (
            <SettingsSection title="平台设置" description="仅站点管理员可访问全站配置。">
              <DestinationLink href="/settings/admin" label="平台设置" description="站点域名与全站基础能力" icon={ShieldCheck} />
            </SettingsSection>
          ) : null}
        </div>
      </SettingsLayout>
    </WorkbenchShell>
  );
}
