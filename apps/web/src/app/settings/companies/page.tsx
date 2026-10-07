import { Building2, Eye, Settings2, UsersRound } from "lucide-react";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSettingsContext } from "../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../lib/workbench/workbench-space-filters";
import { SettingsSection } from "../../components/settings-form";
import { SettingsLayout } from "../../components/settings-layout";
import { WorkbenchShell } from "../../components/workbench-shell";
import { EmptyState, StatusPill, WorkbenchButton } from "../../components/workbench-ui";
import { CompanyCreateDialog } from "./company-create-dialog";

export const dynamic = "force-dynamic";

interface CompanySettingsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const EMPTY_SEARCH_PARAMS: Record<string, string | string[] | undefined> = {};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompanySettingsPage({
  searchParams,
}: CompanySettingsPageProps = {}) {
  const { session } = await requireWorkbenchSession("/settings/companies");
  const [settingsContext, companyFilters, resolvedSearchParams] = await Promise.all([
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
    searchParams ?? Promise.resolve(EMPTY_SEARCH_PARAMS),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    searchParamValue: undefined,
    cookieValue: undefined,
  });
  const choosingMembers = firstParam(resolvedSearchParams.intent) === "members";

  return (
    <WorkbenchShell
      activeKey="settings"
      title={choosingMembers ? "选择公司" : "公司管理"}
      subtitle={choosingMembers
        ? "选择要查看成员与角色的公司，不会自动使用第一家公司。"
        : "查看当前账号加入的公司、角色和可管理范围。"}
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <SettingsLayout activeKey="companies" context={settingsContext}>
        <div className="mx-auto max-w-4xl">
          <SettingsSection
            title={choosingMembers ? "所属公司" : "公司目录"}
            description={choosingMembers
              ? "公司成员关系是独立权限边界，请明确选择要进入的公司。"
              : "公司与个人账号相互独立。每一行都显示当前账号在该公司的角色与可执行范围。"}
            action={choosingMembers ? undefined : <CompanyCreateDialog />}
          >
            {settingsContext.companies.length > 0 ? (
              <div className="divide-y divide-[#d8dee4] border-y border-[#d8dee4]">
                {settingsContext.companies.map((company) => {
                  const target = choosingMembers
                    ? `/companies/${company.id}/members`
                    : `/companies/${company.id}`;

                  return (
                    <div key={company.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[#d0d7de] bg-[#f6f8fa] text-[#57606a]">
                          <Building2 size={18} aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[#24292f]">{company.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#57606a]">
                            <span>当前角色：{company.role}</span>
                            <span className="inline-flex items-center gap-1">
                              {company.canManage ? <Settings2 size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
                              {company.canManage ? "可管理资料与成员" : "可查看公司关系"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusPill tone="success">成员关系有效</StatusPill>
                        <WorkbenchButton href={target} size="small">
                          {choosingMembers ? <UsersRound size={14} aria-hidden="true" /> : null}
                          {choosingMembers ? "查看成员" : company.canManage ? "管理公司" : "查看公司"}
                        </WorkbenchButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="暂无公司关系"
                description={choosingMembers
                  ? "当前账号尚未加入任何公司，无法进入公司成员页。"
                  : "当前账号尚未加入任何公司，可以创建公司并成为 owner。"}
              />
            )}
          </SettingsSection>
        </div>
      </SettingsLayout>
    </WorkbenchShell>
  );
}
