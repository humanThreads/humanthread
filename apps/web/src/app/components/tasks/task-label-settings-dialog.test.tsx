// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskLabelSettingsDialog } from "./task-label-settings-dialog";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TaskLabelSettingsDialog", () => {
  it("submits labels against the selected Space with a color swatch", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, label: { id: "label_new" } }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskLabelSettingsDialog open spaceId="space_company" labels={[]} onOpenChange={vi.fn()} />);
    await user.type(screen.getByLabelText("标签名称"), "安全");
    await user.click(screen.getByRole("button", { name: "创建标签" }));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({ spaceId: "space_company", name: "安全" });
    expect(screen.getByLabelText("标签颜色")).toBeTruthy();
  });

  it("keeps an in-use label and explains the conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: false, code: "version_conflict", error: "Task label is in use" }), { status: 409, headers: { "content-type": "application/json" } }));
    render(<TaskLabelSettingsDialog open spaceId="space_1" labels={[{ id: "label_1", name: "安全", color: "#cf222e" }]} onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "删除安全" }));
    expect((await screen.findByRole("alert")).textContent).toContain("请先从任务中移除该标签");
  });
});
