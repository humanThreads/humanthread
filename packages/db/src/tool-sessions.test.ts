import { describe, expect, it, vi } from "vitest";
import {
  buildToolSessionId,
  getLatestToolSessionForTask,
  persistToolSessionExit,
  persistToolSessionStart,
} from "./tool-sessions";

describe("tool session helpers", () => {
  it("builds a stable tool session id from task and device", () => {
    const first = buildToolSessionId({
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
      sessionName: "ht-workflow_1-run_cli-device_mac_1",
    });
    const second = buildToolSessionId({
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
      sessionName: "ht-workflow_1-run_cli-device_mac_1",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^tool_session_/u);
  });

  it("creates a tool session when a command starts", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "tool_session_1",
    });
    const tx = {
      toolSession: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
        update: vi.fn(),
        findFirst: vi.fn(),
      },
    };

    await persistToolSessionStart({
      db: {
        $transaction: vi.fn(async (callback) => callback(tx)),
      },
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
      sessionType: "tmux",
      sessionName: "ht-workflow_1-run_cli-device_mac_1",
      now: new Date("2026-05-19T01:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: "workflow_1:run_cli",
          localDeviceId: "device_mac_1",
          sessionType: "tmux",
          sessionName: "ht-workflow_1-run_cli-device_mac_1",
          status: "active",
        }),
      }),
    );
  });

  it("updates a tool session when a command exits", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "tool_session_1",
    });
    const tx = {
      toolSession: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "tool_session_1",
        }),
        create: vi.fn(),
        update,
      },
    };

    await persistToolSessionExit({
      db: {
        $transaction: vi.fn(async (callback) => callback(tx)),
      },
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
      sessionType: "tmux",
      sessionName: "ht-workflow_1-run_cli-device_mac_1",
      status: "completed",
      lastOutputSummary: "CLI 已顺利完成",
      now: new Date("2026-05-19T01:05:00.000Z"),
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          lastOutputSummary: "CLI 已顺利完成",
        }),
      }),
    );
  });

  it("loads the latest active tool session for a task", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "tool_session_1",
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
      sessionType: "tmux",
      sessionName: "ht-workflow_1-run_cli-device_mac_1",
      status: "active",
      lastOutputSummary: "正在等待用户确认",
      createdAt: new Date("2026-05-19T01:00:00.000Z"),
      updatedAt: new Date("2026-05-19T01:03:00.000Z"),
    });

    const result = await getLatestToolSessionForTask({
      db: {
        toolSession: {
          findFirst,
        },
      },
      taskId: "workflow_1:run_cli",
      localDeviceId: "device_mac_1",
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: "workflow_1:run_cli",
          localDeviceId: "device_mac_1",
          status: "active",
        },
      }),
    );
    expect(result).toMatchObject({
      id: "tool_session_1",
      sessionName: "ht-workflow_1-run_cli-device_mac_1",
      status: "active",
      lastOutputSummary: "正在等待用户确认",
    });
  });
});
