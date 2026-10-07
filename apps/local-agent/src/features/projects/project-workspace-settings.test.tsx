import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LocalExecutionConfigStore } from "../../desktop/execution-config-store";
import type { LocalRuntime } from "../../lib/runtime";
import { ProjectWorkspaceSettings } from "./project-workspace-settings";

const configuredWorkspace = {
  projectId: "project_1",
  absolutePath: "/Users/alice/Atlas",
  realpath: "/Users/alice/Atlas",
  configurationVersion: 1,
  pathFingerprint: "hmac-sha256:localfingerprint",
};

function createStore(
  workspace: typeof configuredWorkspace | null = null,
): LocalExecutionConfigStore {
  return {
    getWorkspace: vi.fn().mockResolvedValue(workspace),
    getWorkspaceByBindingId: vi.fn().mockResolvedValue(workspace),
    setWorkspace: vi.fn().mockResolvedValue(configuredWorkspace),
    removeWorkspace: vi.fn().mockResolvedValue(undefined),
    getRuntime: vi.fn().mockResolvedValue(null),
    upsertRuntime: vi.fn(),
    disableRuntime: vi.fn(),
    rotateInstallationKey: vi.fn(),
    getWorkerPreferences: vi.fn().mockResolvedValue({ enabled: true, maxConcurrency: 1 }),
  setWorkerPreferences: vi.fn(),
  getSessionJournalPreferences: vi.fn().mockResolvedValue({ retentionDays: 30 }),
  setSessionJournalPreferences: vi.fn().mockImplementation(async (preferences) => preferences),
  };
}

function createRuntime(overrides: Partial<LocalRuntime> = {}): LocalRuntime {
  return {
    platform: "macos",
    isNative: true,
    selectProjectDirectory: vi.fn().mockResolvedValue("/Users/alice/Atlas"),
    validateWorkspaceDirectory: vi.fn().mockResolvedValue({
      absolutePath: "/Users/alice/Atlas",
      realpath: "/Users/alice/Atlas",
    }),
    openProjectPath: vi.fn().mockResolvedValue(undefined),
    openTerminalAtPath: vi.fn().mockResolvedValue({ shell: "zsh", processId: 7 }),
    launchProjectCommand: vi.fn(),
    restoreToolSession: vi.fn(),
    probeAgentRuntime: vi.fn(),
    installAgentRuntime: vi.fn(),
    subscribeCommandExited: vi.fn(),
    ...overrides,
  };
}

describe("project Workspace settings", () => {
  it("selects and validates a project directory without uploading its path", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const runtime = createRuntime();
    const saveWorkspace = vi.fn().mockResolvedValue({
      bindingId: "workspace_1",
      status: "ready",
      pathFingerprint: configuredWorkspace.pathFingerprint,
      configurationVersion: 1,
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    });
    render(<ProjectWorkspaceSettings
      nativeAvailable
      projectId="project_1"
      runtime={runtime}
      saveWorkspace={saveWorkspace}
      serverWorkspace={null}
      store={store}
    />);

    await user.click(screen.getByRole("button", { name: "选择项目目录" }));

    await waitFor(() => expect(saveWorkspace).toHaveBeenCalledOnce());
    expect(runtime.selectProjectDirectory).toHaveBeenCalledOnce();
    expect(runtime.validateWorkspaceDirectory).toHaveBeenCalledWith("/Users/alice/Atlas");
    expect(store.setWorkspace).toHaveBeenNthCalledWith(1, "project_1", {
      bindingId: null,
      absolutePath: "/Users/alice/Atlas",
      realpath: "/Users/alice/Atlas",
      configurationVersion: 1,
    });
    expect(store.setWorkspace).toHaveBeenNthCalledWith(2, "project_1", {
      bindingId: "workspace_1",
      absolutePath: "/Users/alice/Atlas",
      realpath: "/Users/alice/Atlas",
      configurationVersion: 1,
    });
    expect(store.setWorkspace).toHaveBeenCalledBefore(saveWorkspace);
    expect(saveWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      status: "ready",
      pathFingerprint: configuredWorkspace.pathFingerprint,
    }));
    expect(JSON.stringify(saveWorkspace.mock.calls[0]?.[0])).not.toContain("/Users/alice");
    expect(await screen.findByText("当前设备已配置")).toBeVisible();
  });

  it("keeps the previous known-good directory when validation fails", async () => {
    const user = userEvent.setup();
    const store = createStore(configuredWorkspace);
    const runtime = createRuntime({
      selectProjectDirectory: vi.fn().mockResolvedValue("/Users/alice/Broken"),
      validateWorkspaceDirectory: vi.fn().mockRejectedValue(new Error("目录不存在")),
    });
    const saveWorkspace = vi.fn();
    render(<ProjectWorkspaceSettings
      nativeAvailable
      projectId="project_1"
      runtime={runtime}
      saveWorkspace={saveWorkspace}
      serverWorkspace={{
        bindingId: "workspace_1",
        status: "ready",
        pathFingerprint: configuredWorkspace.pathFingerprint,
        configurationVersion: 1,
        lastValidatedAt: "2026-07-31T08:00:00.000Z",
      }}
      store={store}
    />);
    expect(await screen.findByText("/Users/alice/Atlas")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "更换项目目录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("目录不存在");
    expect(store.setWorkspace).not.toHaveBeenCalled();
    expect(saveWorkspace).not.toHaveBeenCalled();
    expect(screen.getByText("/Users/alice/Atlas")).toBeVisible();
  });

  it("opens only the locally resolved directory and requires confirmation before removal", async () => {
    const user = userEvent.setup();
    const store = createStore(configuredWorkspace);
    const runtime = createRuntime();
    const removeWorkspace = vi.fn().mockResolvedValue(undefined);
    render(<ProjectWorkspaceSettings
      nativeAvailable
      projectId="project_1"
      removeWorkspace={removeWorkspace}
      runtime={runtime}
      saveWorkspace={vi.fn()}
      serverWorkspace={{
        bindingId: "workspace_1",
        status: "ready",
        pathFingerprint: configuredWorkspace.pathFingerprint,
        configurationVersion: 1,
        lastValidatedAt: "2026-07-31T08:00:00.000Z",
      }}
      store={store}
    />);
    await screen.findByText("/Users/alice/Atlas");

    await user.click(screen.getByRole("button", { name: "打开项目目录" }));
    await user.click(screen.getByRole("button", { name: "移除目录映射" }));
    expect(removeWorkspace).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认移除" }));

    expect(runtime.openProjectPath).toHaveBeenCalledWith("/Users/alice/Atlas");
    expect(store.removeWorkspace).toHaveBeenCalledWith("project_1");
    await waitFor(() => expect(removeWorkspace).toHaveBeenCalledOnce());
  });

  it("keeps directory configuration unavailable in browser fallback", () => {
    render(<ProjectWorkspaceSettings
      nativeAvailable={false}
      projectId="project_1"
      runtime={createRuntime({ isNative: false })}
      saveWorkspace={vi.fn()}
      serverWorkspace={null}
      store={null}
    />);

    expect(screen.getByText("仅桌面客户端可配置")).toBeVisible();
    expect(screen.getByRole("button", { name: "选择项目目录" })).toBeDisabled();
  });
});
