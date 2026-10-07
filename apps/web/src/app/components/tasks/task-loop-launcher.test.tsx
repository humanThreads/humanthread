// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskLoopLauncher } from "./task-loop-launcher";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const loopOptions = [
  { bindingId: "binding_default", loopDefinitionId: "loop_default", loopVersionId: "version_default", name: "分支开发 Loop", description: "执行实现并提交候选结果", versionNumber: 12, isDefault: true, ready: true, reason: null },
  { bindingId: "binding_fast", loopDefinitionId: "loop_fast", loopVersionId: "version_fast", name: "快速修复 Loop", description: "面向单点缺陷的短流程", versionNumber: 8, isDefault: false, ready: true, reason: null },
] as const;

function optionsResponse(bindingId: string) {
  return new Response(JSON.stringify({
    ok: true,
    loops: loopOptions,
    selectedBindingId: bindingId,
    options: [{ type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: true, reason: null }],
    defaultTarget: { type: "linux_worker_pool", id: "a".repeat(32), displayName: "Linux Worker · ht-agent", ready: true, reason: null },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    return Promise.resolve(optionsResponse(url.includes("binding_fast") ? "binding_fast" : "binding_default"));
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TaskLoopLauncher", () => {
  it("loads the configured Loop candidates and preselects the project default", async () => {
    render(<TaskLoopLauncher taskId="task_1" canDispatch loopRun={null} />);

    expect(await screen.findByRole("radio", { name: /分支开发 Loop/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: /快速修复 Loop/ })).toHaveProperty("checked", false);
    expect(screen.getByRole("radio", { name: /Linux Worker/ })).toHaveProperty("checked", true);
    expect(screen.getByText("分支开发 Loop v12 · Linux Worker · ht-agent")).toBeTruthy();
  });

  it("reloads execution targets for a newly selected Loop", async () => {
    const user = userEvent.setup();
    render(<TaskLoopLauncher taskId="task_1" canDispatch loopRun={null} />);

    await user.click(await screen.findByRole("radio", { name: /快速修复 Loop/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/tasks/task_1/loop/execution-options?bindingId=binding_fast",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    ));
    expect(screen.getByText("快速修复 Loop v8 · Linux Worker · ht-agent")).toBeTruthy();
  });

  it("freezes the selected Loop and execution target when starting a Run", async () => {
    const user = userEvent.setup();
    render(<TaskLoopLauncher taskId="task_1" canDispatch loopRun={null} />);

    await user.click(await screen.findByRole("radio", { name: /快速修复 Loop/ }));
    await screen.findByText("快速修复 Loop v8 · Linux Worker · ht-agent");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: { id: "loop_run_task_selected", engineKind: "graph_v1" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    await user.click(screen.getByRole("button", { name: "启动 Loop" }));

    const request = vi.mocked(fetch).mock.calls.at(-1)?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      command: "start",
      bindingId: "binding_fast",
      executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/loop-runs/loop_run_task_selected"));
  });
});
