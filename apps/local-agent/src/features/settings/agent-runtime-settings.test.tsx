import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LocalExecutionConfigStore } from "../../desktop/execution-config-store";
import type { LocalRuntime } from "../../lib/runtime";
import type { NativeLocalModelCommands } from "../../lib/native-local-model-commands";
import { AgentRuntimeSettings } from "./agent-runtime-settings";

function createStore(): LocalExecutionConfigStore {
  return {
    getWorkspace: vi.fn(),
    getWorkspaceByBindingId: vi.fn(),
    setWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
    getRuntime: vi.fn().mockResolvedValue(null),
    upsertRuntime: vi.fn().mockImplementation(async (runtime) => runtime),
    disableRuntime: vi.fn().mockResolvedValue({ provider: "codex", status: "disabled", version: 1 }),
    rotateInstallationKey: vi.fn(),
    getWorkerPreferences: vi.fn().mockResolvedValue({ enabled: true, maxConcurrency: 1 }),
    setWorkerPreferences: vi.fn().mockImplementation(async (preferences) => preferences),
    getSessionJournalPreferences: vi.fn().mockResolvedValue({ retentionDays: 30 }),
    setSessionJournalPreferences: vi.fn().mockImplementation(async (preferences) => preferences),
  };
}

function createRuntime(overrides: Partial<LocalRuntime> = {}): LocalRuntime {
  return {
    platform: "macos",
    isNative: true,
    selectProjectDirectory: vi.fn(),
    validateWorkspaceDirectory: vi.fn(),
    openProjectPath: vi.fn(),
    openTerminalAtPath: vi.fn(),
    launchProjectCommand: vi.fn(),
    restoreToolSession: vi.fn(),
    probeAgentRuntime: vi.fn().mockResolvedValue({
      provider: "codex",
      status: "ready",
      semanticVersion: "0.72.0",
      authentication: "authenticated",
      capabilities: ["structured_result", "session_resume"],
    }),
    installAgentRuntime: vi.fn().mockResolvedValue({ provider: "codex", packageName: "@openai/codex", status: "installed" }),
    subscribeCommandExited: vi.fn(),
    ...overrides,
  };
}

function createLocalModelCommands(): NativeLocalModelCommands {
  return {
    getCredentialStatus: vi.fn().mockResolvedValue({
      credentialRef: "0123456789abcdef0123456789abcdef",
      kind: "openai_api_key",
      configured: false,
      updatedAt: null,
    }),
    setCredential: vi.fn().mockResolvedValue({
      credentialRef: "0123456789abcdef0123456789abcdef",
      kind: "openai_api_key",
      configured: true,
      updatedAt: "2026-08-15T08:00:00.000Z",
    }),
    deleteCredential: vi.fn(),
    listSites: vi.fn().mockResolvedValue({ schemaVersion: 1, sites: [], accountDefault: null }),
    saveSite: vi.fn(),
    saveModelDefaults: vi.fn(),
    deleteSite: vi.fn(),
    getCatalog: vi.fn().mockResolvedValue({ schemaVersion: 1, sites: {} }),
    saveCatalog: vi.fn(),
    testAndRefreshSite: vi.fn(),
    getRouting: vi.fn().mockResolvedValue({ schemaVersion: 1, loops: {} }),
    saveRouting: vi.fn(),
  };
}

describe("Agent runtime settings", () => {
  it("persists the device Worker switch and a custom 1-128 concurrency limit", async () => {
    const user = userEvent.setup();
    const store = createStore();
    render(<AgentRuntimeSettings
      nativeAvailable
      runtime={createRuntime()}
      runtimeProfiles={[]}
      saveRuntime={vi.fn()}
      store={store}
    />);

    const concurrency = await screen.findByLabelText("并发上限");
    await user.clear(concurrency);
    await user.type(concurrency, "128");
    await user.click(screen.getByRole("button", { name: "保存 Worker 设置" }));

    expect(store.setWorkerPreferences).toHaveBeenCalledWith({ enabled: true, maxConcurrency: 128 });
    expect(await screen.findByText("正在执行 0 / 并发上限 128")).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: "执行任务" }));
    await user.click(screen.getByRole("button", { name: "保存 Worker 设置" }));
    expect(store.setWorkerPreferences).toHaveBeenLastCalledWith({ enabled: false, maxConcurrency: 128 });
  });

  it("persists the default 30-day session journal retention override", async () => {
    const user = userEvent.setup();
    const store = createStore();
    render(<AgentRuntimeSettings
      nativeAvailable
      runtime={createRuntime()}
      runtimeProfiles={[]}
      saveRuntime={vi.fn()}
      store={store}
    />);

    const retention = await screen.findByLabelText("会话日志保留天数");
    expect(retention).toHaveValue(30);
    await user.clear(retention);
    await user.type(retention, "14");
    await user.click(screen.getByRole("button", { name: "保存会话日志设置" }));

    expect(store.setSessionJournalPreferences).toHaveBeenCalledWith({ retentionDays: 14 });
    expect(await screen.findByText("会话日志保留设置已保存")).toBeVisible();
  });
  it("tests Codex before saving locally and uploading only readiness metadata", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const runtime = createRuntime();
    const saveRuntime = vi.fn().mockResolvedValue({
      id: "runtime_1",
      userId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      label: "Codex 0.72.0",
      status: "ready",
      version: 1,
      capabilities: ["session_resume", "structured_result"],
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    });
    render(<AgentRuntimeSettings
      nativeAvailable
      runtime={runtime}
      runtimeProfiles={[]}
      saveRuntime={saveRuntime}
      store={store}
    />);

    await user.click(screen.getByRole("button", { name: "测试 Codex 配置" }));

    await waitFor(() => expect(saveRuntime).toHaveBeenCalledOnce());
    expect(runtime.probeAgentRuntime).toHaveBeenCalledWith({
      provider: "codex",
      command: "codex",
      environmentRefs: [],
    });
    expect(store.upsertRuntime).toHaveBeenCalledBefore(saveRuntime);
    expect(saveRuntime.mock.calls[0]?.[0]).not.toHaveProperty("command");
    expect(saveRuntime.mock.calls[0]?.[0]).not.toHaveProperty("environmentRefs");
    expect(await screen.findByText("配置保存在当前设备")).toBeVisible();
  });

  it("probes an independent Codex key before persisting it and never echoes the key", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const runtime = createRuntime();
    const commands = createLocalModelCommands();
    render(<AgentRuntimeSettings
      nativeAvailable
      runtime={runtime}
      runtimeProfiles={[]}
      saveRuntime={vi.fn().mockResolvedValue({})}
      store={store}
      localModelCommands={commands}
    />);

    await user.click(screen.getByRole("radio", { name: "使用独立 Key" }));
    const key = screen.getByLabelText("Codex 独立 Key");
    await user.type(key, "sk-runtime-isolated");
    await user.click(screen.getByRole("button", { name: "测试 Codex 配置" }));

    await waitFor(() => expect(runtime.probeAgentRuntime).toHaveBeenCalledWith(expect.objectContaining({
      credential: "sk-runtime-isolated",
    })));
    expect(commands.setCredential).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-runtime-isolated" }));
    expect(store.upsertRuntime).toHaveBeenCalledWith(expect.objectContaining({
      credentialRef: "0123456789abcdef0123456789abcdef",
    }));
    expect(key).toHaveValue("");
    expect(screen.queryByText("sk-runtime-isolated")).not.toBeInTheDocument();
  });

  it("keeps a known-good runtime when the candidate is unauthenticated", async () => {
    const user = userEvent.setup();
    const store = createStore();
    vi.mocked(store.getRuntime).mockResolvedValue({
      provider: "codex", version: 1,
      command: "/usr/local/bin/codex",
      environmentRefs: [],
    });
    const runtime = createRuntime({
      probeAgentRuntime: vi.fn().mockResolvedValue({
        provider: "codex",
        status: "unauthenticated",
        semanticVersion: "0.72.0",
        authentication: "unauthenticated",
        capabilities: [],
      }),
    });
    render(<AgentRuntimeSettings
      nativeAvailable
      runtime={runtime}
      runtimeProfiles={[]}
      saveRuntime={vi.fn()}
      store={store}
    />);
    const command = await screen.findByLabelText("Codex 可执行命令");
    await user.clear(command);
    await user.type(command, "/tmp/codex");

    await user.click(screen.getByRole("button", { name: "测试 Codex 配置" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("尚未登录");
    expect(store.upsertRuntime).not.toHaveBeenCalled();
    expect(command).toHaveValue("/usr/local/bin/codex");
  });

  it("installs a missing runtime and probes it again without uploading local install details", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const probeAgentRuntime = vi.fn()
      .mockResolvedValueOnce({ provider: "codex", status: "missing", semanticVersion: null, authentication: "unknown", capabilities: [] })
      .mockResolvedValueOnce({ provider: "codex", status: "unauthenticated", semanticVersion: "0.72.0", authentication: "unauthenticated", capabilities: [] });
    const installAgentRuntime = vi.fn().mockResolvedValue({ provider: "codex", packageName: "@openai/codex", status: "installed" });
    render(<AgentRuntimeSettings
      nativeAvailable
      runtime={createRuntime({ probeAgentRuntime, installAgentRuntime })}
      runtimeProfiles={[]}
      saveRuntime={vi.fn()}
      store={store}
    />);

    await user.click(screen.getByRole("button", { name: "测试 Codex 配置" }));
    await user.click(await screen.findByRole("button", { name: "一键安装 Codex" }));

    await waitFor(() => expect(installAgentRuntime).toHaveBeenCalledWith({ provider: "codex", environmentRefs: [] }));
    expect(probeAgentRuntime).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("status")).toHaveTextContent("已安装，请先完成登录");
  });

  it("shows native string errors instead of replacing them with a generic failure", async () => {
    const user = userEvent.setup();
    const runtime = createRuntime({
      probeAgentRuntime: vi.fn().mockRejectedValue("Failed to start Agent runtime probe: node not found"),
    });
    render(<AgentRuntimeSettings
      nativeAvailable
      runtime={runtime}
      runtimeProfiles={[]}
      saveRuntime={vi.fn()}
      store={createStore()}
    />);

    await user.click(screen.getByRole("button", { name: "测试 Codex 配置" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to start Agent runtime probe: node not found",
    );
  });

  it("disables a configured runtime locally before updating the platform", async () => {
    const user = userEvent.setup();
    const store = createStore();
    vi.mocked(store.getRuntime).mockResolvedValue({
      runtimeProfileId: "runtime_1", provider: "codex", command: "codex", environmentRefs: [], version: 1,
    });
    const saveRuntime = vi.fn().mockResolvedValue({ status: "disabled" });
    render(<AgentRuntimeSettings
      nativeAvailable
      runtime={createRuntime()}
      runtimeProfiles={[{
        id: "runtime_1", userId: "user_1", localDeviceId: "device_1",
        provider: "codex", label: "Codex 0.72.0", status: "ready", version: 1,
        capabilities: ["structured_result"], lastValidatedAt: "2026-07-31T08:00:00.000Z",
      }]}
      saveRuntime={saveRuntime}
      store={store}
    />);

    await user.click(await screen.findByRole("button", { name: "停用 Codex" }));

    expect(store.disableRuntime).toHaveBeenCalledWith("codex", 2);
    expect(store.disableRuntime).toHaveBeenCalledBefore(saveRuntime);
    expect(saveRuntime).toHaveBeenCalledWith(expect.objectContaining({ status: "disabled" }));
  });

  it("does not probe providers in browser fallback", () => {
    render(<AgentRuntimeSettings
      nativeAvailable={false}
      runtime={createRuntime({ isNative: false })}
      runtimeProfiles={[]}
      saveRuntime={vi.fn()}
      store={null}
    />);

    expect(screen.getByText("仅桌面客户端可配置 Agent")).toBeVisible();
    expect(screen.getByRole("button", { name: "测试 Codex 配置" })).toBeDisabled();
  });
});
