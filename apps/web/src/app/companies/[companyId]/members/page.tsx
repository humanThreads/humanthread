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
import { formatWorkbenchDateTime } from "../../../components/workbench-sections";
import { EmptyState, StatusPill } from "../../../components/workbench-ui";
import { CompanyMemberActionsDialogs } from "../member-actions-dialogs";

export const dynamic = "force-dynamic";

function getMemberLimit(level: string | null | undefined) {
  if (level === "none") return 1;
  if (level === "vip") return 200;
  if (level === "community") return 5;
  return 10;
}

interface CompanyMemberPageProps {
  params: Promise<{ companyId: string }>;
}

export default async function CompanyMemberPage({ params }: CompanyMemberPageProps) {
  const { companyId } = await params;
  const { session } = await requireWorkbenchSession(`/companies/${companyId}/members`);
  const [settingsContext, details, companyFilters] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanySettingsDetails({ userId: session.context.userId, companyId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: companyId,
    cookieValue: undefined,
  });

  if (!details) {
    return (
      <WorkbenchShell
        activeKey="settings"
        title="公司成员"
        subtitle="无法确认当前账号与该公司的有效成员关系。"
        loginEmail={session.account?.email ?? session.loginEmail}
        spaceLabel={selectedSpace.label}
        selectedSpaceKey={selectedSpace.key}
        spaceFilters={companyFilters}
        {...getWorkbenchShellLoginProps(session)}
      >
        <SettingsLayout activeKey="companies" context={settingsContext}>
          <SettingsSection title="访问受限">
            <EmptyState title="无法查看公司成员" description="该公司不存在，或当前账号不是有效成员。" />
          </SettingsSection>
        </SettingsLayout>
      </WorkbenchShell>
    );
  }

  const { context, profile, members } = details;
  const memberLimit = getMemberLimit(profile.certificationLevel);

  return (
    <WorkbenchShell
      activeKey="settings"
      title={`${context.company.name} 成员`}
      subtitle="查看公司成员关系；管理操作由当前公司角色决定。"
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <CompanySettingsLayout activeKey="members" context={context} companies={settingsContext.companies}>
        <div className="mx-auto max-w-5xl">
          <SettingsSection
            title="成员与角色"
            description={`当前角色：${context.membership.role}。成员关系只作用于 ${context.company.name}。`}
            action={
              <div className="flex flex-wrap items-center justify-end gap-3">
                <span className="text-xs font-semibold text-[#57606a]">{members.length} / {memberLimit}</span>
                {context.membership.canManageMembers ? (
                  <CompanyMemberActionsDialogs
                    companyId={companyId}
                    companyName={context.company.name}
                    members={members}
                    inviteDisabled={members.length >= memberLimit}
                    canTransferOwnership={context.membership.canTransferOwnership}
                  />
                ) : null}
              </div>
            }
          >
            {members.length > 0 ? (
              <div className="overflow-x-auto border-y border-[#d8dee4]">
                <table className="w-full min-w-[680px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#d8dee4] text-left text-[#57606a]">
                      <th className="py-2 pr-3 font-semibold">成员</th>
                      <th className="py-2 pr-3 font-semibold">邮箱</th>
                      <th className="py-2 pr-3 font-semibold">角色</th>
                      <th className="py-2 pr-3 font-semibold">状态</th>
                      <th className="py-2 font-semibold">最近活跃</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id} className="border-b border-[#d8dee4] last:border-b-0">
                        <td className="py-3 pr-3 font-semibold text-[#24292f]">{member.user.name}</td>
                        <td className="py-3 pr-3 text-[#57606a]">{member.user.email ?? "未绑定"}</td>
                        <td className="py-3 pr-3 text-[#57606a]">{member.role}</td>
                        <td className="py-3 pr-3"><StatusPill tone="success">{member.status}</StatusPill></td>
                        <td className="py-3 text-[#57606a]">{formatWorkbenchDateTime(member.user.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="暂无成员" description="这个公司还没有可显示的有效成员。" />
            )}
          </SettingsSection>
        </div>
      </CompanySettingsLayout>
    </WorkbenchShell>
  );
}
