// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStatusSettingsDialog, validateTaskStatusDraft } from "./task-status-settings-dialog";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TaskStatusSettingsDialog", () => {
  it("rejects unclassified statuses and exposes fixed business categories", () => {
    expect(validateTaskStatusDraft({ name: "等待", key: "waiting", category: "" as never, color: "#0969da" })).toBe("请选择业务状态类别");
    render(<TaskStatusSettingsDialog open spaceId="space_1" definitions={[]} onOpenChange={vi.fn()} />);
    expect(screen.getByLabelText("业务状态类别")).toBeTruthy();
    expect(screen.getByText("类别决定业务流转，创建后不可随意变更。")).toBeTruthy();
  });

  it("shows migration guidance when deleting an in-use definition", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: false, code: "version_conflict", error: "Task status definition is in use" }), { status: 409, headers: { "content-type": "application/json" } }));
    render(<TaskStatusSettingsDialog open spaceId="space_1" definitions={[{ id: "status_1", key: "doing", name: "开发中", category: "in_progress", color: "#1f883d", sortOrder: 1 }]} onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "删除开发中" }));
    expect((await screen.findByRole("alert")).textContent).toContain("请先迁移使用该状态的任务");
  });
});
