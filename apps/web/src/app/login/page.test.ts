import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dynamic } from "./page";
import { normalizeWorkbenchRedirectPath } from "../../lib/workbench/workbench-auth-guard";
import { loginWorkbenchAction } from "../workbench/actions";
import {
  LOGIN_ERROR_LABEL,
  LOGIN_DEFAULT_REDIRECT_TO,
  LOGIN_REGISTER_HREF,
  LOGIN_EMAIL_PLACEHOLDER,
  LOGIN_SURFACE_COPY,
  default as LoginPage,
} from "./page";

const cookieGet = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
const resolveWorkbenchSession = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: cookieGet }) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../../lib/workbench/workbench-session", () => ({
  hasWorkbenchAuthenticationCookie: (getCookieValue: (name: string) => string | undefined) => Boolean(
    getCookieValue("ht_workbench_session") || getCookieValue("ht_workbench_login_email"),
  ),
  resolveWorkbenchSession,
}));

describe("Login page", () => {
  beforeEach(() => {
    cookieGet.mockReset();
    redirect.mockReset();
    resolveWorkbenchSession.mockReset();
  });

  it("forces dynamic rendering so cookies can decide whether to redirect", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses shared authentication contracts", () => {
    expect(typeof loginWorkbenchAction).toBe("function");
    expect(normalizeWorkbenchRedirectPath("https://evil.example")).toBe("/");
    expect(LOGIN_DEFAULT_REDIRECT_TO).toBe("/dashboard");
    expect(LOGIN_REGISTER_HREF).toBe("/register?redirectTo=%2Fdashboard");
  });

  it("keeps login focused on credentials and Space-safe sessions", () => {
    expect(LOGIN_SURFACE_COPY).toEqual({
      title: "登录 HumanThread",
      note: "会话只在当前账号与可访问 Space 内生效。",
    });
    expect(LOGIN_ERROR_LABEL).toBe("登录失败");
    expect(LOGIN_EMAIL_PLACEHOLDER).toBe("请输入登录邮箱");
  });

  it("renders anonymously without resolving database-backed session context", async () => {
    cookieGet.mockReturnValue(undefined);

    const markup = renderToStaticMarkup(await LoginPage({}));

    expect(markup).toContain("登录 HumanThread");
    expect(resolveWorkbenchSession).not.toHaveBeenCalled();
  });
});
