// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskAcceptanceEvidence } from "./task-acceptance-evidence";

const missingReadiness = {
  ready: false,
  requiredChecks: ["delivery", "typecheck"],
  missingChecks: ["typecheck"],
  blockingChecks: [],
  policyErrors: [],
  latestEvidence: [{
    id: "evidence_delivery",
    checkKey: "delivery",
    status: "passed" as const,
    summary: "正式环境已发布",
    source: "mcp",
    finishedAt: "2026-08-01T09:00:00.000Z",
  }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TaskAcceptanceEvidence", () => {
  it("shows missing checks and keeps explicit acceptance disabled", () => {
    render(<TaskAcceptanceEvidence
      taskId="task_1"
      version={3}
      statusCategory="in_review"
      readiness={missingReadiness}
      canGovern
      canAccept
      onVersionChange={vi.fn()}
      onAccepted={vi.fn()}
    />);

    expect(screen.getByText("delivery")).toBeTruthy();
    expect(screen.getByText("typecheck")).toBeTruthy();
    expect(screen.getByText("未提交")).toBeTruthy();
    expect(screen.getByText("仍需提交：typecheck")).toBeTruthy();
    expect((screen.getByRole("button", { name: "通过验收" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("updates readiness after evidence submission and then accepts explicitly", async () => {
    const user = userEvent.setup();
    const onVersionChange = vi.fn();
    const onAccepted = vi.fn();
    const ready = {
      ...missingReadiness,
      ready: true,
      missingChecks: [],
      latestEvidence: [...missingReadiness.latestEvidence, {
        id: "evidence_typecheck",
        checkKey: "typecheck",
        status: "passed" as const,
        summary: "类型检查通过",
        source: "user",
        finishedAt: "2026-08-01T09:10:00.000Z",
      }],
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: { version: 4, readiness: ready },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: { version: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } })));

    const view = render(<TaskAcceptanceEvidence
      taskId="task_1"
      version={3}
      statusCategory="in_review"
      readiness={missingReadiness}
      canGovern
      canAccept
      onVersionChange={onVersionChange}
      onAccepted={onAccepted}
    />);
    await user.selectOptions(screen.getByLabelText("验收检查"), "typecheck");
    await user.type(screen.getByLabelText("证据摘要"), "类型检查通过");
    await user.type(screen.getByLabelText("证据详情"), "pnpm typecheck: 0 errors");
    await user.click(screen.getByRole("button", { name: "提交验收证据" }));

    await waitFor(() => expect(onVersionChange).toHaveBeenCalledWith(4));
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/tasks/task_1/commands/submit_acceptance_evidence", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText("所有必需检查均已通过，可以执行最终验收。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "通过验收" }) as HTMLButtonElement).disabled).toBe(false);

    view.rerender(<TaskAcceptanceEvidence
      taskId="task_1"
      version={5}
      statusCategory="in_review"
      readiness={missingReadiness}
      canGovern
      canAccept
      onVersionChange={onVersionChange}
      onAccepted={onAccepted}
    />);
    expect((screen.getByRole("button", { name: "通过验收" }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole("button", { name: "通过验收" }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/tasks/task_1/commands/accept", expect.objectContaining({ method: "POST" }));
    const acceptRequest = vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(acceptRequest.body))).toMatchObject({ expectedVersion: 5 });
  });

  it("preserves evidence input and shows an actionable error after submission fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      code: "version_conflict",
      error: "Task version conflict",
    }), { status: 409, headers: { "content-type": "application/json" } })));
    render(<TaskAcceptanceEvidence
      taskId="task_1"
      version={3}
      statusCategory="in_review"
      readiness={missingReadiness}
      canGovern
      canAccept
      onVersionChange={vi.fn()}
      onAccepted={vi.fn()}
    />);

    await user.type(screen.getByLabelText("证据摘要"), "本地检查通过");
    await user.type(screen.getByLabelText("证据详情"), "保留这段证据内容");
    await user.click(screen.getByRole("button", { name: "提交验收证据" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("任务已被更新，请刷新后重新提交证据"));
    expect((screen.getByLabelText("证据摘要") as HTMLInputElement).value).toBe("本地检查通过");
    expect((screen.getByLabelText("证据详情") as HTMLTextAreaElement).value).toBe("保留这段证据内容");
  });

  it("uses a newer parent Task version for the next evidence submission", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      code: "version_conflict",
      error: "Task version conflict",
    }), { status: 409, headers: { "content-type": "application/json" } })));
    const view = render(<TaskAcceptanceEvidence
      taskId="task_1"
      version={3}
      statusCategory="in_review"
      readiness={missingReadiness}
      canGovern
      canAccept
      onVersionChange={vi.fn()}
      onAccepted={vi.fn()}
    />);
    view.rerender(<TaskAcceptanceEvidence
      taskId="task_1"
      version={9}
      statusCategory="in_review"
      readiness={missingReadiness}
      canGovern
      canAccept
      onVersionChange={vi.fn()}
      onAccepted={vi.fn()}
    />);

    await user.selectOptions(screen.getByLabelText("验收检查"), "typecheck");
    await user.type(screen.getByLabelText("证据摘要"), "类型检查通过");
    await user.click(screen.getByRole("button", { name: "提交验收证据" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ expectedVersion: 9 });
  });

  it("does not expose evidence entry to users without governance permission", () => {
    render(<TaskAcceptanceEvidence
      taskId="task_1"
      version={3}
      statusCategory="in_review"
      readiness={missingReadiness}
      canGovern={false}
      canAccept={false}
      onVersionChange={vi.fn()}
      onAccepted={vi.fn()}
    />);

    expect(screen.queryByLabelText("证据摘要")).toBeNull();
    expect(screen.queryByRole("button", { name: "通过验收" })).toBeNull();
  });
});
