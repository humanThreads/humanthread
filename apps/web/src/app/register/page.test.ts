import { describe, expect, it } from "vitest";
import {
  dynamic,
  REGISTER_DEFAULT_REDIRECT_TO,
  REGISTER_ERROR_LABEL,
  REGISTER_PROOF_POINTS,
} from "./page";
import { normalizeWorkbenchRedirectPath } from "../../lib/workbench/workbench-auth-guard";
import { registerWorkbenchAction } from "../workbench/actions";

describe("Register page", () => {
  it("forces dynamic rendering so authenticated visitors can redirect", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the shared workbench registration action", () => {
    expect(typeof registerWorkbenchAction).toBe("function");
  });

  it("normalizes redirect targets before placing them in the registration form", () => {
    expect(normalizeWorkbenchRedirectPath("/projects")).toBe("/projects");
    expect(normalizeWorkbenchRedirectPath("https://evil.example")).toBe("/");
  });

  it("defaults registration redirects to the dashboard", () => {
    expect(REGISTER_DEFAULT_REDIRECT_TO).toBe("/dashboard");
  });

  it("documents that both registration paths create a natural-person account", () => {
    expect(REGISTER_PROOF_POINTS).toContain("两种入口都创建同一种个人账号");
    expect(REGISTER_PROOF_POINTS).toContain("公司是组织，不是登录账号");
    expect(REGISTER_PROOF_POINTS).toContain("以后仍可创建或加入更多公司");
  });

  it("has a visible form error region for duplicate account submissions", () => {
    expect(REGISTER_ERROR_LABEL).toBe("注册失败");
  });

  it("requires email verification before account creation", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(await (await import("./page")).default({}));

    expect(markup).toContain("邮箱验证码");
    expect(markup).toContain("发送验证码");
    expect(markup).toContain('name="verificationCode"');
    expect(markup).toContain("注册并进入工作台");
  });

  it("offers separate personal-use and create-company registration choices", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(await (await import("./page")).default({}));

    expect(markup).toContain("个人使用");
    expect(markup).toContain("创建公司");
    expect(markup).toContain('name="accountType"');
    expect(markup).toContain('value="personal"');
    expect(markup).toContain('value="company"');
    expect(markup).toContain('name="companyName"');
  });
});
