import { describe, expect, it, vi } from "vitest";

import {
  openWebHandoff,
  isAllowedWebHandoffUrl,
  routeDesktopDeepLinks,
  resolveDesktopDeepLink,
  subscribeDesktopDeepLinks,
} from "./deep-links";

describe("desktop deep links", () => {
  it("maps only fixed HumanThread resource links to normalized desktop routes", () => {
    expect(resolveDesktopDeepLink("humanthread://open/tasks/task_1"))
      .toBe("/tasks/task_1");
    expect(resolveDesktopDeepLink("humanthread://open/notifications?item=notice_1"))
      .toBe("/notifications?item=notice_1");
    expect(resolveDesktopDeepLink("humanthread://open/loop-runs/run_1?interaction=interaction_1&message=message_2"))
      .toBe("/loop-runs/run_1?interaction=interaction_1&message=message_2");
    expect(resolveDesktopDeepLink("humanthread://open/loop-runs/run_1?redirect=https://evil.example"))
      .toBeNull();
    expect(resolveDesktopDeepLink("https://evil.example/tasks/task_1")).toBeNull();
    expect(resolveDesktopDeepLink("humanthread://open/tasks/../settings")).toBeNull();
    expect(resolveDesktopDeepLink("humanthread://evil/tasks/task_1")).toBeNull();
  });

  it("allows only a bounded handoff consume URL on the active deployment", () => {
    const deployment = "https://ht.example.com";

    expect(isAllowedWebHandoffUrl(
      "https://ht.example.com/api/desktop/web-handoff/consume?code=opaque_code_1",
      deployment,
    )).toBe(true);
    expect(isAllowedWebHandoffUrl(
      "https://evil.example/api/desktop/web-handoff/consume?code=opaque_code_1",
      deployment,
    )).toBe(false);
    expect(isAllowedWebHandoffUrl(
      "https://ht.example.com/api/desktop/web-handoff/consume?code=x&next=https://evil.example",
      deployment,
    )).toBe(false);
    expect(isAllowedWebHandoffUrl(
      `https://ht.example.com/api/desktop/web-handoff/consume?code=${"x".repeat(257)}`,
      deployment,
    )).toBe(false);
  });

  it("filters native URL events before navigation and external opening", async () => {
    const navigate = vi.fn();
    let urlHandler: ((urls: string[]) => void) | undefined;
    const unlisten = vi.fn();
    await subscribeDesktopDeepLinks({
      onOpenUrl: async (handler) => {
        urlHandler = handler;
        return unlisten;
      },
      navigate,
    });
    urlHandler?.([
      "https://evil.example/tasks/task_1",
      "humanthread://open/tasks/task_1",
    ]);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/tasks/task_1");

    const openUrl = vi.fn(async () => {});
    await expect(openWebHandoff({
      url: "https://ht.example.com/api/desktop/web-handoff/consume?code=opaque",
      deploymentUrl: "https://ht.example.com",
      openUrl,
    })).resolves.toBeUndefined();
    await expect(openWebHandoff({
      url: "https://evil.example/api/desktop/web-handoff/consume?code=opaque",
      deploymentUrl: "https://ht.example.com",
      openUrl,
    })).rejects.toThrow("Web handoff URL is not allowed");
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it("routes startup URLs without creating temporary native subscriptions", () => {
    const navigate = vi.fn();

    routeDesktopDeepLinks([
      "humanthread://open/projects/project_1",
      "humanthread://evil/projects/project_1",
    ], navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/projects/project_1");
  });
});
