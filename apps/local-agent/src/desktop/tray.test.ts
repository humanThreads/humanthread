import { describe, expect, it, vi } from "vitest";

import {
  buildTrayMenu,
  createNativeTrayController,
  subscribeDesktopTrayActions,
} from "./tray";

describe("desktop tray model", () => {
  it("uses a fixed action order with status and current Task context", () => {
    const menu = buildTrayMenu({
      connected: true,
      deviceAuthorized: true,
      windowVisible: true,
      currentTask: { id: "task_1", title: "Review release readiness" },
    });

    expect(menu.items.map((item) => item.id)).toEqual([
      "status",
      "current-task",
      "toggle-window",
      "self-check",
      "quit",
    ]);
    expect(menu.items[0]).toMatchObject({ enabled: false, label: "已连接 · 设备已授权" });
    expect(menu.items[1]).toMatchObject({ enabled: true, route: "/tasks/task_1" });
    expect(menu.items[2]?.label).toBe("隐藏窗口");
  });

  it("keeps stable disabled items when disconnected and no Task is available", () => {
    const menu = buildTrayMenu({
      connected: false,
      deviceAuthorized: false,
      windowVisible: false,
      currentTask: null,
    });

    expect(menu.items[0]?.label).toBe("离线 · 设备未授权");
    expect(menu.items[1]).toMatchObject({ enabled: false, label: "暂无当前任务" });
    expect(menu.items[2]?.label).toBe("显示窗口");
  });

  it("sends only the projected fixed menu model to the native layer", async () => {
    const invoke = vi.fn(async () => undefined);
    const controller = createNativeTrayController({ invoke });

    await controller.sync({
      connected: true,
      deviceAuthorized: true,
      windowVisible: false,
      currentTask: null,
    });

    expect(invoke).toHaveBeenCalledWith("set_tray_menu", {
      state: expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ id: "quit" })]),
      }),
    });
  });

  it("routes the current Task and runs self-check from fixed tray events", async () => {
    const navigate = vi.fn();
    const selfCheck = vi.fn(async () => {});
    let handler: ((event: { payload: string }) => void) | undefined;

    await subscribeDesktopTrayActions({
      currentTaskRoute: "/tasks/task_1",
      listen: async (_event, nextHandler) => {
        handler = nextHandler;
        return () => {};
      },
      navigate,
      selfCheck,
    });

    handler?.({ payload: "current-task" });
    handler?.({ payload: "self-check" });
    handler?.({ payload: "shell:rm -rf" });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/tasks/task_1");
    expect(selfCheck).toHaveBeenCalledTimes(1);
  });
});
