import { describe, expect, it } from "vitest";
import { buildCommandExitedEventRequest } from "./command-events";

describe("buildCommandExitedEventRequest", () => {
  it("builds a completed command exit event payload", () => {
    const result = buildCommandExitedEventRequest({
      actorUserId: "user_owner",
      localDevice: {
        id: "device_mac_1",
        name: "agent-macbook",
        platform: "macos",
      },
      commandExit: {
        taskId: "task_1",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        cwd: "/Users/alice/IdeaProjects/humanThread",
        command: "pnpm test",
        processId: 4242,
        shell: "sh -lc",
        status: "completed",
        exitCode: 0,
        signal: null,
        sessionName: "ht-task_1-device_1",
        sessionType: "tmux",
      },
    });

    expect(result).toEqual({
      taskId: "task_1",
      actorUserId: "user_owner",
      eventType: "command_exited",
      message: "本地命令执行结束，退出码 0。",
      payload: {
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        cwd: "/Users/alice/IdeaProjects/humanThread",
        command: "pnpm test",
        processId: 4242,
        shell: "sh -lc",
        status: "completed",
        exitCode: 0,
        signal: null,
        sessionName: "ht-task_1-device_1",
        sessionType: "tmux",
      },
      localDevice: {
        id: "device_mac_1",
        name: "agent-macbook",
        platform: "macos",
      },
    });
  });

  it("builds an interrupted command exit event payload with error details", () => {
    const result = buildCommandExitedEventRequest({
      actorUserId: "user_owner",
      localDevice: {
        id: "device_linux_1",
        name: "workspace-linux",
        platform: "linux",
      },
      commandExit: {
        taskId: "task_2",
        projectId: "project_2",
        workflowInstanceId: "workflow_2",
        cwd: "/workspace/demo",
        command: "codex",
        processId: 5252,
        shell: "cmd /C",
        status: "interrupted",
        exitCode: 1,
        signal: null,
        error: "spawn failed",
        sessionName: "ht-task_2-device_2",
        sessionType: "tmux",
      },
    });

    expect(result).toEqual({
      taskId: "task_2",
      actorUserId: "user_owner",
      eventType: "command_exited",
      message: "本地命令执行异常结束，退出码 1。",
      payload: {
        projectId: "project_2",
        workflowInstanceId: "workflow_2",
        cwd: "/workspace/demo",
        command: "codex",
        processId: 5252,
        shell: "cmd /C",
        status: "interrupted",
        exitCode: 1,
        signal: null,
        error: "spawn failed",
        sessionName: "ht-task_2-device_2",
        sessionType: "tmux",
      },
      localDevice: {
        id: "device_linux_1",
        name: "workspace-linux",
        platform: "linux",
      },
    });
  });
});
