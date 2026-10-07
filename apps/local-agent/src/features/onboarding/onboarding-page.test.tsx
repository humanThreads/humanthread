import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { LocalRuntime } from "../../lib/runtime";
import type { DesktopSessionValue } from "../../session/session-provider";
import { OnboardingPage } from "./onboarding-page";

const browserRuntime: LocalRuntime = {
  platform: "macos",
  isNative: false,
  async openProjectPath() {},
  async openTerminalAtPath() { throw new Error("unavailable"); },
  async launchProjectCommand() { throw new Error("unavailable"); },
  async restoreToolSession() { throw new Error("unavailable"); },
  async validateWorkspaceDirectory() { throw new Error("本地系统动作仅在桌面客户端中可用。"); },
  async probeAgentRuntime() { throw new Error("本地系统动作仅在桌面客户端中可用。"); },
  async installAgentRuntime() { throw new Error("本地系统动作仅在桌面客户端中可用。"); },
  async selectProjectDirectory() { throw new Error("unavailable"); },
  async subscribeCommandExited() { return () => undefined; },
};

function session(client: DesktopSessionValue["client"] = null): DesktopSessionValue {
  return {
    status: "ready",
    error: null,
    user: { id: "user_1", email: "owner@example.com", name: "Owner", avatarUrl: null },
    bootstrap: {
      spaces: [{ key: "personal", kind: "personal", name: "个人空间" }],
      activeSpaceKey: "personal",
      currentTask: null,
      capabilities: { nativeExecution: false },
    },
    context: { deploymentKey: "http://localhost:3000", sessionId: "session_1", spaceKey: "personal" },
    client,
    runtimeCredentials: null,
    localDeviceId: "device_1",
    generation: 1,
    actionsEnabled: true,
    updateRuntimeCredentials: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    switchSpace: vi.fn(),
  };
}

function renderOnboarding(client: DesktopSessionValue["client"] = null) {
  const storage = window.localStorage;
  return render(
    <MemoryRouter>
      <OnboardingPage
        accountSession={null}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
        platform="macos"
        runtime={browserRuntime}
        session={session(client)}
        storage={storage}
      />
    </MemoryRouter>,
  );
}

describe("production OnboardingPage", () => {
  it("shows all eight steps and opens on device identity", () => {
    renderOnboarding();
    expect(screen.getByRole("heading", { name: "登录与设备身份" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入第 8 步" })).toBeInTheDocument();
  });

  it("blocks Workspace verification when the native bridge is unavailable", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole("button", { name: "进入第 2 步" }));
    await user.type(screen.getByLabelText("Workspace 路径"), "/tmp/project");
    await user.click(screen.getByRole("button", { name: "验证 Workspace" }));
    expect(await screen.findByText("未连接正式 Desktop 原生桥接")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "步骤证据" })).getByText("阻塞")).toBeInTheDocument();
  });

  it("cannot finish the final execution step without real evidence", async () => {
    const user = userEvent.setup();
    renderOnboarding({
      request: vi.fn().mockResolvedValue({
        ok: true,
        data: { canManage: false, profiles: [], workers: [], runs: [], loops: [], approvals: [] },
      }),
    } as unknown as DesktopSessionValue["client"]);
    await user.click(screen.getByRole("button", { name: "进入第 8 步" }));
    await user.click(screen.getByRole("button", { name: "检查执行证据" }));
    expect(await screen.findByText("尚未检测到开箱后完成的执行记录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成开箱向导" })).toBeDisabled();
  });
});
