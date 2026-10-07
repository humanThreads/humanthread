import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createWorkbenchWorkflow,
  performWorkbenchTaskAction,
} from "../../lib/workbench/workbench-actions";
import { createWorkbenchSpaceDocument } from "../../lib/workbench/workbench-documents";
import { reportAgentTaskEvent } from "../../lib/agent/agent-events";
import { setWorkbenchDeviceAuthorization } from "../../lib/workbench/workbench-device-actions";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchProjectDetail } from "../../lib/workbench/workbench-projects";
import {
  updateWorkbenchCompanyMailSettings,
  updateWorkbenchCompanyProfile,
} from "../../lib/workbench/workbench-settings";
import { updateWorkbenchSiteSettings } from "../../lib/workbench/workbench-site-settings";
import {
  changeWorkbenchPasswordAction,
  createWorkbenchCompanyAction,
  createWorkbenchSpaceDocumentAction,
  createWorkbenchWorkflowAction,
  issueWorkbenchMcpCredentialAction,
  logoutWorkbenchAction,
  revokeWorkbenchWebSessionAction,
  openWorkbenchLocalAction,
  loginWorkbenchAction,
  registerWorkbenchAction,
  setWorkbenchSpaceAction,
  switchWorkbenchSpaceAction,
  setWorkbenchDeviceAuthorizationAction,
  setWorkbenchUserAction,
  submitWorkbenchTaskAction,
  updateWorkbenchCompanyMailSettingsAction,
  updateWorkbenchCompanyProfileAction,
  updateWorkbenchSiteSettingsAction,
} from "./actions";
import { resolveWorkbenchSession } from "../../lib/workbench/workbench-session";
import { createWorkbenchLoginSession } from "../../lib/workbench/workbench-login-session";
import { registerWorkbenchUser } from "../../lib/workbench/workbench-registration";
import { issueMcpCredential } from "../../lib/mcp/mcp-auth";
import { revokeWebSession } from "../../lib/workbench/web-session-store";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const { cookieSet } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    set: cookieSet,
  }),
  headers: vi.fn().mockResolvedValue(new Headers({ host: "localhost:3000" })),
}));

vi.mock("../../lib/workbench/workbench-actions", () => ({
  createWorkbenchWorkflow: vi.fn().mockResolvedValue({
    workflow: {
      id: "workflow_1",
    },
    tasks: [],
  }),
  performWorkbenchTaskAction: vi.fn().mockResolvedValue({
    ok: true,
  }),
}));

vi.mock("../../lib/agent/agent-events", () => ({
  reportAgentTaskEvent: vi.fn().mockResolvedValue({
    event: {
      id: "workflow_1:run_cli:local_opened:1",
      type: "local_opened",
    },
    localDevice: {
      id: "device_web_fallback",
    },
  }),
}));

vi.mock("../../lib/workbench/workbench-device-actions", () => ({
  setWorkbenchDeviceAuthorization: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/workbench/workbench-companies", () => ({
  buildWorkbenchCompanyFiltersCacheTag: vi
    .fn()
    .mockImplementation((userId: string) => `workbench:company-filters:${userId}`),
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    {
      key: "all",
      label: "全部",
      companyId: null,
      ownerType: null,
    },
    {
      key: "personal",
      label: "个人空间",
      companyId: null,
      ownerType: "personal",
    },
    {
      key: "company_1",
      label: "HumanThread Company",
      companyId: "company_1",
      ownerType: "company",
    },
  ]),
}));

vi.mock("../../lib/workbench/workbench-projects", () => ({
  getWorkbenchProjectDetail: vi.fn().mockResolvedValue({
    id: "project_1",
    name: "HumanThread",
    description: null,
    ownerType: "personal",
    visibility: "private",
    localPath: "/repo",
    defaultCommand: "codex",
    updatedAt: new Date("2026-05-28T09:00:00.000Z"),
    company: null,
    ownerUser: {
      id: "user_owner",
      name: "Owner",
    },
    activeWorkflowCount: 1,
    activeWorkflows: [],
    recentTasks: [],
  }),
}));

vi.mock("../../lib/workbench/workbench-documents", () => ({
  createWorkbenchSpaceDocument: vi.fn().mockResolvedValue({
    id: "doc_root",
    version: 1,
  }),
}));

vi.mock("../../lib/workbench/workbench-context", () => ({
  WORKBENCH_LOGIN_EMAIL_COOKIE: "ht_workbench_login_email",
  WORKBENCH_USER_COOKIE: "ht_workbench_user_id",
}));

vi.mock("../../lib/workbench/workbench-login-session", () => ({
  createWorkbenchLoginSession: vi.fn().mockResolvedValue({
    email: "alice@example.com",
    webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }),
}));

vi.mock("../../lib/workbench/workbench-registration", () => ({
  registerWorkbenchUser: vi.fn().mockResolvedValue({
    userId: "user_1",
    email: "alice@example.com",
    name: "Alice",
    personalProjectId: "project_user_1_personal",
  }),
}));

vi.mock("../../lib/workbench/web-session-store", () => ({
  revokeWebSession: vi.fn(),
}));

vi.mock("../../lib/workbench/workbench-settings", () => ({
  buildWorkbenchAccountSettingsCacheTag: vi
    .fn()
    .mockImplementation((userId: string) => `workbench:account:${userId}`),
  changeWorkbenchPassword: vi.fn().mockResolvedValue(undefined),
  createWorkbenchCompany: vi.fn().mockResolvedValue({
    company: {
      id: "company_1",
      name: "HumanThread Company",
      slug: "humanthread-company",
      status: "active",
      description: null,
      logoUrl: null,
      certificationLevel: "none",
      emailHost: null,
      emailPort: null,
      emailUsername: null,
      emailPassword: null,
    },
    membership: {
      id: "company_1:user_owner",
      role: "owner",
      status: "active",
    },
  }),
  inviteWorkbenchCompanyMember: vi.fn().mockResolvedValue(undefined),
  removeWorkbenchCompanyMember: vi.fn().mockResolvedValue(undefined),
  updateWorkbenchCompanyMemberRole: vi.fn().mockResolvedValue(undefined),
  updateWorkbenchCompanyMailSettings: vi.fn().mockResolvedValue(undefined),
  updateWorkbenchCompanyProfile: vi.fn().mockResolvedValue(undefined),
  transferWorkbenchCompanyOwnership: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/workbench/workbench-site-settings", () => ({
  updateWorkbenchSiteSettings: vi.fn().mockResolvedValue({
    siteBaseUrl: "http://localhost:3000",
    mcpUrl: "http://localhost:3000/api/mcp",
  }),
}));

vi.mock("../../lib/mcp/mcp-auth", () => ({
  issueMcpCredential: vi.fn().mockResolvedValue({
    credentialId: "mcp_cred_1",
    userId: "user_owner",
    name: "Codex",
    token: "ht_mcp_token_123",
  }),
}));

vi.mock("../../lib/workbench/workbench-space-filters", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/workbench/workbench-space-filters")
  >("../../lib/workbench/workbench-space-filters");

  return {
    ...actual,
    WORKBENCH_SPACE_COOKIE: "ht_workbench_space",
  };
});

vi.mock("../../lib/workbench/workbench-session", () => ({
  resolveWorkbenchSession: vi.fn().mockResolvedValue({
    selectedUserId: null,
    loginEmail: "owner@example.com",
    webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    context: {
      teamId: "team_1",
      userId: "user_owner",
      projectId: "project_1",
      matterTypeId: "matter_dev",
    },
  }),
}));

describe("workbench server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a workbench workflow from form data and revalidates the dashboard page", async () => {
    const formData = new FormData();
    formData.set("title", "  实现登录页  ");
    formData.set("description", "  完成登录页和基础校验。  ");
    formData.set("spaceKey", "company_1");

    await createWorkbenchWorkflowAction(formData);

    expect(createWorkbenchWorkflow).toHaveBeenCalledWith({
      title: "实现登录页",
      description: "完成登录页和基础校验。",
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_dev",
      },
    });
    expect(resolveWorkbenchSession).toHaveBeenCalledWith({
      getCookieValue: expect.any(Function),
      companyId: "company_1",
      ownerType: "company",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("creates a root document with the authenticated actor and redirects to detail", async () => {
    const formData = new FormData();
    formData.set("spaceId", "space:company:company_1");
    formData.set("title", "Policy");
    formData.set("path", "policy.md");
    formData.set("contentMarkdown", "# Policy");
    formData.set("userId", "user_attacker");

    await createWorkbenchSpaceDocumentAction(formData);

    expect(createWorkbenchSpaceDocument).toHaveBeenCalledWith({
      spaceId: "space:company:company_1",
      userId: "user_owner",
      title: "Policy",
      path: "policy.md",
      contentMarkdown: "# Policy",
      source: "web",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/documents");
    expect(redirect).toHaveBeenCalledWith("/documents/doc_root");
  });

  it("supports selecting a project and immediately starting the created task", async () => {
    vi.mocked(createWorkbenchWorkflow).mockResolvedValueOnce({
      workflow: {
        id: "workflow_2",
      },
      tasks: [
        {
          id: "workflow_2:confirm_requirement",
        },
      ],
    } as Awaited<ReturnType<typeof createWorkbenchWorkflow>>);

    const formData = new FormData();
    formData.set("title", "联调支付回调");
    formData.set("description", "补齐沙箱凭据后开始联调。");
    formData.set("spaceKey", "company_1");
    formData.set("projectId", "project_2");
    formData.set("startImmediately", "on");

    await createWorkbenchWorkflowAction(formData);

    expect(getWorkbenchProjectDetail).toHaveBeenCalledWith({
      projectId: "project_2",
      userId: "user_owner",
    });
    expect(createWorkbenchWorkflow).toHaveBeenCalledWith({
      title: "联调支付回调",
      description: "补齐沙箱凭据后开始联调。",
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_2",
        matterTypeId: "matter_dev",
      },
    });
    expect(performWorkbenchTaskAction).toHaveBeenCalledWith({
      taskId: "workflow_2:confirm_requirement",
      actionType: "start",
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_2",
        matterTypeId: "matter_dev",
      },
    });
  });

  it("serializes quick-create metadata into the workflow description", async () => {
    const formData = new FormData();
    formData.set("title", "联调支付回调");
    formData.set("description", "补齐沙箱凭据后开始联调。");
    formData.set("phase", "验证中");
    formData.set("priority", "high");
    formData.set("dueAt", "2026-06-03T18:30");
    formData.set("acceptanceCriteria", "支付沙箱可用\n回调验收通过");

    await createWorkbenchWorkflowAction(formData);

    expect(createWorkbenchWorkflow).toHaveBeenCalledWith({
      title: "联调支付回调",
      description: [
        "补齐沙箱凭据后开始联调。",
        "",
        "阶段：验证中",
        "优先级：高",
        "截止时间：2026-06-03 18:30",
        "验收标准：",
        "- 支付沙箱可用",
        "- 回调验收通过",
      ].join("\n"),
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_dev",
      },
    });
  });

  it("submits a task action from form data and revalidates the dashboard page", async () => {
    const formData = new FormData();
    formData.set("taskId", "workflow_1:run_cli");
    formData.set("actionType", "transfer");
    formData.set("reason", "  转给同组同学继续处理  ");
    formData.set("targetUserId", "  user_peer  ");

    await submitWorkbenchTaskAction(formData);

    expect(performWorkbenchTaskAction).toHaveBeenCalledWith({
      taskId: "workflow_1:run_cli",
      actionType: "transfer",
      reason: "转给同组同学继续处理",
      targetUserId: "user_peer",
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_dev",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects unsupported action types", async () => {
    const formData = new FormData();
    formData.set("taskId", "workflow_1:run_cli");
    formData.set("actionType", "unknown");

    await expect(submitWorkbenchTaskAction(formData)).rejects.toThrow(
      "Unsupported action type",
    );
  });

  it("reports a local_opened event from the workbench and revalidates the dashboard page", async () => {
    const formData = new FormData();
    formData.set("taskId", "workflow_1:run_cli");
    formData.set("projectPath", "/Users/alice/IdeaProjects/humanThread");
    formData.set("command", "codex");

    await openWorkbenchLocalAction(formData);

    expect(resolveWorkbenchSession).toHaveBeenCalledTimes(1);
    expect(reportAgentTaskEvent).toHaveBeenCalledWith({
      taskId: "workflow_1:run_cli",
      actorUserId: "user_owner",
      actorTeamId: "team_1",
      eventType: "local_opened",
      message: "从 Web 工作台触发打开本地",
      localDevice: {
        id: "device_web_fallback",
        name: "web-workbench",
        platform: "web",
      },
      payload: {
        cwd: "/Users/alice/IdeaProjects/humanThread",
        command: "codex",
        source: "web_workbench",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("stores the selected workbench user in a cookie and revalidates the dashboard page", async () => {
    const formData = new FormData();
    formData.set("userId", "  user_peer  ");

    await setWorkbenchUserAction(formData);

    expect(cookies).toHaveBeenCalledTimes(1);
    expect(cookieSet).toHaveBeenCalledWith("ht_workbench_user_id", "user_peer", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("stores a signed session cookie and clears legacy login cookies", async () => {
    const formData = new FormData();
    formData.set("email", "  alice@example.com  ");
    formData.set("password", " correct-password ");
    formData.set("redirectTo", "/projects");

    await loginWorkbenchAction(formData);

    expect(createWorkbenchLoginSession).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "correct-password",
      cookieStore: expect.objectContaining({
        set: expect.any(Function),
      }),
      request: expect.any(Request),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(redirect).toHaveBeenCalledWith("/projects");
  });

  it("normalizes unsafe login redirects back to the dashboard", async () => {
    const formData = new FormData();
    formData.set("email", "alice@example.com");
    formData.set("password", "correct-password");
    formData.set("redirectTo", "https://evil.example");

    await loginWorkbenchAction(formData);

    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("registers a workbench account and redirects to the requested workbench page", async () => {
    const formData = new FormData();
    formData.set("name", " Alice ");
    formData.set("email", " Alice@Example.com ");
    formData.set("password", " correct-password ");
    formData.set("verificationCode", "123456");
    formData.set("redirectTo", "/projects");

    await registerWorkbenchAction(formData);

    expect(registerWorkbenchUser).toHaveBeenCalledWith({
      name: "Alice",
      email: "alice@example.com",
      password: "correct-password",
      verificationCode: "123456",
      cookieStore: expect.objectContaining({
        set: expect.any(Function),
      }),
      request: expect.any(Request),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(redirect).toHaveBeenCalledWith("/projects");
  });

  it("redirects incomplete login submissions back to the login page", async () => {
    vi.mocked(createWorkbenchLoginSession).mockRejectedValueOnce(
      new Error("Password is required"),
    );
    const formData = new FormData();
    formData.set("email", "alice@example.com");

    await loginWorkbenchAction(formData);

    expect(createWorkbenchLoginSession).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "",
      cookieStore: expect.objectContaining({
        set: expect.any(Function),
      }),
      request: expect.any(Request),
    });
    expect(revalidatePath).not.toHaveBeenCalledWith("/dashboard");
    expect(redirect).toHaveBeenCalledWith(
      "/login?error=invalid-credentials&redirectTo=%2Fdashboard",
    );
    expect(cookieSet).not.toHaveBeenCalledWith(
      "ht_workbench_session",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("redirects login failures back to the login page with a visible error", async () => {
    vi.mocked(createWorkbenchLoginSession).mockRejectedValueOnce(
      new Error("Workbench login credentials are invalid"),
    );
    const formData = new FormData();
    formData.set("email", "alice@example.com");
    formData.set("password", "wrong-password");
    formData.set("redirectTo", "/projects");

    await loginWorkbenchAction(formData);

    expect(revalidatePath).not.toHaveBeenCalledWith("/dashboard");
    expect(redirect).toHaveBeenCalledWith(
      "/login?error=invalid-credentials&redirectTo=%2Fprojects",
    );
  });

  it("redirects duplicate registration back to the register page with a visible error", async () => {
    vi.mocked(registerWorkbenchUser).mockRejectedValueOnce(
      new Error("Workbench account already exists"),
    );
    const formData = new FormData();
    formData.set("name", "Alice");
    formData.set("email", "alice@example.com");
    formData.set("password", "correct-password");
    formData.set("redirectTo", "/projects");

    await registerWorkbenchAction(formData);

    expect(revalidatePath).not.toHaveBeenCalledWith("/dashboard");
    expect(redirect).toHaveBeenCalledWith(
      "/register?error=account-exists&redirectTo=%2Fprojects",
    );
  });

  it("revokes the current Web session and clears all login cookies on logout", async () => {
    await logoutWorkbenchAction();

    expect(revokeWebSession).toHaveBeenCalledWith({
      userId: "user_owner",
      targetSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      reason: "user_logout",
    });

    expect(cookieSet).toHaveBeenCalledWith("ht_workbench_login_email", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    expect(cookieSet).toHaveBeenCalledWith("ht_workbench_session", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    expect(cookieSet).toHaveBeenCalledWith("ht_workbench_user_id", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    expect(cookieSet).toHaveBeenCalledWith("ht_web_session", "", expect.objectContaining({ maxAge: 0 }));
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("still clears local authentication cookies when the database session is unavailable", async () => {
    vi.mocked(resolveWorkbenchSession).mockRejectedValueOnce(new Error("database unavailable"));

    await logoutWorkbenchAction();

    expect(revokeWebSession).not.toHaveBeenCalled();
    expect(cookieSet).toHaveBeenCalledWith("ht_web_session", "", expect.objectContaining({ maxAge: 0 }));
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("remotely revokes another owned Web session", async () => {
    const formData = new FormData();
    formData.set("webSessionId", "b".repeat(32));
    await expect(revokeWorkbenchWebSessionAction({ ok: false }, formData))
      .resolves.toEqual({ ok: true });
    expect(revokeWebSession).toHaveBeenCalledWith({
      userId: "user_owner",
      targetSessionId: "b".repeat(32),
      reason: "remote_logout",
    });
  });

  it("refuses to remotely revoke the current Web session", async () => {
    const formData = new FormData();
    formData.set("webSessionId", "a".repeat(32));
    await expect(revokeWorkbenchWebSessionAction({ ok: false }, formData))
      .resolves.toEqual({ ok: false, formError: "当前设备请使用退出登录" });
    expect(revokeWebSession).not.toHaveBeenCalled();
  });

  it("stores the selected workbench space and revalidates workbench pages", async () => {
    const formData = new FormData();
    formData.set("spaceKey", " company_1 ");

    const result = await switchWorkbenchSpaceAction(formData);

    expect(result).toEqual({ ok: true });
    expect(resolveWorkbenchSession).toHaveBeenCalledTimes(1);
    expect(getWorkbenchCompanyFilters).toHaveBeenCalledWith({
      userId: "user_owner",
    });
    expect(cookieSet).toHaveBeenCalledWith("ht_workbench_space", "company_1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/team");
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/documents");
  });

  it("returns a visible validation error when no workbench space is selected", async () => {
    const result = await switchWorkbenchSpaceAction(new FormData());

    expect(result).toEqual({
      ok: false,
      error: "请选择工作空间",
    });
    expect(resolveWorkbenchSession).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalledWith(
      "ht_workbench_space",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("revalidates company filter cache after creating a company", async () => {
    const { createWorkbenchCompany } = await import(
      "../../lib/workbench/workbench-settings"
    );
    vi.mocked(createWorkbenchCompany).mockResolvedValue({
      company: {
        id: "company_2",
        name: "Beta",
        slug: "beta",
        status: "active",
        description: null,
        logoUrl: null,
        certificationLevel: "none",
        emailHost: null,
        emailPort: null,
        emailUsername: null,
        emailPassword: null,
      },
      membership: {
        id: "company_2:user_owner",
        role: "owner",
        status: "active",
      },
    });

    const formData = new FormData();
    formData.set("name", "Beta");

    const state = await createWorkbenchCompanyAction({ ok: false }, formData);

    expect(revalidateTag).toHaveBeenCalledWith(
      "workbench:company-filters:user_owner",
      "max",
    );
    expect(state).toEqual({ ok: true, companyId: "company_2" });
  });

  it("revalidates company filter cache after company member changes", async () => {
    const {
      inviteWorkbenchCompanyMemberAction,
      updateWorkbenchCompanyMemberRoleAction,
      removeWorkbenchCompanyMemberAction,
    } = await import("./actions");
    const inviteFormData = new FormData();
    inviteFormData.set("companyId", "company_1");
    inviteFormData.set("email", "member@example.com");
    inviteFormData.set("role", "member");

    await inviteWorkbenchCompanyMemberAction({ ok: false }, inviteFormData);

    expect(revalidateTag).toHaveBeenCalledWith(
      "workbench:company-filters:user_owner",
      "max",
    );

    const roleFormData = new FormData();
    roleFormData.set("companyId", "company_1");
    roleFormData.set("memberId", "company_1:user_member");
    roleFormData.set("role", "admin");

    await updateWorkbenchCompanyMemberRoleAction({ ok: false }, roleFormData);

    expect(revalidateTag).toHaveBeenCalledWith(
      "workbench:company-filters:user_owner",
      "max",
    );

    const removeFormData = new FormData();
    removeFormData.set("companyId", "company_1");
    removeFormData.set("memberId", "company_1:user_member");

    await removeWorkbenchCompanyMemberAction({ ok: false }, removeFormData);

    expect(revalidateTag).toHaveBeenCalledWith(
      "workbench:company-filters:user_owner",
      "max",
    );
  });

  it("revalidates account cache after password changes", async () => {
    const {
      changeWorkbenchPassword,
    } = await import("../../lib/workbench/workbench-settings");
    vi.mocked(changeWorkbenchPassword).mockResolvedValue({ otherSessionsRevoked: 0 });
    const formData = new FormData();
    formData.set("currentPassword", "old-password");
    formData.set("newPassword", "new-password");
    formData.set("confirmPassword", "new-password");

    await changeWorkbenchPasswordAction(formData);

    expect(revalidateTag).toHaveBeenCalledWith(
      "workbench:account:user_owner",
      "max",
    );
  });

  it("rejects a workbench space outside the current user's accessible filters", async () => {
    const formData = new FormData();
    formData.set("spaceKey", "company_hidden");

    const result = await switchWorkbenchSpaceAction(formData);

    expect(result).toEqual({
      ok: false,
      error: "该工作空间不可用，请刷新后重试",
    });
    expect(cookieSet).not.toHaveBeenCalledWith(
      "ht_workbench_space",
      "company_hidden",
      expect.any(Object),
    );
  });

  it("keeps the legacy form action rejection contract for an unavailable space", async () => {
    const formData = new FormData();
    formData.set("spaceKey", "company_hidden");

    await expect(setWorkbenchSpaceAction(formData)).rejects.toThrow(
      "Workbench space is unavailable for the current user",
    );
  });

  it("updates only company profile fields without mixing SMTP settings", async () => {
    const formData = new FormData();
    formData.set("companyId", "company_1");
    formData.set("description", " HumanThread 工作台 ");
    formData.set("certificationLevel", "normal");

    const state = await updateWorkbenchCompanyProfileAction({ ok: false }, formData);

    expect(updateWorkbenchCompanyProfile).toHaveBeenCalledWith({
      userId: "user_owner",
      companyId: "company_1",
      description: "HumanThread 工作台",
      certificationLevel: "normal",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/companies/company_1");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/companies");
    expect(state).toEqual({ ok: true });
  });

  it("updates company mail settings through the explicit integration route", async () => {
    const formData = new FormData();
    formData.set("companyId", "company_1");
    formData.set("emailHost", " smtp.example.com ");
    formData.set("emailPort", "465");
    formData.set("emailUsername", " noreply@example.com ");
    formData.set("emailPassword", "");

    const state = await updateWorkbenchCompanyMailSettingsAction({ ok: false }, formData);

    expect(updateWorkbenchCompanyMailSettings).toHaveBeenCalledWith({
      userId: "user_owner",
      companyId: "company_1",
      emailHost: "smtp.example.com",
      emailPort: "465",
      emailUsername: "noreply@example.com",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/companies/company_1/integrations");
    expect(state).toEqual({ ok: true });
  });

  it("updates site settings and revalidates site-dependent settings pages", async () => {
    const formData = new FormData();
    formData.set("siteBaseUrl", " http://localhost:3000/ ");

    const state = await updateWorkbenchSiteSettingsAction({ ok: false }, formData);

    expect(updateWorkbenchSiteSettings).toHaveBeenCalledWith({
      userId: "user_owner",
      siteBaseUrl: "http://localhost:3000/",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/mcp");
    expect(revalidatePath).toHaveBeenCalledWith("/downloads");
    expect(state).toEqual({ ok: true });
  });

  it("issues an MCP credential for the current workbench user", async () => {
    const formData = new FormData();
    formData.set("name", " Codex ");

    const result = await issueWorkbenchMcpCredentialAction(null, formData);

    expect(issueMcpCredential).toHaveBeenCalledWith({
      userId: "user_owner",
      name: "Codex",
    });
    expect(result).toEqual({
      ok: true,
      credential: {
        credentialId: "mcp_cred_1",
        userId: "user_owner",
        name: "Codex",
      },
      token: "ht_mcp_token_123",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/mcp");
  });

  it("authorizes a device from the workbench and revalidates the dashboard page", async () => {
    const formData = new FormData();
    formData.set("deviceId", "device_mac_1");
    formData.set("mode", "authorize");

    await setWorkbenchDeviceAuthorizationAction(formData);

    expect(setWorkbenchDeviceAuthorization).toHaveBeenCalledWith({
      teamId: "team_1",
      deviceId: "device_mac_1",
      isAuthorized: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("revalidates device settings after device authorization changes", async () => {
    const formData = new FormData();
    formData.set("deviceId", "device_mac_1");
    formData.set("mode", "authorize");

    await setWorkbenchDeviceAuthorizationAction(formData);

    expect(revalidatePath).toHaveBeenCalledWith("/settings/devices");
  });

  it("revokes a device authorization from the workbench", async () => {
    const formData = new FormData();
    formData.set("deviceId", "device_mac_1");
    formData.set("mode", "revoke");

    await setWorkbenchDeviceAuthorizationAction(formData);

    expect(setWorkbenchDeviceAuthorization).toHaveBeenCalledWith({
      teamId: "team_1",
      deviceId: "device_mac_1",
      isAuthorized: false,
    });
  });
});
