import { describe, expect, it, vi } from "vitest";
import {
  createBrowserRuntime,
  createDesktopRuntime,
  detectLocalPlatform,
} from "./runtime";

describe("local runtime", () => {
  it("maps common platform labels into supported runtime platforms", () => {
    expect(detectLocalPlatform("MacIntel")).toBe("macos");
    expect(detectLocalPlatform("Win32")).toBe("windows");
    expect(detectLocalPlatform("Linux x86_64")).toBe("linux");
    expect(detectLocalPlatform("")).toBe("unknown");
  });

  it("rejects system actions in browser fallback mode", async () => {
    const runtime = createBrowserRuntime("Linux");

    await expect(runtime.openProjectPath("/tmp/demo")).rejects.toThrow(
      "本地系统动作仅在桌面客户端中可用。",
    );
    await expect(runtime.openTerminalAtPath("/tmp/demo")).rejects.toThrow(
      "本地系统动作仅在桌面客户端中可用。",
    );
    await expect(
      runtime.launchProjectCommand({
        cwd: "/tmp/demo",
        command: "codex",
        taskId: "task_1",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        sessionName: "ht-task_1-device_1",
        sessionType: "tmux",
      }),
    ).rejects.toThrow("本地系统动作仅在桌面客户端中可用。");
    await expect(
      runtime.restoreToolSession({
        cwd: "/tmp/demo",
        taskId: "task_1",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        sessionName: "ht-task_1-device_1",
        sessionType: "tmux",
      }),
    ).rejects.toThrow("本地系统动作仅在桌面客户端中可用。");
    await expect(runtime.subscribeCommandExited(() => {})).rejects.toThrow(
      "本地系统动作仅在桌面客户端中可用。",
    );
    await expect(runtime.validateWorkspaceDirectory("/tmp/demo")).rejects.toThrow(
      "本地系统动作仅在桌面客户端中可用。",
    );
    await expect(runtime.probeAgentRuntime({
      provider: "codex",
      command: "codex",
      environmentRefs: [],
    })).rejects.toThrow("本地系统动作仅在桌面客户端中可用。");
    await expect(runtime.installAgentRuntime({ provider: "codex", environmentRefs: [] })).rejects.toThrow(
      "本地系统动作仅在桌面客户端中可用。",
    );
    await expect(runtime.selectProjectDirectory()).rejects.toThrow(
      "本地系统动作仅在桌面客户端中可用。",
    );
  });

  it("forwards local actions to native invoke commands", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        shell: "osascript -> Terminal",
        processId: 901,
      })
      .mockResolvedValueOnce({
        shell: "sh -lc",
        processId: 4242,
      })
      .mockResolvedValueOnce({
        shell: "sh -lc",
        processId: 5252,
      })
      .mockResolvedValueOnce({
        absolutePath: "/Users/alice/IdeaProjects/humanThread",
        realpath: "/Users/alice/IdeaProjects/humanThread",
      })
      .mockResolvedValueOnce({
        provider: "codex",
        status: "ready",
        semanticVersion: "0.72.0",
        authentication: "authenticated",
        capabilities: ["structured_result"],
      })
      .mockResolvedValueOnce({ provider: "codex", packageName: "@openai/codex", status: "installed" });
    const listen = vi.fn().mockResolvedValue(() => {});
    const selectDirectory = vi.fn().mockResolvedValue(
      "/Users/alice/IdeaProjects/humanThread",
    );
    const runtime = createDesktopRuntime({ invoke, listen, selectDirectory }, "MacIntel");

    await runtime.openProjectPath("/Users/alice/IdeaProjects/humanThread");
    await expect(
      runtime.openTerminalAtPath("/Users/alice/IdeaProjects/humanThread"),
    ).resolves.toEqual({
      shell: "osascript -> Terminal",
      processId: 901,
    });
    await expect(
      runtime.launchProjectCommand({
        cwd: "/Users/alice/IdeaProjects/humanThread",
        command: "codex",
        taskId: "task_1",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        sessionName: "ht-task_1-device_1",
        sessionType: "tmux",
      }),
    ).resolves.toEqual({
      shell: "sh -lc",
      processId: 4242,
    });
    await expect(
      runtime.restoreToolSession({
        cwd: "/Users/alice/IdeaProjects/humanThread",
        taskId: "task_1",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        sessionName: "ht-task_1-device_1",
        sessionType: "tmux",
      }),
    ).resolves.toEqual({
      shell: "sh -lc",
      processId: 5252,
    });
    await runtime.subscribeCommandExited(() => {});
    await expect(runtime.validateWorkspaceDirectory(
      "/Users/alice/IdeaProjects/humanThread",
    )).resolves.toEqual({
      absolutePath: "/Users/alice/IdeaProjects/humanThread",
      realpath: "/Users/alice/IdeaProjects/humanThread",
    });
    await expect(runtime.probeAgentRuntime({
      provider: "codex",
      command: "/Users/alice/.nvm/bin/codex",
      environmentRefs: ["CODEX_HOME"],
    })).resolves.toMatchObject({ provider: "codex", status: "ready" });
    await expect(runtime.installAgentRuntime({ provider: "codex", environmentRefs: ["CODEX_HOME"] }))
      .resolves.toMatchObject({ provider: "codex", packageName: "@openai/codex" });
    await expect(runtime.selectProjectDirectory()).resolves.toBe(
      "/Users/alice/IdeaProjects/humanThread",
    );

    expect(invoke).toHaveBeenNthCalledWith(1, "open_project_path", {
      path: "/Users/alice/IdeaProjects/humanThread",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "open_terminal_at_path", {
      path: "/Users/alice/IdeaProjects/humanThread",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "launch_project_command", {
      cwd: "/Users/alice/IdeaProjects/humanThread",
      command: "codex",
      task_id: "task_1",
      project_id: "project_1",
      workflow_instance_id: "workflow_1",
      session_name: "ht-task_1-device_1",
      session_type: "tmux",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "restore_tool_session", {
      cwd: "/Users/alice/IdeaProjects/humanThread",
      task_id: "task_1",
      project_id: "project_1",
      workflow_instance_id: "workflow_1",
      session_name: "ht-task_1-device_1",
      session_type: "tmux",
    });
    expect(listen).toHaveBeenCalledWith("command_exited", expect.any(Function));
    expect(invoke).toHaveBeenNthCalledWith(5, "validate_workspace_directory", {
      path: "/Users/alice/IdeaProjects/humanThread",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "probe_agent_runtime", {
      provider: "codex",
      command: "/Users/alice/.nvm/bin/codex",
      environmentRefs: ["CODEX_HOME"],
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "install_agent_runtime", {
      provider: "codex",
      environmentRefs: ["CODEX_HOME"],
    });
    expect(selectDirectory).toHaveBeenCalledOnce();
  });
});
