"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { reportAgentTaskEvent } from "../../lib/agent/agent-events";
import { issueMcpCredential } from "../../lib/mcp/mcp-auth";
import type { WorkbenchTaskActionType } from "../../lib/workbench/workbench-actions";
import {
  createWorkbenchWorkflow,
  performWorkbenchTaskAction,
} from "../../lib/workbench/workbench-actions";
import {
  WORKBENCH_USER_COOKIE,
} from "../../lib/workbench/workbench-context";
import { clearWebAuthenticationCookies } from "../../lib/workbench/web-session-cookie";
import { revokeWebSession } from "../../lib/workbench/web-session-store";
import {
  buildWorkbenchCompanyFiltersCacheTag,
  getWorkbenchCompanyFilters,
} from "../../lib/workbench/workbench-companies";
import {
  buildWorkbenchAccountSettingsCacheTag,
  changeWorkbenchPassword,
  createWorkbenchCompany,
  inviteWorkbenchCompanyMember,
  removeWorkbenchCompanyMember,
  revokeWorkbenchMcpCredential,
  transferWorkbenchCompanyOwnership,
  updateWorkbenchAccountProfile,
  updateWorkbenchCompanyMailSettings,
  updateWorkbenchCompanyMemberRole,
  updateWorkbenchCompanyProfile,
} from "../../lib/workbench/workbench-settings";
import { WORKBENCH_SPACE_COOKIE } from "../../lib/workbench/workbench-space-filters";
import { resolveWorkbenchSession } from "../../lib/workbench/workbench-session";
import { updateWorkbenchSiteSettings } from "../../lib/workbench/workbench-site-settings";
import { isWorkbenchSiteAdmin } from "../../lib/workbench/workbench-site-settings";
import { createWorkerImageSource, createWorkerImageVersion, setWorkerImageVersionStatus } from "@humanthread/db";
import { setWorkbenchDeviceAuthorization } from "../../lib/workbench/workbench-device-actions";
import { getWorkbenchProjectDetail } from "../../lib/workbench/workbench-projects";
import { createWorkbenchLoginSession } from "../../lib/workbench/workbench-login-session";
import {
  buildWorkbenchLoginErrorHref,
  buildWorkbenchRegisterErrorHref,
  normalizeWorkbenchRedirectPath,
} from "../../lib/workbench/workbench-auth-guard";
import { registerWorkbenchUser } from "../../lib/workbench/workbench-registration";
import { createWorkbenchSpaceDocument } from "../../lib/workbench/workbench-documents";

const SUPPORTED_TASK_ACTIONS: WorkbenchTaskActionType[] = [
  "start",
  "complete",
  "block",
  "interrupt",
  "follow_up",
  "transfer",
];

const WORKBENCH_DASHBOARD_PATH = "/dashboard";

async function buildServerActionRequest(path: string): Promise<Request> {
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim()
    || requestHeaders.get("host")?.trim()
    || "localhost:3000";
  return new Request(`${protocol}://${host}${path}`, { headers: requestHeaders });
}

function getTrimmedString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createWorkbenchSpaceDocumentAction(formData: FormData) {
  const context = await loadWorkbenchContext();
  const document = await createWorkbenchSpaceDocument({
    spaceId: getTrimmedString(formData, "spaceId"),
    userId: context.userId,
    title: getTrimmedString(formData, "title"),
    path: getTrimmedString(formData, "path"),
    contentMarkdown: getTrimmedString(formData, "contentMarkdown"),
    source: "web",
  });

  revalidatePath("/documents");
  redirect(`/documents/${document.id}`);
}

function getQuickCreatePriorityLabel(value: string): string {
  switch (value) {
    case "high":
      return "高";
    case "low":
      return "低";
    case "medium":
    default:
      return "中";
  }
}

function formatQuickCreateDueAt(value: string): string {
  return value.replace("T", " ");
}

function buildQuickCreateWorkflowDescription(formData: FormData): string {
  const description = getTrimmedString(formData, "description");
  const phase = getTrimmedString(formData, "phase");
  const priority = getTrimmedString(formData, "priority");
  const dueAt = getTrimmedString(formData, "dueAt");
  const acceptanceCriteria = getTrimmedString(formData, "acceptanceCriteria")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const requiredDocs = getTrimmedString(formData, "requiredDocs")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const agentPrerequisites = getTrimmedString(formData, "agentPrerequisites")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const metadataLines: string[] = [];

  if (phase) {
    metadataLines.push(`阶段：${phase}`);
  }

  if (priority) {
    metadataLines.push(`优先级：${getQuickCreatePriorityLabel(priority)}`);
  }

  if (dueAt) {
    metadataLines.push(`截止时间：${formatQuickCreateDueAt(dueAt)}`);
  }

  if (acceptanceCriteria.length > 0) {
    metadataLines.push("验收标准：");
    metadataLines.push(...acceptanceCriteria.map((line) => `- ${line}`));
  }

  if (requiredDocs.length > 0) {
    metadataLines.push("所需文档：");
    metadataLines.push(...requiredDocs.map((line) => `- ${line}`));
  }

  if (agentPrerequisites.length > 0) {
    metadataLines.push("Agent 前置条件：");
    metadataLines.push(...agentPrerequisites.map((line) => `- ${line}`));
  }

  if (description && metadataLines.length > 0) {
    return [description, "", ...metadataLines].join("\n");
  }

  if (metadataLines.length > 0) {
    return metadataLines.join("\n");
  }

  return description;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function setPersistentCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  name: string,
  value: string,
) {
  cookieStore.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

function getWorkbenchSpaceScope(spaceKey: string | undefined): {
  companyId?: string;
  ownerType?: "company" | "personal";
} {
  const normalizedSpaceKey = spaceKey?.trim();

  if (!normalizedSpaceKey || normalizedSpaceKey === "all") {
    return {};
  }

  if (normalizedSpaceKey === "personal") {
    return {
      ownerType: "personal",
    };
  }

  return {
    companyId: normalizedSpaceKey,
    ownerType: "company",
  };
}

async function loadWorkbenchContext(input?: {
  spaceKey?: string;
}) {
  const cookieStore = await cookies();
  const getCookieValue = (name: string) => cookieStore.get(name)?.value;
  const requestedSpaceKey =
    input?.spaceKey?.trim() || cookieStore.get(WORKBENCH_SPACE_COOKIE)?.value;
  const requestedScope = getWorkbenchSpaceScope(requestedSpaceKey);

  return resolveWorkbenchSession({
    getCookieValue,
    ...(requestedSpaceKey && requestedSpaceKey !== "all" ? requestedScope : {}),
  }).then((session) => session.context);
}

async function loadAuthenticatedWorkbenchSession() {
  const cookieStore = await cookies();
  const session = await resolveWorkbenchSession({
    getCookieValue: (name) => cookieStore.get(name)?.value,
  });
  if (!session.webSessionId) throw new Error("Workbench authentication required");
  return {
    session: { ...session, webSessionId: session.webSessionId },
    cookieStore,
  };
}

export async function createWorkbenchWorkflowAction(formData: FormData) {
  const context = await loadWorkbenchContext({
    spaceKey: getTrimmedString(formData, "spaceKey"),
  });
  const selectedProjectId = getTrimmedString(formData, "projectId");
  const shouldStartImmediately = formData.get("startImmediately") !== null;
  const resolvedContext =
    selectedProjectId && selectedProjectId !== context.projectId
      ? (() => {
          return {
            ...context,
            projectId: selectedProjectId,
          };
        })()
      : context;

  if (selectedProjectId && selectedProjectId !== context.projectId) {
    const project = await getWorkbenchProjectDetail({
      projectId: selectedProjectId,
      userId: context.userId,
    });

    if (!project) {
      throw new Error("Workbench project is unavailable");
    }
  }

  const result = await createWorkbenchWorkflow({
    title: getTrimmedString(formData, "title"),
    description: buildQuickCreateWorkflowDescription(formData),
    context: resolvedContext,
  });

  if (shouldStartImmediately && result.tasks[0]?.id) {
    await performWorkbenchTaskAction({
      taskId: result.tasks[0].id,
      actionType: "start",
      context: resolvedContext,
    });
  }

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
}

export async function submitWorkbenchTaskAction(formData: FormData) {
  const context = await loadWorkbenchContext();
  const taskId = getTrimmedString(formData, "taskId");
  const actionType = getTrimmedString(formData, "actionType");

  if (!SUPPORTED_TASK_ACTIONS.includes(actionType as WorkbenchTaskActionType)) {
    throw new Error("Unsupported action type");
  }

  await performWorkbenchTaskAction({
    taskId,
    actionType: actionType as WorkbenchTaskActionType,
    reason: getTrimmedString(formData, "reason"),
    targetUserId: getTrimmedString(formData, "targetUserId"),
    context,
  });

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
}

export async function openWorkbenchLocalAction(formData: FormData) {
  const context = await loadWorkbenchContext();

  await reportAgentTaskEvent({
    taskId: getTrimmedString(formData, "taskId"),
    actorUserId: context.userId,
    actorTeamId: context.teamId,
    eventType: "local_opened",
    message: "从 Web 工作台触发打开本地",
    localDevice: {
      id: "device_web_fallback",
      name: "web-workbench",
      platform: "web",
    },
    payload: {
      cwd: getTrimmedString(formData, "projectPath"),
      command: getTrimmedString(formData, "command"),
      source: "web_workbench",
    },
  });

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
}

export async function setWorkbenchUserAction(formData: FormData) {
  const userId = getTrimmedString(formData, "userId");

  if (!userId) {
    throw new Error("User ID is required");
  }

  const cookieStore = await cookies();
  setPersistentCookie(cookieStore, WORKBENCH_USER_COOKIE, userId);

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
}

export async function loginWorkbenchAction(formData: FormData) {
  const email = normalizeEmail(getTrimmedString(formData, "email"));
  const password = getTrimmedString(formData, "password");
  const normalizedRedirectTo = normalizeWorkbenchRedirectPath(
    getTrimmedString(formData, "redirectTo"),
  );
  const redirectTo =
    normalizedRedirectTo === "/"
      ? WORKBENCH_DASHBOARD_PATH
      : normalizedRedirectTo;
  const cookieStore = await cookies();

  try {
    await createWorkbenchLoginSession({
      email,
      password,
      cookieStore,
      request: await buildServerActionRequest("/login"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (
      message === "Email is required" ||
      message === "Password is required" ||
      message === "Workbench login credentials are invalid"
    ) {
      return redirect(
        buildWorkbenchLoginErrorHref({
          error: "invalid-credentials",
          redirectTo,
        }),
      );
    }

    throw error;
  }

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
  redirect(redirectTo);
}

export async function registerWorkbenchAction(formData: FormData) {
  const name = getTrimmedString(formData, "name");
  const email = normalizeEmail(getTrimmedString(formData, "email"));
  const password = getTrimmedString(formData, "password");
  const verificationCode = getTrimmedString(formData, "verificationCode");
  const accountType = getTrimmedString(formData, "accountType");
  const companyName = getTrimmedString(formData, "companyName");
  const normalizedRedirectTo = normalizeWorkbenchRedirectPath(
    getTrimmedString(formData, "redirectTo"),
  );
  const redirectTo =
    normalizedRedirectTo === "/"
      ? WORKBENCH_DASHBOARD_PATH
      : normalizedRedirectTo;
  const cookieStore = await cookies();

  try {
    await registerWorkbenchUser({
      ...(accountType === "company" ? { accountType: "company" as const } : {}),
      ...(companyName ? { companyName } : {}),
      name,
      email,
      password,
      verificationCode,
      request: await buildServerActionRequest("/register"),
      cookieStore,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "Workbench account already exists") {
      return redirect(
        buildWorkbenchRegisterErrorHref({
          error: "account-exists",
          redirectTo,
        }),
      );
    }

    if (
      message === "Registration verification code is required" ||
      message === "Registration verification code is invalid"
    ) {
      return redirect(
        buildWorkbenchRegisterErrorHref({
          error: "verification-invalid",
          redirectTo,
        }),
      );
    }

    throw error;
  }

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
  redirect(redirectTo);
}

export async function logoutWorkbenchAction() {
  const cookieStore = await cookies();
  try {
    const session = await resolveWorkbenchSession({
      getCookieValue: (name) => cookieStore.get(name)?.value,
    });
    if (session.webSessionId) {
      await revokeWebSession({
        userId: session.context.userId,
        targetSessionId: session.webSessionId,
        reason: "user_logout",
      });
    }
  } catch {
    // Local logout must remain available when the persisted session is unavailable.
  }
  clearWebAuthenticationCookies(cookieStore);

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
  redirect("/login");
}

export async function revokeWorkbenchWebSessionAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const { session } = await loadAuthenticatedWorkbenchSession();
  const targetSessionId = getTrimmedString(formData, "webSessionId");
  if (!targetSessionId) return { ok: false, formError: "请选择需要退出的设备" };
  if (targetSessionId === session.webSessionId) {
    return { ok: false, formError: "当前设备请使用退出登录" };
  }
  await revokeWebSession({
    userId: session.context.userId,
    targetSessionId,
    reason: "remote_logout",
  });
  revalidatePath("/settings/security");
  return { ok: true };
}

export interface WorkbenchSpaceActionState {
  ok: boolean;
  error?: string;
}

type WorkbenchSpaceActionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      reason: "missing" | "unavailable";
    };

async function applyWorkbenchSpaceSelection(
  formData: FormData,
): Promise<WorkbenchSpaceActionResult> {
  const spaceKey = getTrimmedString(formData, "spaceKey");

  if (!spaceKey) {
    return {
      ok: false,
      error: "请选择工作空间",
      reason: "missing",
    };
  }

  const cookieStore = await cookies();
  const session = await resolveWorkbenchSession({
    getCookieValue: (name) => cookieStore.get(name)?.value,
  });
  const accessibleFilters = await getWorkbenchCompanyFilters({
    userId: session.context.userId,
  });

  if (!accessibleFilters.some((filter) => filter.key === spaceKey)) {
    return {
      ok: false,
      error: "该工作空间不可用，请刷新后重试",
      reason: "unavailable",
    };
  }

  setPersistentCookie(cookieStore, WORKBENCH_SPACE_COOKIE, spaceKey);

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
  revalidatePath("/team");
  revalidatePath("/projects");
  revalidatePath("/documents");

  return { ok: true };
}

export async function switchWorkbenchSpaceAction(
  formData: FormData,
): Promise<WorkbenchSpaceActionState> {
  const result = await applyWorkbenchSpaceSelection(formData);

  return result.ok
    ? { ok: true }
    : { ok: false, error: result.error };
}

export async function setWorkbenchSpaceAction(formData: FormData): Promise<void> {
  const result = await applyWorkbenchSpaceSelection(formData);

  if (result.ok) {
    return;
  }

  if (result.reason === "missing") {
    throw new Error("Workbench space key is required");
  }

  throw new Error("Workbench space is unavailable for the current user");
}

export interface WorkbenchSettingsActionState {
  ok: boolean;
  otherSessionsRevoked?: number;
  fieldErrors?: Record<string, string>;
  formError?: string;
  companyId?: string;
}

export async function createWorkbenchCompanyAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();
  const name = getTrimmedString(formData, "name");

  if (!name) {
    return { ok: false, fieldErrors: { name: "请输入公司名称" } };
  }

  try {
    const result = await createWorkbenchCompany({
      userId: context.userId,
      name,
    });

    revalidateTag(buildWorkbenchCompanyFiltersCacheTag(context.userId), "max");
    revalidatePath("/settings");
    revalidatePath("/settings/companies");
    revalidatePath("/team");
    revalidatePath("/projects");
    return { ok: true, companyId: result.company.id };
  } catch (error) {
    return {
      ok: false,
      formError: error instanceof Error ? error.message : "公司创建失败",
    };
  }
}

export async function changeWorkbenchPasswordAction(formData: FormData) {
  const { session } = await loadAuthenticatedWorkbenchSession();

  try {
    await changeWorkbenchPassword({
      userId: session.context.userId,
      currentSessionId: session.webSessionId,
      currentPassword: getTrimmedString(formData, "currentPassword"),
      newPassword: getTrimmedString(formData, "newPassword"),
      confirmPassword: getTrimmedString(formData, "confirmPassword"),
    });
  } catch {
    redirect("/settings/account?password=failed");
  }

  revalidateTag(buildWorkbenchAccountSettingsCacheTag(session.context.userId), "max");
  revalidatePath("/settings/account");
  redirect("/settings/account?password=updated");
}

export async function updateWorkbenchAccountProfileAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();
  const name = getTrimmedString(formData, "name");

  if (!name) {
    return {
      ok: false,
      fieldErrors: { name: "请输入姓名" },
    };
  }

  try {
    await updateWorkbenchAccountProfile({
      userId: context.userId,
      name,
    });
    revalidateTag(buildWorkbenchAccountSettingsCacheTag(context.userId), "max");
    revalidatePath("/settings");
    revalidatePath("/settings/account");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      formError: error instanceof Error ? error.message : "个人资料保存失败",
    };
  }
}

export async function changeWorkbenchPasswordStateAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const { session } = await loadAuthenticatedWorkbenchSession();
  const currentPassword = getTrimmedString(formData, "currentPassword");
  const newPassword = getTrimmedString(formData, "newPassword");
  const confirmPassword = getTrimmedString(formData, "confirmPassword");
  const fieldErrors: Record<string, string> = {};

  if (!currentPassword) {
    fieldErrors.currentPassword = "请输入当前密码";
  }
  if (newPassword.length < 8) {
    fieldErrors.newPassword = "新密码至少需要 8 位";
  }
  if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = "两次输入的新密码不一致";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  try {
    const result = await changeWorkbenchPassword({
      userId: session.context.userId,
      currentSessionId: session.webSessionId,
      currentPassword,
      newPassword,
      confirmPassword,
    });
    revalidateTag(buildWorkbenchAccountSettingsCacheTag(session.context.userId), "max");
    revalidatePath("/settings/security");
    return { ok: true, otherSessionsRevoked: result.otherSessionsRevoked };
  } catch {
    return {
      ok: false,
      formError: "当前密码不正确，密码未修改。",
    };
  }
}

export async function updateWorkbenchSiteSettingsAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();

  try {
    await updateWorkbenchSiteSettings({
      userId: context.userId,
      siteBaseUrl: getTrimmedString(formData, "siteBaseUrl"),
    });
    revalidatePath("/settings/admin");
    revalidatePath("/settings/mcp");
    revalidatePath("/downloads");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      formError: error instanceof Error ? error.message : "站点配置保存失败",
    };
  }
}

export async function updateWorkerImageCatalogAction(input:
  | { kind: "source"; name: string; repository: string }
  | { kind: "version"; sourceId: string; tag: string; digest: string }
  | { kind: "version-status"; versionId: string; status: "active" | "disabled" }
): Promise<{ ok: boolean; formError?: string }> {
  const context = await loadWorkbenchContext();
  try {
    if (!await isWorkbenchSiteAdmin({ userId: context.userId })) throw new Error("仅站点管理员可以维护 Worker 镜像目录");
    if (input.kind === "source") {
      await createWorkerImageSource({
        actorUserId: context.userId,
        scope: { ownerType: "platform", companyId: null },
        name: input.name,
        repository: input.repository,
        now: new Date(),
      });
    } else if (input.kind === "version") {
      await createWorkerImageVersion({
        sourceId: input.sourceId,
        scope: { ownerType: "platform", companyId: null },
        tag: input.tag,
        digest: input.digest,
        now: new Date(),
      });
    } else {
      await setWorkerImageVersionStatus({
        versionId: input.versionId,
        status: input.status,
        scope: { ownerType: "platform", companyId: null },
        now: new Date(),
      });
    }
    revalidatePath("/settings/admin");
    return { ok: true };
  } catch (error) {
    return { ok: false, formError: error instanceof Error ? error.message : "Worker 镜像目录保存失败" };
  }
}

export async function updateWorkbenchCompanyProfileAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();
  const companyId = getTrimmedString(formData, "companyId");

  if (!companyId) {
    return { ok: false, formError: "公司不存在" };
  }

  try {
    await updateWorkbenchCompanyProfile({
      userId: context.userId,
      companyId,
      description: getTrimmedString(formData, "description"),
      certificationLevel: getTrimmedString(formData, "certificationLevel"),
      ...(formData.has("logoUrl") ? { logoUrl: getTrimmedString(formData, "logoUrl") } : {}),
    });
    revalidatePath(`/companies/${companyId}`);
    revalidatePath("/settings/companies");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      formError: error instanceof Error ? error.message : "公司资料保存失败",
    };
  }
}

export async function inviteWorkbenchCompanyMemberAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();
  const companyId = getTrimmedString(formData, "companyId");

  try {
    await inviteWorkbenchCompanyMember({
      userId: context.userId,
      companyId,
      email: getTrimmedString(formData, "email"),
      role: getTrimmedString(formData, "role"),
    });

    revalidateTag(buildWorkbenchCompanyFiltersCacheTag(context.userId), "max");
    revalidatePath(`/companies/${companyId}`);
    revalidatePath(`/companies/${companyId}/members`);
    return { ok: true };
  } catch (error) {
    return { ok: false, formError: error instanceof Error ? error.message : "成员邀请失败" };
  }
}

export async function updateWorkbenchCompanyMemberRoleAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();
  const companyId = getTrimmedString(formData, "companyId");

  try {
    await updateWorkbenchCompanyMemberRole({
      userId: context.userId,
      companyId,
      memberId: getTrimmedString(formData, "memberId"),
      role: getTrimmedString(formData, "role"),
    });

    revalidateTag(buildWorkbenchCompanyFiltersCacheTag(context.userId), "max");
    revalidatePath(`/companies/${companyId}`);
    revalidatePath(`/companies/${companyId}/members`);
    return { ok: true };
  } catch (error) {
    return { ok: false, formError: error instanceof Error ? error.message : "成员角色更新失败" };
  }
}

export async function removeWorkbenchCompanyMemberAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();
  const companyId = getTrimmedString(formData, "companyId");

  try {
    await removeWorkbenchCompanyMember({
      userId: context.userId,
      companyId,
      memberId: getTrimmedString(formData, "memberId"),
    });

    revalidateTag(buildWorkbenchCompanyFiltersCacheTag(context.userId), "max");
    revalidatePath(`/companies/${companyId}`);
    revalidatePath(`/companies/${companyId}/members`);
    return { ok: true };
  } catch (error) {
    return { ok: false, formError: error instanceof Error ? error.message : "成员移除失败" };
  }
}

export async function transferWorkbenchCompanyOwnershipAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();
  const companyId = getTrimmedString(formData, "companyId");

  try {
    await transferWorkbenchCompanyOwnership({
      userId: context.userId,
      companyId,
      targetMemberId: getTrimmedString(formData, "targetMemberId"),
    });

    revalidateTag(buildWorkbenchCompanyFiltersCacheTag(context.userId), "max");
    revalidatePath(`/companies/${companyId}`);
    revalidatePath(`/companies/${companyId}/members`);
    return { ok: true };
  } catch (error) {
    return { ok: false, formError: error instanceof Error ? error.message : "owner 转移失败" };
  }
}

export async function updateWorkbenchCompanyMailSettingsAction(
  _previousState: WorkbenchSettingsActionState,
  formData: FormData,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();
  const companyId = getTrimmedString(formData, "companyId");

  try {
    await updateWorkbenchCompanyMailSettings({
      userId: context.userId,
      companyId,
      emailHost: getTrimmedString(formData, "emailHost"),
      emailPort: getTrimmedString(formData, "emailPort"),
      emailUsername: getTrimmedString(formData, "emailUsername"),
      ...(getTrimmedString(formData, "emailPassword")
        ? { emailPassword: getTrimmedString(formData, "emailPassword") }
        : {}),
    });
    revalidatePath(`/companies/${companyId}/integrations`);
    return { ok: true };
  } catch (error) {
    return { ok: false, formError: error instanceof Error ? error.message : "邮件设置保存失败" };
  }
}

export async function setWorkbenchDeviceAuthorizationAction(formData: FormData) {
  const context = await loadWorkbenchContext();
  const deviceId = getTrimmedString(formData, "deviceId");
  const mode = getTrimmedString(formData, "mode");

  if (!deviceId) {
    throw new Error("Device ID is required");
  }

  if (mode !== "authorize" && mode !== "revoke") {
    throw new Error("Unsupported device authorization mode");
  }

  await setWorkbenchDeviceAuthorization({
    teamId: context.teamId,
    deviceId,
    isAuthorized: mode === "authorize",
  });

  revalidatePath(WORKBENCH_DASHBOARD_PATH);
  revalidatePath("/settings/devices");
}

export interface IssueWorkbenchMcpCredentialState {
  ok: boolean;
  credential?: {
    credentialId: string;
    userId: string;
    name: string;
  };
  token?: string;
  error?: string;
}

export async function issueWorkbenchMcpCredentialAction(
  _previousState: IssueWorkbenchMcpCredentialState | null,
  formData: FormData,
): Promise<IssueWorkbenchMcpCredentialState> {
  const context = await loadWorkbenchContext();

  try {
    const credential = await issueMcpCredential({
      userId: context.userId,
      name: getTrimmedString(formData, "name") || "Codex",
    });

    revalidatePath("/settings/mcp");

    return {
      ok: true,
      credential: {
        credentialId: credential.credentialId,
        userId: credential.userId,
        name: credential.name,
      },
      token: credential.token,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "MCP credential issue failed",
    };
  }
}

export async function revokeWorkbenchMcpCredentialAction(
  credentialId: string,
): Promise<WorkbenchSettingsActionState> {
  const context = await loadWorkbenchContext();

  if (!credentialId.trim()) {
    return { ok: false, formError: "MCP 凭据不存在" };
  }

  try {
    await revokeWorkbenchMcpCredential({
      userId: context.userId,
      credentialId,
    });
    revalidatePath("/settings/mcp");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      formError: error instanceof Error ? error.message : "MCP 凭据撤销失败",
    };
  }
}
