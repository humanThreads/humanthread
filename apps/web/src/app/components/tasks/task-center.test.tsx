// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskCenter, type TaskCenterProps } from "./task-center";

const routerPush = vi.fn();
const router = { push: routerPush };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("./task-detail", () => ({
  TaskDetail: ({ detail, onDismissIntent }: { detail: { task: { id: string; title: string; contentMarkdown: string | null } }; onDismissIntent(): void }) => (
    <div data-testid="task-detail-content">
      <h2>{detail.task.title}</h2>
      <p>{detail.task.contentMarkdown}</p>
    <Link href="/tasks?spaceKey=personal" aria-label="关闭详情" {...(onDismissIntent ? { onClick: onDismissIntent } : {})}>关闭</Link>
    </div>
  ),
}));

beforeEach(() => {
  routerPush.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TaskCenter", () => {
  it("anchors the detail panel inside the task workspace instead of the global shell", () => {
    const { container } = render(<TaskCenter {...props} />);

    expect(container.firstElementChild?.className).toContain("relative");
  });

  const props: TaskCenterProps = {
    collection: { listRows: [], boardGroups: [], calendar: { entries: [], unscheduled: [] }, relationCounts: { assigned: 2, created: 1, participating: 0, following: 0, overdue: 1, completed: 3 }, total: 0 },
    query: { spaceKey: "personal", relation: "assigned", view: "list", status: [], assignee: [], priority: [], project: [], group: "status", sort: "updated_desc" },
    queryString: "spaceKey=personal&relation=assigned",
    spaceId: "space_personal",
    canManageSettings: true,
    savedViews: [{ id: "view_1", name: "本周待办", filters: { relation: "assigned" } }],
    statusDefinitions: [], labels: [], projects: [],
  };

  const task = (id: string, title: string) => ({
    id, shortId: id.toUpperCase(), title, statusCategory: "todo",
    status: { id: null, name: "待处理", category: "todo", color: "#57606a" },
    visibility: "private", priority: 0, startAt: null, dueAt: null, overdue: false,
    version: 1, createdAt: new Date(), updatedAt: new Date(), createdById: "user_1",
    assignee: null, project: null, blocker: null, labels: [], childCount: 0, automation: null,
  });

  const detail = (id: string, title: string, contentMarkdown: string) => ({
    task: { id, title, contentMarkdown },
    capabilities: {},
  }) as never;

  it("fills the workspace with relation views, toolbar, saved views and settings", () => {
    const { container } = render(<TaskCenter {...props} />);
    expect(container.firstElementChild?.className).toContain("h-full min-h-0 overflow-hidden");
    expect(screen.getByRole("link", { name: /分配给我/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /已归档/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "本周待办" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存当前视图" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "状态设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "标签设置" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "列表视图" })).toBeTruthy();
  });

  it("submits search, multi-value status/project and sort as URL-backed filters", () => {
    render(<TaskCenter {...props} queryString="spaceKey=personal&relation=assigned&view=list&status=todo&status=in_review&project=project_1&sort=due_asc" projects={[{ id: "project_1", name: "HumanThread" }]} />);

    const form = screen.getByRole("form", { name: "筛选任务" });
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/tasks");
    expect(screen.getByLabelText("搜索任务").getAttribute("name")).toBe("search");
    expect(screen.getByLabelText("排序方式").getAttribute("name")).toBe("sort");
    const statusInputs = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="status"]')];
    const projectInputs = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="project"]')];
    expect(statusInputs).toHaveLength(6);
    expect(projectInputs).toHaveLength(2);
    expect(statusInputs.find((input) => input.value === "todo")?.checked).toBe(true);
    expect(statusInputs.find((input) => input.value === "in_review")?.checked).toBe(true);
    expect(statusInputs.find((input) => input.value === "completed")?.checked).toBe(false);
    expect(projectInputs.find((input) => input.value === "project_1")?.checked).toBe(true);
    expect(projectInputs.find((input) => input.value === "__none__")?.checked).toBe(false);
    expect(form.querySelector('input[type="hidden"][name="spaceKey"]')?.getAttribute("value")).toBe("personal");
    expect(form.querySelector('input[type="hidden"][name="relation"]')?.getAttribute("value")).toBe("assigned");
    expect(form.querySelector('input[type="hidden"][name="view"]')?.getAttribute("value")).toBe("list");
  });

  it("restores multi-value saved view filters into the URL", () => {
    render(<TaskCenter {...props} savedViews={[{ id: "view_multi", name: "进行中与待验收", filters: { relation: "assigned", view: "list", status: ["todo", "in_review"], project: ["project_1", "__none__"], group: "status", sort: "due_asc" } }]} />);

    const link = screen.getByRole("link", { name: "进行中与待验收" });
    const url = new URL(link.getAttribute("href")!, "https://humanthread.test");
    expect(url.searchParams.get("status")).toBe("todo,in_review");
    expect(url.searchParams.get("project")).toBe("project_1,__none__");
    expect(url.searchParams.get("relation")).toBe("assigned");
  });

  it("persists and deletes private saved views", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, view: { id: "view_new" } }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskCenter {...props} />);
    await user.click(screen.getByRole("button", { name: "保存当前视图" }));
    await user.type(screen.getByLabelText("视图名称"), "我的发布任务");
    await user.click(screen.getByRole("button", { name: "确认保存视图" }));
    expect(fetch).toHaveBeenCalledWith("/api/task-saved-views", expect.objectContaining({ method: "POST" }));

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { count: 1 } }), { status: 200, headers: { "content-type": "application/json" } }));
    await user.click(screen.getByRole("button", { name: "删除本周待办" }));
    expect(fetch).toHaveBeenLastCalledWith("/api/task-saved-views", expect.objectContaining({ method: "DELETE" }));
  });

  it("renames a private saved view without losing its query", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { count: 1 } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<TaskCenter {...props} />);
    await user.click(screen.getByRole("button", { name: "重命名本周待办" }));
    await user.clear(screen.getByLabelText("视图名称"));
    await user.type(screen.getByLabelText("视图名称"), "发布待办");
    await user.click(screen.getByRole("button", { name: "确认重命名视图" }));
    expect(fetch).toHaveBeenCalledWith("/api/task-saved-views", expect.objectContaining({ method: "PATCH" }));
  });

  it("exposes bulk assignment, status, priority, project and archive actions after selection", async () => {
    const task = { id: "task_1", shortId: null, title: "发布", statusCategory: "todo", status: { id: null, name: "待处理", category: "todo", color: "#57606a" }, visibility: "private", priority: 0, startAt: null, dueAt: null, overdue: false, version: 1, createdAt: new Date(), updatedAt: new Date(), createdById: "user_1", assignee: null, project: null, blocker: null, labels: [], childCount: 0, automation: null };
    render(<TaskCenter {...props} collection={{ ...props.collection, listRows: [task] }} initialSelectedTaskIds={["task_1"]} members={[{ id: "user_2", name: "Reviewer" }]} />);
    expect(screen.getByLabelText("批量负责人")).toBeTruthy();
    expect(screen.getByLabelText("批量状态")).toBeTruthy();
    expect(screen.getByLabelText("批量优先级")).toBeTruthy();
    expect(screen.getByLabelText("批量项目")).toBeTruthy();
    expect(screen.getByRole("button", { name: "批量归档" })).toBeTruthy();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 2 } }), { status: 200, headers: { "content-type": "application/json" } }));
    await userEvent.setup().selectOptions(screen.getByLabelText("批量优先级"), "2");
    expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/commands/update_fields", expect.objectContaining({ method: "POST" }));
  });

  it("exposes bulk restore instead of destructive bulk actions for archived tasks", async () => {
    const task = { id: "task_1", shortId: null, title: "发布", statusCategory: "todo", status: { id: null, name: "待处理", category: "todo", color: "#57606a" }, visibility: "private", priority: 0, startAt: null, dueAt: null, overdue: false, version: 1, createdAt: new Date(), updatedAt: new Date(), createdById: "user_1", assignee: null, project: null, blocker: null, labels: [], childCount: 0, automation: null };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 2 } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<TaskCenter {...props} query={{ ...props.query, relation: "archived" }} collection={{ ...props.collection, listRows: [task] }} initialSelectedTaskIds={["task_1"]} />);

    expect(screen.getByRole("button", { name: "批量恢复" })).toBeTruthy();
    expect(screen.queryByLabelText("批量状态")).toBeNull();
    expect(screen.queryByRole("button", { name: "批量归档" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "批量恢复" }));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/commands/restore", expect.objectContaining({ method: "POST" }));
  });

  it("keeps bulk status command IDs within the API limit for long internal task IDs", async () => {
    const longTaskId = `task:space:company:${"company_".repeat(8)}:${"command_".repeat(8)}`;
    const task = { id: longTaskId, shortId: null, title: "发布", statusCategory: "todo", status: { id: null, name: "待处理", category: "todo", color: "#57606a" }, visibility: "private", priority: 0, startAt: null, dueAt: null, overdue: false, version: 1, createdAt: new Date(), updatedAt: new Date(), createdById: "user_1", assignee: null, project: null, blocker: null, labels: [], childCount: 0, automation: null };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 2 } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<TaskCenter {...props} collection={{ ...props.collection, listRows: [task] }} initialSelectedTaskIds={[longTaskId]} />);

    await userEvent.setup().selectOptions(screen.getByLabelText("批量状态"), "start");

    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { commandId: string };
    expect(body.commandId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("switches the shared collection between board and calendar projections", () => {
    const { rerender } = render(<TaskCenter {...props} query={{ ...props.query, view: "board" }} />);
    expect(screen.getByRole("region", { name: "任务看板" })).toBeTruthy();
    expect(screen.getByLabelText("看板分组").getAttribute("name")).toBe("group");
    rerender(<TaskCenter {...props} query={{ ...props.query, view: "calendar" }} />);
    expect(screen.getByLabelText("移动端任务议程")).toBeTruthy();
  });

  it("navigates task clicks to the full page without opening the legacy side panel first", async () => {
    const user = userEvent.setup();
    const item = task("task_a", "任务 A");
    render(<TaskCenter {...props} collection={{ ...props.collection, listRows: [item], total: 1 }} queryString="spaceKey=personal" />);

    await user.click(screen.getAllByRole("link", { name: "任务 A" })[0]!);

    expect(screen.queryByLabelText("任务详情侧栏")).toBeNull();
    expect(screen.queryByText("正在加载任务...")).toBeNull();
  });

  it("keeps a deep-linked task detail aligned with the current query", async () => {
    const tasks = [task("task_a", "任务 A"), task("task_b", "任务 B")];
    const collection = { ...props.collection, listRows: tasks, total: tasks.length };
    const { rerender } = render(
      <TaskCenter {...props} collection={collection} queryString="spaceKey=personal&taskId=task_a" selectedDetail={detail("task_a", "任务 A", "A 唯一正文")} />,
    );

    expect(screen.getByText("A 唯一正文")).toBeTruthy();
    rerender(<TaskCenter {...props} collection={collection} queryString="spaceKey=personal&taskId=task_b" selectedDetail={detail("task_b", "任务 B", "B 迟到正文")} />);
    await waitFor(() => expect(screen.getByText("B 迟到正文")).toBeTruthy());
    expect(screen.queryByText("A 唯一正文")).toBeNull();
  });

  it("does not reopen detail when an old server snapshot arrives after close intent", async () => {
    const user = userEvent.setup();
    const tasks = [task("task_a", "任务 A")];
    const collection = { ...props.collection, listRows: tasks, total: tasks.length };
    const { rerender } = render(
      <TaskCenter {...props} collection={collection} queryString="spaceKey=personal&taskId=task_a" selectedDetail={detail("task_a", "任务 A", "A 唯一正文")} />,
    );

    await user.click(screen.getByRole("link", { name: "关闭详情" }));
    expect(screen.queryByLabelText("任务详情侧栏")).toBeNull();

    rerender(<TaskCenter {...props} collection={collection} queryString="spaceKey=personal&taskId=task_a" selectedDetail={detail("task_a", "任务 A", "A 迟到正文")} />);
    expect(screen.queryByLabelText("任务详情侧栏")).toBeNull();
    expect(screen.queryByText("A 迟到正文")).toBeNull();
  });

  it("dismisses on click-away while keeping detail and task triggers inside the interaction boundary", async () => {
    const user = userEvent.setup();
    const tasks = [task("task_a", "任务 A"), task("task_b", "任务 B")];
    const collection = { ...props.collection, listRows: tasks, total: tasks.length };
    render(
      <TaskCenter {...props} collection={collection} queryString="spaceKey=personal&relation=assigned&taskId=task_a" selectedDetail={detail("task_a", "任务 A", "A 唯一正文")} />,
    );

    await user.click(screen.getByTestId("task-detail-content"));
    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.getByText("A 唯一正文")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "保存当前视图" }));
    expect(routerPush).toHaveBeenCalledWith("/tasks?spaceKey=personal&relation=assigned");
    expect(screen.queryByLabelText("任务详情侧栏")).toBeNull();
  });

  it("dismisses on Escape except during IME composition and cleans up its listener", async () => {
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const tasks = [task("task_a", "任务 A")];
    const collection = { ...props.collection, listRows: tasks, total: tasks.length };
    const view = render(
      <TaskCenter {...props} collection={collection} queryString="spaceKey=personal&relation=assigned&taskId=task_a" selectedDetail={detail("task_a", "任务 A", "A 唯一正文")} />,
    );

    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.getByText("A 唯一正文")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(routerPush).toHaveBeenCalledWith("/tasks?spaceKey=personal&relation=assigned");
    expect(screen.queryByLabelText("任务详情侧栏")).toBeNull();

    const keydownHandler = addEventListener.mock.calls.find(([type]) => type === "keydown")?.[1];
    expect(keydownHandler).toBeTruthy();
    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith("keydown", keydownHandler);
  });
});
