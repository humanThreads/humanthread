import type { WorkbenchSession } from "./workbench-session";

export interface WorkbenchLoginSearchParams {
  redirectTo?: string | string[];
  error?: string | string[];
}

export type WorkbenchAuthErrorCode =
  | "invalid-credentials"
  | "account-exists"
  | "verification-invalid"
  | "verification-sent-too-recently"
  | "smtp-unavailable";

const WORKBENCH_AUTH_ERROR_MESSAGES: Record<WorkbenchAuthErrorCode, string> = {
  "invalid-credentials": "邮箱或密码不正确，请检查后重试。",
  "account-exists": "该邮箱已经注册，请直接登录。",
  "verification-invalid": "邮箱验证码不正确或已过期，请重新获取后再试。",
  "verification-sent-too-recently": "验证码刚刚已发送，请稍后再试。",
  "smtp-unavailable": "邮件服务暂不可用，请稍后再试或联系管理员。",
};

export function isWorkbenchSessionAuthenticated(session: WorkbenchSession): boolean {
  return Boolean(session.loginEmail && session.webSessionId);
}

export function normalizeWorkbenchRedirectPath(value: string | null | undefined): string {
  const trimmed = value?.trim();

  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }

  if (trimmed === "/login" || trimmed.startsWith("/login?")) {
    return "/";
  }

  return trimmed;
}

export function buildWorkbenchLoginHref(requestedPath: string): string {
  const redirectTo = normalizeWorkbenchRedirectPath(requestedPath);

  if (redirectTo === "/") {
    return "/login";
  }

  return `/login?redirectTo=${encodeURIComponent(redirectTo)}`;
}

export function getSingleWorkbenchAuthParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function getWorkbenchAuthErrorMessage(
  value: string | string[] | undefined,
): string | null {
  const code = getSingleWorkbenchAuthParam(value);

  if (
    code === "invalid-credentials" ||
    code === "account-exists" ||
    code === "verification-invalid" ||
    code === "verification-sent-too-recently" ||
    code === "smtp-unavailable"
  ) {
    return WORKBENCH_AUTH_ERROR_MESSAGES[code];
  }

  return null;
}

function buildAuthErrorHref(input: {
  path: "/login" | "/register";
  error: WorkbenchAuthErrorCode;
  redirectTo: string | null | undefined;
}): string {
  const params = new URLSearchParams({
    error: input.error,
  });
  const redirectTo = normalizeWorkbenchRedirectPath(input.redirectTo);

  if (redirectTo !== "/") {
    params.set("redirectTo", redirectTo);
  }

  return `${input.path}?${params.toString()}`;
}

export function buildWorkbenchLoginErrorHref(input: {
  error: WorkbenchAuthErrorCode;
  redirectTo: string | null | undefined;
}): string {
  return buildAuthErrorHref({
    path: "/login",
    error: input.error,
    redirectTo: input.redirectTo,
  });
}

export function buildWorkbenchRegisterErrorHref(input: {
  error: WorkbenchAuthErrorCode;
  redirectTo: string | null | undefined;
}): string {
  return buildAuthErrorHref({
    path: "/register",
    error: input.error,
    redirectTo: input.redirectTo,
  });
}
