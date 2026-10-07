import { describe, expect, it, vi } from "vitest";
import { reportAgentTaskEvent } from "./agent-events";

describe("reportAgentTaskEvent", () => {
  it("records a supported local agent event with device metadata", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);

    const result = await reportAgentTaskEvent(
      {
        taskId: "workflow_1:run_cli",
        actorUserId: "user_owner",
        eventType: "command_started",
        message: "已在本地启动命令",
        localDevice: {
          id: "device_mac_1",
          name: "agent-macbook",
          platform: "macos",
        },
        payload: {
          command: "codex",
          cwd: "/Users/alice/IdeaProjects/humanThread",
          shell: "sh -lc",
          processId: 4242,
        },
        now: new Date("2026-05-19T01:00:00.000Z"),
      },
      {
        createEventId: () => "workflow_1:run_cli:command_started:1",
        loadTaskContext: vi.fn().mockResolvedValue({
          task: {
            id: "workflow_1:run_cli",
            workflowInstanceId: "workflow_1",
            teamId: "team_1",
          },
        }),
        persist,
      },
    );

    expect(result.event).toMatchObject({
      id: "workflow_1:run_cli:command_started:1",
      taskId: "workflow_1:run_cli",
      workflowInstanceId: "workflow_1",
      type: "command_started",
      actorType: "human",
      actorUserId: "user_owner",
      message: "已在本地启动命令",
      payload: {
        command: "codex",
        cwd: "/Users/alice/IdeaProjects/humanThread",
        shell: "sh -lc",
        processId: 4242,
        deviceId: "device_mac_1",
        deviceName: "agent-macbook",
        platform: "macos",
      },
    });
    expect(persist).toHaveBeenCalledWith({
      actorUserId: "user_owner",
      event: result.event,
      localDevice: {
        id: "device_mac_1",
        name: "agent-macbook",
        platform: "macos",
      },
      now: new Date("2026-05-19T01:00:00.000Z"),
    });
  });

  it("persists a tool session start when command_started carries session metadata", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const persistToolSessionStart = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-05-19T01:00:00.000Z");

    await reportAgentTaskEvent(
      {
        taskId: "workflow_1:run_cli",
        actorUserId: "user_owner",
        eventType: "command_started",
        localDevice: {
          id: "device_mac_1",
          name: "agent-macbook",
          platform: "macos",
        },
        payload: {
          command: "codex",
          cwd: "/Users/alice/IdeaProjects/humanThread",
          shell: "sh -lc",
          processId: 4242,
          sessionName: "ht-workflow-1-device-mac-1",
          sessionType: "tmux",
        },
        now,
      },
      {
        createEventId: () => "workflow_1:run_cli:command_started:1",
        loadTaskContext: vi.fn().mockResolvedValue({
          task: {
            id: "workflow_1:run_cli",
            workflowInstanceId: "workflow_1",
            teamId: "team_1",
          },
        }),
        persist,
        persistToolSessionStart,
      },
    );

    expect(persistToolSessionStart).toHaveBeenCalledWith({
      prisma: expect.anything(),
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
      sessionType: "tmux",
      sessionName: "ht-workflow-1-device-mac-1",
      now,
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("persists a completed tool session exit when command_exited reports completed", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const persistToolSessionExit = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-05-19T02:00:00.000Z");

    await reportAgentTaskEvent(
      {
        taskId: "workflow_1:run_cli",
        actorUserId: "user_owner",
        eventType: "command_exited",
        localDevice: {
          id: "device_mac_1",
          name: "agent-macbook",
          platform: "macos",
        },
        payload: {
          command: "codex",
          cwd: "/Users/alice/IdeaProjects/humanThread",
          shell: "sh -lc",
          processId: 4242,
          status: "completed",
          exitCode: 0,
          sessionName: "ht-workflow-1-device-mac-1",
          sessionType: "tmux",
        },
        now,
      },
      {
        createEventId: () => "workflow_1:run_cli:command_exited:1",
        loadTaskContext: vi.fn().mockResolvedValue({
          task: {
            id: "workflow_1:run_cli",
            workflowInstanceId: "workflow_1",
            teamId: "team_1",
          },
        }),
        persist,
        persistToolSessionExit,
      },
    );

    expect(persistToolSessionExit).toHaveBeenCalledWith({
      prisma: expect.anything(),
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
      sessionType: "tmux",
      sessionName: "ht-workflow-1-device-mac-1",
      status: "completed",
      lastOutputSummary: null,
      now,
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("maps non-completed command_exited status into interrupted session exit", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const persistToolSessionExit = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-05-19T03:00:00.000Z");

    await reportAgentTaskEvent(
      {
        taskId: "workflow_1:run_cli",
        actorUserId: "user_owner",
        eventType: "command_exited",
        localDevice: {
          id: "device_mac_1",
          name: "agent-macbook",
          platform: "macos",
        },
        payload: {
          command: "codex",
          cwd: "/Users/alice/IdeaProjects/humanThread",
          shell: "sh -lc",
          processId: 4242,
          status: "failed",
          exitCode: 1,
          sessionName: "ht-workflow-1-device-mac-1",
          sessionType: "tmux",
        },
        now,
      },
      {
        createEventId: () => "workflow_1:run_cli:command_exited:2",
        loadTaskContext: vi.fn().mockResolvedValue({
          task: {
            id: "workflow_1:run_cli",
            workflowInstanceId: "workflow_1",
            teamId: "team_1",
          },
        }),
        persist,
        persistToolSessionExit,
      },
    );

    expect(persistToolSessionExit).toHaveBeenCalledWith({
      prisma: expect.anything(),
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
      sessionType: "tmux",
      sessionName: "ht-workflow-1-device-mac-1",
      status: "interrupted",
      lastOutputSummary: null,
      now,
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported event types", async () => {
    await expect(
      reportAgentTaskEvent(
        {
          taskId: "workflow_1:run_cli",
          actorUserId: "user_owner",
          eventType: "cli_reported",
          localDevice: {
            id: "device_mac_1",
            name: "agent-macbook",
            platform: "macos",
          },
        },
        {
          createEventId: vi.fn(),
          loadTaskContext: vi.fn(),
          persist: vi.fn(),
        },
      ),
    ).rejects.toThrow("Unsupported agent event type");
  });

  it("rejects legacy Agent events for a standalone user task", async () => {
    const persist = vi.fn();

    await expect(reportAgentTaskEvent(
      {
        taskId: "task_standalone",
        actorUserId: "user_owner",
        eventType: "local_opened",
        localDevice: {
          id: "device_mac_1",
          name: "agent-macbook",
          platform: "macos",
        },
      },
      {
        createEventId: vi.fn(),
        loadTaskContext: vi.fn().mockResolvedValue({
          task: {
            id: "task_standalone",
            workflowInstanceId: null,
            teamId: "team_1",
          },
        }),
        persist,
      },
    )).rejects.toMatchObject({ code: "legacy_workflow_task_required" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects events when the task team does not match the authenticated user team", async () => {
    await expect(
      reportAgentTaskEvent(
        {
          taskId: "workflow_1:run_cli",
          actorUserId: "user_owner",
          actorTeamId: "team_1",
          eventType: "command_started",
          localDevice: {
            id: "device_mac_1",
            name: "agent-macbook",
            platform: "macos",
          },
        },
        {
          createEventId: vi.fn(),
          loadTaskContext: vi.fn().mockResolvedValue({
            task: {
              id: "workflow_1:run_cli",
              workflowInstanceId: "workflow_1",
              teamId: "team_other",
            },
          }),
          persist: vi.fn(),
        },
      ),
    ).rejects.toThrow("Agent user cannot report events for a different team");
  });
});
