import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { AGENT_STATE_STORAGE_KEY } from "./lib/binding";

function persistInstallProfile(input: {
  appearance?: "light" | "hybrid" | "dark";
  lastSuccessfulRoute?: string;
}) {
  window.localStorage.setItem(
    AGENT_STATE_STORAGE_KEY,
    JSON.stringify({
      version: 2,
      installProfile: {
        installationId: "install_1",
        defaultDeviceName: "agent-macbook",
        appearance: input.appearance ?? "light",
        lastSuccessfulRoute: input.lastSuccessfulRoute ?? "/dashboard",
        createdAt: "2026-07-27T00:00:00.000Z",
        lastUsedAt: "2026-07-27T00:00:00.000Z",
      },
      activeSessionKey: null,
      accountSessions: {},
    }),
  );
}

function successfulDesktopFetch(input: RequestInfo | URL): Promise<Response> {
  const pathname = new URL(String(input)).pathname;
  if (pathname === "/api/desktop/session") {
    return Promise.resolve(Response.json({
      ok: true,
      data: {
        accessToken: "access_1",
        accessExpiresAt: "2026-07-27T08:15:00.000Z",
        refreshToken: "refresh_1",
        sessionId: "desktop_session_1",
        user: {
          id: "user_1",
          email: "owner@example.com",
          name: "Owner",
          avatarUrl: null,
        },
        device: {
          id: "device-agent-macbook",
          status: "authorized",
          deviceToken: "device_1",
        },
      },
    }));
  }
  if (pathname === "/api/desktop/projects/project_1") {
    return Promise.resolve(Response.json({
      ok: true,
      data: {
        detail: {
          project: {
            id: "project_1", name: "Atlas", spaceLabel: "个人空间", objective: null,
            owner: { id: "user_1", name: "Owner" }, status: "active", health: "healthy",
            progress: { completed: 0, total: 0, percent: 0 },
            taskCounts: { open: 0, overdue: 0, blocked: 0 }, nextMilestone: null,
            updatedAt: "2026-07-27T08:00:00.000Z", description: null, startAt: null,
            targetAt: null, visibility: "private",
            capabilities: { edit: true, manageMembers: true, changeLifecycle: true, manageRoadmap: true, nativeWorkspace: false },
          },
          health: { objectiveState: "missing", currentStageName: null, nextAction: "补充项目目标", blockers: 0, overdueTasks: 0 },
          resources: { documents: 0, members: 1, activities: 0, automationState: "未自动化" },
          taskSummary: { total: 0, open: 0, overdue: 0, blocked: 0, completed: 0 },
          roadmap: [], tasks: [], documents: [], risks: [], agents: [],
          workspace: null,
        },
      },
    }));
  }
  return Promise.resolve(Response.json({
    ok: true,
    data: {
      spaces: [{ key: "personal", kind: "personal", name: "个人空间" }],
      activeSpaceKey: "personal",
      currentTask: null,
      capabilities: { nativeExecution: true },
    },
  }));
}

describe("desktop app authentication", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "#/");
    delete document.documentElement.dataset.appearance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with the desktop login and reveals private deployment on demand", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByLabelText("登录邮箱")).toBeInTheDocument();
    expect(screen.getByLabelText("登录密码")).toBeInTheDocument();
    expect(screen.queryByLabelText("部署地址")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "使用私有部署" }));
    expect(screen.getByLabelText("部署地址")).toBeInTheDocument();
  });

  it("mounts the restored authenticated route only after login and bootstrap", async () => {
    const user = userEvent.setup();
    persistInstallProfile({ lastSuccessfulRoute: "/projects/project_1" });
    vi.stubGlobal("fetch", vi.fn(successfulDesktopFetch));
    render(<App />);

    expect(window.location.hash).toBe("#/projects/project_1");
    await user.type(screen.getByLabelText("登录邮箱"), "owner@example.com");
    await user.type(screen.getByLabelText("登录密码"), "correct-password");
    await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));

    expect(await screen.findByRole("heading", { name: "Atlas" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByLabelText("当前空间")).toHaveValue("personal");
    expect(screen.getByRole("button", { name: "全局搜索" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "快速新建" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "账号菜单：Owner" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "本地执行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开执行面板" })).not.toBeInTheDocument();
  });

  it("routes a first-time installation to onboarding after login", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(successfulDesktopFetch));
    render(<App />);

    await user.type(screen.getByLabelText("登录邮箱"), "owner@example.com");
    await user.type(screen.getByLabelText("登录密码"), "correct-password");
    await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));

    expect(await screen.findByRole("heading", { name: "登录与设备身份" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/onboarding");
  });

  it("restores the installation appearance before authentication", async () => {
    persistInstallProfile({ appearance: "dark" });

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.appearance).toBe("dark");
    });
    expect(screen.getByLabelText("登录邮箱")).toBeInTheDocument();
  });

  it("signs out from the account menu and clears the active session pointer", async () => {
    const user = userEvent.setup();
    persistInstallProfile({ lastSuccessfulRoute: "/dashboard" });
    const persistedProfile = JSON.parse(
      window.localStorage.getItem(AGENT_STATE_STORAGE_KEY) ?? "null",
    );
    persistedProfile.installProfile.onboardingSkipped = true;
    window.localStorage.setItem(AGENT_STATE_STORAGE_KEY, JSON.stringify(persistedProfile));
    vi.stubGlobal("fetch", vi.fn(successfulDesktopFetch));
    render(<App />);

    await user.type(screen.getByLabelText("登录邮箱"), "owner@example.com");
    await user.type(screen.getByLabelText("登录密码"), "correct-password");
    await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));
    await screen.findByRole("heading", { name: "首页" });

    await user.click(screen.getByRole("button", { name: "账号菜单：Owner" }));
    expect(screen.getByRole("menu")).toHaveTextContent("owner@example.com");
    await user.click(screen.getByRole("menuitem", { name: "退出桌面账号" }));

    expect(await screen.findByLabelText("登录邮箱")).toBeInTheDocument();
    const persisted = JSON.parse(
      window.localStorage.getItem(AGENT_STATE_STORAGE_KEY) ?? "null",
    );
    expect(persisted.activeSessionKey).toBeNull();
  });
});
