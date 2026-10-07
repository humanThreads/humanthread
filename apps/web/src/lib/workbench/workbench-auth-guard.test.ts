import { describe, expect, it } from "vitest";
import {
  buildWorkbenchLoginErrorHref,
  buildWorkbenchRegisterErrorHref,
  buildWorkbenchLoginHref,
  getWorkbenchAuthErrorMessage,
  isWorkbenchSessionAuthenticated,
  normalizeWorkbenchRedirectPath,
} from "./workbench-auth-guard";

describe("workbench auth guard", () => {
  it("treats a resolved database Web session as authenticated", () => {
    expect(
      isWorkbenchSessionAuthenticated({
        loginEmail: "alice@example.com",
        selectedUserId: null,
        webSessionId: "a".repeat(32),
        context: {
          teamId: "team_1",
          userId: "user_owner",
          projectId: "project_1",
          matterTypeId: "matter_dev",
        },
      }),
    ).toBe(true);
  });

  it("does not treat the default or manually selected user as logged in", () => {
    expect(
      isWorkbenchSessionAuthenticated({
        loginEmail: null,
        selectedUserId: "user_owner",
        webSessionId: null,
        context: {
          teamId: "team_1",
          userId: "user_owner",
          projectId: "project_1",
          matterTypeId: "matter_dev",
        },
      }),
    ).toBe(false);
  });

  it("normalizes redirect targets to internal workbench paths only", () => {
    expect(normalizeWorkbenchRedirectPath("/projects/project_1")).toBe(
      "/projects/project_1",
    );
    expect(normalizeWorkbenchRedirectPath("https://evil.example")).toBe("/");
    expect(normalizeWorkbenchRedirectPath("//evil.example")).toBe("/");
    expect(normalizeWorkbenchRedirectPath("/login?redirectTo=/team")).toBe("/");
    expect(normalizeWorkbenchRedirectPath("")).toBe("/");
  });

  it("builds login hrefs that preserve the requested internal page", () => {
    expect(buildWorkbenchLoginHref("/projects/project_1")).toBe(
      "/login?redirectTo=%2Fprojects%2Fproject_1",
    );
    expect(buildWorkbenchLoginHref("/")).toBe("/login");
  });

  it("builds login error hrefs without losing safe redirect targets", () => {
    expect(
      buildWorkbenchLoginErrorHref({
        error: "invalid-credentials",
        redirectTo: "/projects",
      }),
    ).toBe("/login?error=invalid-credentials&redirectTo=%2Fprojects");
  });

  it("builds register error hrefs without forwarding unsafe redirect targets", () => {
    expect(
      buildWorkbenchRegisterErrorHref({
        error: "account-exists",
        redirectTo: "https://evil.example",
      }),
    ).toBe("/register?error=account-exists");
  });

  it("maps workbench auth error codes to user-facing Chinese messages", () => {
    expect(getWorkbenchAuthErrorMessage("invalid-credentials")).toBe(
      "邮箱或密码不正确，请检查后重试。",
    );
    expect(getWorkbenchAuthErrorMessage("account-exists")).toBe(
      "该邮箱已经注册，请直接登录。",
    );
    expect(getWorkbenchAuthErrorMessage("unknown-code")).toBeNull();
  });
});
