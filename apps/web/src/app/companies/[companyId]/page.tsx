import { Building2, LockKeyhole } from "lucide-react";
import { getWorkbenchShellLoginProps } from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import {
  getWorkbenchCompanySettingsDetails,
  getWorkbenchSettingsContext,
} from "../../../lib/workbench/workbench-settings-context";
import { getWorkbenchSelectedSpaceFilter } from "../../../lib/workbench/workbench-space-filters";
import { CompanySettingsLayout } from "../../components/company-settings-layout";
import { SettingsSection } from "../../components/settings-form";
import { SettingsLayout } from "../../components/settings-layout";
import { WorkbenchShell } from "../../components/workbench-shell";
import { EmptyState, StatusPill, WorkbenchButton } from "../../components/workbench-ui";
import { CompanyProfileForm } from "./company-profile-form";

export const dynamic = "force-dynamic";

function getCertificationLabel(level: string | null | undefined) {
  if (level === "none") return "未认证";
  if (level === "vip") return "会员认证";
  if (level === "community") return "社区认证";
  return "普通认证";
}

interface CompanyPageProps {
  params: Promise<{ companyId: string }>;
}

export default async function CompanyPage({ params }: CompanyPageProps) {
  const { companyId } = await params;
  const { session } = await requireWorkbenchSession(`/companies/${companyId}`);
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
        title="公司管理"
        subtitle="无法确认当前账号与该公司的有效成员关系。"
        loginEmail={session.account?.email ?? session.loginEmail}
        spaceLabel={selectedSpace.label}
        selectedSpaceKey={selectedSpace.key}
        spaceFilters={companyFilters}
        {...getWorkbenchShellLoginProps(session)}
      >
        <SettingsLayout activeKey="companies" context={settingsContext}>
          <div className="mx-auto max-w-3xl">
            <SettingsSection title="访问受限">
              <EmptyState title="无法查看公司" description="该公司不存在，或当前账号不是有效成员。" />
            </SettingsSection>
          </div>
        </SettingsLayout>
      </WorkbenchShell>
    );
  }

  const { context, profile } = details;
  const canManageProfile = context.membership.canManageProfile;

  return (
    <WorkbenchShell
      activeKey="settings"
      title={context.company.name}
      subtitle="公司资料、成员与集成使用独立的公司权限边界。"
      loginEmail={session.account?.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={companyFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <CompanySettingsLayout activeKey="overview" context={context} companies={settingsContext.companies}>
        <div className="mx-auto max-w-4xl">
          <SettingsSection
            title="公司身份"
            description="这些信息描述公司本身，不会改变任何个人账号资料。"
            action={
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="blue">{getCertificationLabel(profile.certificationLevel)}</StatusPill>
                <StatusPill tone="success">{context.company.status}</StatusPill>
              </div>
            }
          >
            <div className="grid gap-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-start">
              {context.company.logoUrl ? (
                <img src={context.company.logoUrl} alt={context.company.name} className="h-20 w-20 rounded-md border border-[#d0d7de] object-cover" />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-md border border-[#d0d7de] bg-[#f6f8fa] text-[#57606a]">
                  <Building2 size={28} aria-hidden="true" />
                </div>
              )}
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-[#57606a]">公司名称</dt>
                  <dd className="mt-1 font-semibold text-[#24292f]">{context.company.name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-[#57606a]">公司标识</dt>
                  <dd className="mt-1 text-[#24292f]">{context.company.slug}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-[#57606a]">当前角色</dt>
                  <dd className="mt-1 text-[#24292f]">{context.membership.role}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-[#57606a]">资料权限</dt>
                  <dd className="mt-1 text-[#24292f]">{canManageProfile ? "可编辑" : "只读"}</dd>
                </div>
              </dl>
            </div>
          </SettingsSection>

          <SettingsSection
            title="公司资料"
            description={canManageProfile ? "资料按分区显式保存。" : "普通成员可查看公司资料，但不能修改。"}
          >
            {canManageProfile ? (
              <div className="grid gap-5">
                <form action="/api/workbench/company-logo" method="post" encType="multipart/form-data" className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <input type="hidden" name="companyId" value={companyId} />
                  <label className="grid flex-1 gap-1.5 text-sm font-semibold text-[#24292f]">
                    公司 logo
                    <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif" className="min-h-10 max-w-full rounded-md border border-[#8c959f] bg-white px-3 py-2 text-sm font-normal" />
                  </label>
                  <WorkbenchButton type="submit" size="small">上传 logo</WorkbenchButton>
                </form>
                <CompanyProfileForm
                  companyId={companyId}
                  initialDescription={profile.description ?? ""}
                  initialCertificationLevel={profile.certificationLevel}
                />
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-4 text-sm leading-6 text-[#24292f]">
                  {profile.description || "该公司尚未填写简介。"}
                </div>
                <div className="inline-flex items-center gap-2 text-xs text-[#57606a]">
                  <LockKeyhole size={14} aria-hidden="true" />
                  当前角色：{context.membership.role}，公司资料为只读。
                </div>
              </div>
            )}
          </SettingsSection>
        </div>
      </CompanySettingsLayout>
    </WorkbenchShell>
  );
}
