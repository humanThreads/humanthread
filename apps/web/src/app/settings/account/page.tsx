import Link from "next/link";
import { getWorkbenchAccountSettings } from "../../../lib/workbench/workbench-settings";
import {
  WORKBENCH_AVATAR_ALLOWED_MIME_TYPES,
  WORKBENCH_AVATAR_MAX_BYTES,
  buildWorkbenchAvatarSrc,
  getWorkbenchShellLoginProps,
} from "../../../lib/workbench/workbench-avatar";
import { getWorkbenchCompanyFilters } from "../../../lib/workbench/workbench-companies";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchSettingsContext } from "../../../lib/workbench/workbench-settings-context";
import {
  getSingleWorkbenchSearchParam,
  getWorkbenchSelectedSpaceFilter,
  type WorkbenchSearchParams,
} from "../../../lib/workbench/workbench-space-filters";
import { SettingsSection } from "../../components/settings-form";
import { SettingsLayout } from "../../components/settings-layout";
import { WorkbenchShell } from "../../components/workbench-shell";
import { formatWorkbenchDateTime } from "../../components/workbench-sections";
import { StatusPill } from "../../components/workbench-ui";
import { AccountAvatarUploadDialog } from "./avatar-upload-dialog";
import { AccountProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";
export const SETTINGS_ACCOUNT_READONLY_FIELDS = ["邮箱", "账号状态"] as const;
export const ACCOUNT_AVATAR_ALLOWED_TYPES = [...WORKBENCH_AVATAR_ALLOWED_MIME_TYPES] as const;

function getAvatarInitial(name: string, email: string | null) {
  return (name.trim() || email?.trim() || "U").charAt(0).toUpperCase();
}

function getAvatarFeedback(searchParams: WorkbenchSearchParams | undefined) {
  const state = getSingleWorkbenchSearchParam(searchParams, "avatar");
  const error = getSingleWorkbenchSearchParam(searchParams, "avatarError");
  if (state === "updated") return { tone: "success" as const, text: "头像已更新" };
  if (error) return { tone: "danger" as const, text: "头像上传失败，请检查图片格式和大小后重试。" };
  return null;
}

export default async function AccountSettingsPage({ searchParams }: { searchParams?: Promise<WorkbenchSearchParams> } = {}) {
  const resolvedSearchParams = await searchParams;
  const { session } = await requireWorkbenchSession("/settings/account");
  const [account, context, spaceFilters] = await Promise.all([
    session.account ?? getWorkbenchAccountSettings({ userId: session.context.userId }),
    getWorkbenchSettingsContext({ userId: session.context.userId }),
    getWorkbenchCompanyFilters({ userId: session.context.userId }),
  ]);
  const selectedSpace = getWorkbenchSelectedSpaceFilter({
    filters: spaceFilters,
    searchParamValue: getSingleWorkbenchSearchParam(resolvedSearchParams, "space"),
    cookieValue: undefined,
  });
  const avatarSrc = buildWorkbenchAvatarSrc(account.avatarUrl, account.avatarUpdatedAt);
  const feedback = getAvatarFeedback(resolvedSearchParams);

  return (
    <WorkbenchShell
      activeKey="settings"
      title="个人资料"
      subtitle="这些资料只属于当前登录用户，不会修改公司信息。"
      loginEmail={account.email ?? session.loginEmail}
      spaceLabel={selectedSpace.label}
      selectedSpaceKey={selectedSpace.key}
      spaceFilters={spaceFilters}
      {...getWorkbenchShellLoginProps(session)}
    >
      <SettingsLayout activeKey="account" context={context}>
        <div className="mx-auto max-w-3xl">
          <SettingsSection title="头像" description="工作台和协作记录会使用这张个人头像。" action={<StatusPill tone="success">{account.status}</StatusPill>}>
            <div className="grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-start">
              {avatarSrc ? (
                <img src={avatarSrc} alt={account.name} className="h-24 w-24 rounded-lg border border-[#d0d7de] object-cover" />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-lg border border-[#d0d7de] bg-[#f6f8fa] text-2xl font-semibold text-[#0a3069]">{getAvatarInitial(account.name, account.email)}</div>
              )}
              <div className="grid gap-3">
                {feedback ? <div className={feedback.tone === "success" ? "text-sm font-medium text-[#116329]" : "text-sm font-medium text-[#cf222e]"}>{feedback.text}</div> : null}
                <AccountAvatarUploadDialog action="/api/workbench/avatar" accept={ACCOUNT_AVATAR_ALLOWED_TYPES.join(",")} maxBytes={WORKBENCH_AVATAR_MAX_BYTES} />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="个人资料" description="姓名修改只影响当前个人账号。">
            <AccountProfileForm initialName={account.name} />
          </SettingsSection>

          <SettingsSection title="账号事实" description="邮箱和账号状态由身份系统维护。">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="font-semibold text-[#24292f]">邮箱</dt><dd className="mt-1 text-[#57606a]">{account.email ?? "未绑定"}</dd></div>
              <div><dt className="font-semibold text-[#24292f]">账号状态</dt><dd className="mt-1 text-[#57606a]">{account.status}</dd></div>
              <div><dt className="font-semibold text-[#24292f]">最近活跃</dt><dd className="mt-1 text-[#57606a]">{formatWorkbenchDateTime(account.lastSeenAt)}</dd></div>
            </dl>
            <Link href="/settings/security" className="mt-4 inline-flex text-sm font-semibold text-[#0969da] hover:underline">前往安全设置</Link>
          </SettingsSection>
        </div>
      </SettingsLayout>
    </WorkbenchShell>
  );
}
