import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LocalRuntime } from "../../lib/runtime";
import { TaskLocalActions } from "./task-local-actions";

function runtime(overrides: Partial<LocalRuntime> = {}): LocalRuntime {
  return {
    platform: "macos",
    isNative: true,
    openProjectPath: vi.fn().mockResolvedValue(undefined),
    openTerminalAtPath: vi.fn().mockResolvedValue({ shell: "Terminal", processId: 12 }),
    launchProjectCommand: vi.fn().mockResolvedValue({
      shell: "sh -lc",
      processId: 4242,
      sessionName: "ht-task-1-device-1",
      sessionType: "tmux",
    }),
    restoreToolSession: vi.fn().mockResolvedValue({ shell: "tmux attach", processId: 5252 }),
    validateWorkspaceDirectory: vi.fn().mockResolvedValue({
      absolutePath: "/workspace/humanthread",
      realpath: "/workspace/humanthread",
    }),
    probeAgentRuntime: vi.fn().mockResolvedValue({
      provider: "codex",
      status: "ready",
      semanticVersion: "0.72.0",
      authentication: "authenticated",
      capabilities: ["structured_result"],
    }),
    installAgentRuntime: vi.fn().mockResolvedValue({ provider: "codex", packageName: "@openai/codex", status: "installed" }),
    selectProjectDirectory: vi.fn().mockResolvedValue("/workspace/humanthread"),
    subscribeCommandExited: vi.fn().mockResolvedValue(() => undefined),
    ...overrides,
  };
}

const execution = {
  projectId: "project_1",
  workflowInstanceId: "workflow_1",
  localPath: "/workspace/humanthread",
  command: "codex",
  toolSession: null,
};

describe("Task local actions", () => {
  it("keeps only contextual folder and terminal actions", async () => {
    const user = userEvent.setup();
    const localRuntime = runtime();
    const reportEvent = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskLocalActions
        canExecute
        execution={execution}
        reportEvent={reportEvent}
        runtime={localRuntime}
        taskId="task_1"
      />,
    );

    expect(screen.queryByLabelText("执行命令")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启动 Codex" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开项目目录" }));
    await user.click(screen.getByRole("button", { name: "打开项目终端" }));

    expect(localRuntime.openProjectPath).toHaveBeenCalledWith("/workspace/humanthread");
    expect(localRuntime.openTerminalAtPath).toHaveBeenCalledWith("/workspace/humanthread");
    expect(localRuntime.launchProjectCommand).not.toHaveBeenCalled();
  });

  it("restores the server-provided active ToolSession", async () => {
    const user = userEvent.setup();
    const localRuntime = runtime();
    render(
      <TaskLocalActions
        canExecute
        execution={{
          ...execution,
          toolSession: {
            id: "session_1",
            sessionName: "ht-task-1-device-1",
            sessionType: "tmux",
            status: "active",
            lastOutputSummary: null,
          },
        }}
        reportEvent={vi.fn()}
        runtime={localRuntime}
        taskId="task_1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "恢复会话" }));

    expect(localRuntime.restoreToolSession).toHaveBeenCalledWith({
      cwd: "/workspace/humanthread",
      taskId: "task_1",
      projectId: "project_1",
      workflowInstanceId: "workflow_1",
      sessionName: "ht-task-1-device-1",
      sessionType: "tmux",
    });
  });
});
