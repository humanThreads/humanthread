// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_EDITOR_MODES, TASK_SAVE_CONFLICT_MESSAGE, TaskEditor } from "./task-editor";

vi.mock("next/dynamic", () => ({
  default: () => function CodeMirrorStub(props: {
    value: string;
    onChange(value: string): void;
    "aria-label"?: string;
  } & ComponentPropsWithoutRef<"textarea">) {
    const { value, onChange, ...textareaProps } = props;
    return <textarea {...textareaProps} value={value} onChange={(event) => onChange(event.target.value)} />;
  },
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("TaskEditor", () => {
  const props = {
    taskId: "task_1",
    title: "发布内部版本",
    contentMarkdown: "# 验收\n\n- [ ] 完成检查",
    version: 3,
    canEdit: true,
    onSaved: vi.fn(),
  };

  it("exposes rich edit, preview and source modes with a stable scroll owner", async () => {
    const user = userEvent.setup();
    const { container } = render(<TaskEditor {...props} />);

    expect(TASK_EDITOR_MODES).toEqual(["rich", "preview", "source"]);
    expect(screen.getByRole("button", { name: "富文本" }).getAttribute("title")).toBe("富文本");
    expect(screen.getByRole("button", { name: "预览" }).getAttribute("title")).toBe("预览");
    expect(screen.getByRole("button", { name: "Markdown 源码" }).getAttribute("title")).toBe("Markdown 源码");
    expect(container.querySelector("[data-task-editor-scroll]")?.className).toContain("h-full min-h-0 overflow-y-auto overscroll-contain");

    await user.click(screen.getByRole("button", { name: "预览" }));
    expect(screen.getByRole("heading", { name: "验收" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Markdown 源码" }));
    expect(screen.getByLabelText("任务 Markdown 正文")).toBeTruthy();
  });

  it("renders read-only Markdown without mutation controls", () => {
    render(<TaskEditor {...props} canEdit={false} />);

    expect(screen.getByRole("heading", { name: "验收" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存任务正文" })).toBeNull();
    expect(screen.queryByRole("button", { name: "富文本" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Markdown 源码" })).toBeNull();
  });

  it.each(["", "   \n"])('renders %j as the same action-free empty state', (contentMarkdown) => {
    render(<TaskEditor {...props} contentMarkdown={contentMarkdown} />);

    expect(screen.getByText("暂无任务正文")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存任务正文" })).toBeNull();
    expect(screen.queryByRole("button", { name: "富文本" })).toBeNull();
    expect(screen.queryByLabelText("任务 Markdown 正文")).toBeNull();
  });

  it("saves the current Markdown with optimistic version metadata", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { taskId: "task_1", version: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<TaskEditor {...props} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Markdown 源码" }));
    fireEvent.change(screen.getByLabelText("任务 Markdown 正文"), { target: { value: "# 新正文\n\n保留草稿" } });
    await user.click(screen.getByRole("button", { name: "保存任务正文" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [path, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(path).toBe("/api/tasks/task_1");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expectedVersion: 3,
      contentMarkdown: "# 新正文\n\n保留草稿",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ version: 4, contentMarkdown: "# 新正文\n\n保留草稿" }));
  });

  it("preserves the local draft and unsupported source nodes after a conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      code: "version_conflict",
      error: "stale version",
    }), { status: 409, headers: { "content-type": "application/json" } }));
    render(<TaskEditor {...props} />);

    await user.click(screen.getByRole("button", { name: "Markdown 源码" }));
    const source = "# 草稿\n\n<details><summary>扩展</summary>保留</details>";
    fireEvent.change(screen.getByLabelText("任务 Markdown 正文"), { target: { value: source } });
    await user.click(screen.getByRole("button", { name: "预览" }));
    await user.click(screen.getByRole("button", { name: "Markdown 源码" }));
    expect((screen.getByLabelText("任务 Markdown 正文") as HTMLTextAreaElement).value).toBe(source);

    await user.click(screen.getByRole("button", { name: "保存任务正文" }));
    expect((await screen.findByRole("alert")).textContent).toContain(TASK_SAVE_CONFLICT_MESSAGE);
    expect((screen.getByLabelText("任务 Markdown 正文") as HTMLTextAreaElement).value).toBe(source);
    expect(JSON.parse(localStorage.getItem("humanthread:task-draft:task_1") ?? "{}")).toMatchObject({
      contentMarkdown: source,
      baseVersion: 3,
    });
  });
});
