// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveSessionWorkspace } from "./live-session-workspace";

const spaces = [
  { id: "space_personal", name: "个人空间" },
  { id: "space_company", name: "Gelsang" },
];
const projects = [
  { id: "project_1", name: "humanthread", spaceId: "space_company" },
];
const tasks = [
  { id: "task_1", title: "实现在线 TUI", projectId: "project_1", statusCategory: "todo" },
];
const devices = [
  { id: "device_1", name: "Mac Studio", runtimeReady: true, online: true },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Live session workspace", () => {
  async function openCreateDialog() {
    await userEvent.click(screen.getByRole("button", { name: "新建会话" }));
    await screen.findByRole("dialog", { name: "新建在线会话" });
  }

  it("sorts live sessions ahead of history and marks history with a distinct dot", () => {
    const live = { ...workerSession(), id: "a".repeat(32), targetDisplayName: "live-worker", status: "running" as const, history: false };
    const archived = { ...workerSession(), id: "c".repeat(32), targetDisplayName: "old-worker", history: true };
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      // The store returns newest-first, so the archived row arrives first.
      sessions={[archived, live]}
      workerPools={workerPools}
    />);

    const items = [...document.querySelectorAll(".tui-session-item")];
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("live-worker"),
      expect.stringContaining("old-worker"),
    ]);
    expect(items[1]?.textContent).toContain("历史");
    expect(items[0]?.querySelector(".tui-status-dot")?.getAttribute("data-tone")).toBe("success");
    expect(items[1]?.querySelector(".tui-status-dot")?.getAttribute("data-tone")).toBe("history");
    expect(items[1]?.querySelector(".tui-status-dot")?.getAttribute("aria-label")).toBe("历史会话");
  });

  it("renders the confirmed three-column workspace structure", () => {
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[workerSession()]}
      workerPools={workerPools}
    />);

    expect(document.querySelector(".tui-layout")).toBeTruthy();
    expect(document.querySelector(".tui-session-rail")).toBeTruthy();
    expect(document.querySelector(".tui-context-panel")).toBeTruthy();
    expect(document.querySelector(".tui-terminal-shell")).toBeTruthy();
  });

  it("creates a taskless direct Agent session without forcing a project or task", async () => {
    const created = {
      id: "a".repeat(32),
      kind: "agent",
      surface: "web",
      spaceId: "space_personal",
      projectId: null,
      taskId: null,
      executionPolicy: "direct",
      target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
      targetDisplayName: "Mac Studio",
      businessRun: null,
      status: "starting",
      controlState: "detached",
      journal: { status: "ready", retentionDays: 30, firstSequence: 0, lastSequence: 0 },
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    } as const;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { session: created, ticket: null } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={[]}
    />);

    await openCreateDialog();
    await userEvent.click(screen.getByRole("button", { name: "创建会话" }));

    const createCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse(String(createCall?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: "agent",
      projectId: null,
      taskId: null,
      executionPolicy: "direct",
      target: { type: "agent_device", deviceId: "device_1" },
    });
    expect(screen.getByLabelText(`在线终端 ${"a".repeat(32)}`)).toBeTruthy();
  });

  it("places the create controls in reading order inside the creation dialog", async () => {
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={[]}
    />);

    await openCreateDialog();
    const dialog = screen.getByRole("dialog", { name: "新建在线会话" });
    const space = screen.getByLabelText("空间");
    const project = screen.getByLabelText("项目");
    const task = screen.getByLabelText("任务");
    const type = screen.getByRole("group", { name: "执行目标" });
    expect(dialog.contains(space)).toBe(true);
    expect(space.compareDocumentPosition(project) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(project.compareDocumentPosition(task) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(task.compareDocumentPosition(type) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("任务（可选）")).toBeTruthy();
  });

  it("explains the missing online device instead of failing silently", async () => {
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={[{ id: "device_offline", name: "Offline Mac", runtimeReady: true, online: false }]}
      sessions={[]}
      workerPools={[]}
    />);

    await openCreateDialog();
    await userEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(screen.getByRole("status").textContent).toContain("请选择在线的 Agent 设备");
  });

  it("creates a Web Agent session against an online device", async () => {
    // The workspace must call the API itself: a Server Component cannot pass
    // request handlers into a Client Component, which previously made the page
    // fail to render.
    const created = {
      id: "a".repeat(32),
      kind: "agent",
      surface: "web",
      spaceId: "space_company",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "loop",
      target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
      targetDisplayName: "Mac Studio",
      businessRun: null,
      status: "starting",
      controlState: "detached",
      journal: { status: "ready", retentionDays: 30, firstSequence: 0, lastSequence: 0 },
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    } as const;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { session: created, ticket: null } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={[{ projectId: "project_1", poolId: "b".repeat(32), displayName: "ht-agnet", online: true }]}
    />);

    await openCreateDialog();
    await userEvent.click(screen.getByRole("button", { name: "Agent" }));
    await userEvent.selectOptions(screen.getByLabelText("空间"), "space_company");
    await userEvent.selectOptions(screen.getByLabelText("项目"), "project_1");
    await userEvent.selectOptions(screen.getByLabelText("任务"), "task_1");
    await userEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/live-sessions", expect.objectContaining({ method: "POST" }));
    const createCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse(String(createCall?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: "agent",
      spaceId: "space_company",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "loop",
      target: { type: "agent_device", deviceId: "device_1" },
    });
    expect(screen.getByLabelText(`在线终端 ${"a".repeat(32)}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: `打开 ${"a".repeat(32)}` }).getAttribute("aria-current")).toBe("true");
  });

  it("keeps Worker selectable and exposes the project Pool once a project is chosen", async () => {
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={[{ projectId: "project_1", poolId: "b".repeat(32), displayName: "ht-agnet", online: true }]}
    />);

    await openCreateDialog();
    await userEvent.click(screen.getByRole("button", { name: "Worker" }));
    await userEvent.selectOptions(screen.getByLabelText("空间"), "space_company");
    await userEvent.selectOptions(screen.getByLabelText("项目"), "project_1");

    expect(screen.getByRole("button", { name: "Worker" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("项目 Worker Pool").textContent).toContain("ht-agnet");
    expect(screen.queryByLabelText("Worker Pool")).toBeNull();
  });

  it("shows the available Worker target for a project with an online Pool", async () => {
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={[{ projectId: "project_1", poolId: "b".repeat(32), displayName: "ht-agnet", online: true }]}
    />);

    await openCreateDialog();
    await userEvent.click(screen.getByRole("button", { name: "Worker" }));
    await userEvent.selectOptions(screen.getByLabelText("空间"), "space_company");
    await userEvent.selectOptions(screen.getByLabelText("项目"), "project_1");
    expect(screen.getByLabelText("项目 Worker Pool").textContent).toContain("在线");
    expect((screen.getByRole("button", { name: "创建会话" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("labels the Worker target state immediately after choosing a project", async () => {
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={[{ projectId: "project_1", poolId: "b".repeat(32), displayName: "ht-agnet", online: true }]}
    />);

    await openCreateDialog();
    await userEvent.click(screen.getByRole("button", { name: "Worker" }));
    await userEvent.selectOptions(screen.getByLabelText("空间"), "space_company");
    await userEvent.selectOptions(screen.getByLabelText("项目"), "project_1");

    expect(screen.queryByText("选择项目后解析")).toBeNull();
    expect(screen.getByLabelText("项目 Worker Pool").textContent).toContain("ht-agnet · 在线");
  });

  it("explains why Worker cannot be created for an unbound project", async () => {
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={[]}
    />);

    await openCreateDialog();
    await userEvent.click(screen.getByRole("button", { name: "Worker" }));
    await userEvent.selectOptions(screen.getByLabelText("空间"), "space_company");
    await userEvent.selectOptions(screen.getByLabelText("项目"), "project_1");
    await userEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(screen.getByRole("status").textContent).toContain("未绑定 Worker Pool");
  });

  it("explains local cache deletion without exposing absolute paths on Web", async () => {
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={[]}
    />);

    await openCreateDialog();
    await userEvent.hover(screen.getByRole("button", { name: "本地会话缓存说明" }));

    expect(screen.getByText("本地缓存删除后，刷新页面不会恢复这部分内容；服务端只做实时转发，不保留会话正文。")).toBeTruthy();
    expect(screen.queryByText(/\/Users\//u)).toBeNull();
  });
});

const modelSiteId = "c".repeat(32);

function modelOptionsBody() {
  return {
    ok: true,
    result: {
      sites: [
        { id: modelSiteId, name: "mc", models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }] },
        { id: "d".repeat(32), name: "empty-site", models: [] },
      ],
      default: { siteId: modelSiteId, model: "gpt-5.6-terra", reasoningEffort: "high" },
      defaultSource: "project-binding",
      unavailableReason: null,
    },
  };
}

/**
 * The workspace owns its fetches, so the model-options read and the session
 * create call share one stub. The create response is returned only for POSTs.
 */
function stubFetchForModelOptions(created: unknown) {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return { ok: true, json: async () => ({ ok: true, result: { session: created, ticket: null } }) };
    }
    calls.push({ url: String(url) });
    return { ok: true, json: async () => modelOptionsBody() };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function workerSession() {
  return {
    id: "b".repeat(32),
    kind: "worker",
    surface: "web",
    spaceId: "space_company",
    projectId: "project_1",
    taskId: null,
    executionPolicy: "direct",
    target: { type: "worker_pool", workerPoolId: "e".repeat(32), displayName: "ht-agnet" },
    targetDisplayName: "ht-agnet",
    businessRun: null,
    status: "starting",
    controlState: "detached",
    journal: { status: "ready", retentionDays: 30, firstSequence: 0, lastSequence: 0 },
    model: null,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  } as const;
}

const workerPools = [{ projectId: "project_1", poolId: "e".repeat(32), displayName: "ht-agnet", online: true }];

async function selectWorkerProject() {
  await userEvent.click(screen.getByRole("button", { name: "新建会话" }));
  await screen.findByRole("dialog", { name: "新建在线会话" });
  await userEvent.click(screen.getByRole("button", { name: "Worker" }));
  // The project list is filtered by the active kind, so wait for the option
  // before selecting it.
  // The fixture project lives in the company space, so the space select must be
  // switched before the project becomes available.
  await userEvent.selectOptions(screen.getByLabelText("空间"), "space_company");
  await screen.findByRole("option", { name: /humanthread/ });
  await userEvent.selectOptions(screen.getByLabelText("项目"), "project_1");
  await screen.findByLabelText("模型站点");
}

describe("Live session model selector", () => {
  it("sends the selected model when creating a worker session", async () => {
    const calls = stubFetchForModelOptions(workerSession());
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={workerPools}
    />);

    await selectWorkerProject();
    await screen.findByLabelText("模型站点");
    await userEvent.selectOptions(screen.getByLabelText("模型站点"), modelSiteId);
    await userEvent.selectOptions(screen.getByLabelText("模型"), "gpt-5.6-terra");
    await userEvent.selectOptions(screen.getByLabelText("推理强度"), "high");
    await userEvent.click(screen.getByRole("button", { name: "创建会话" }));

    const create = calls.find((call) => call.body);
    expect(create?.body).toMatchObject({
      modelSelection: { siteId: modelSiteId, model: "gpt-5.6-terra", reasoningEffort: "high" },
    });
  });

  it("omits the selection when the user keeps the default", async () => {
    const calls = stubFetchForModelOptions(workerSession());
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={workerPools}
    />);

    await selectWorkerProject();
    await screen.findByLabelText("模型站点");
    await userEvent.click(screen.getByRole("button", { name: "创建会话" }));

    const create = calls.find((call) => call.body);
    expect(create?.body).toMatchObject({ modelSelection: null });
  });

  it("disables a site with an empty catalogue so it cannot be submitted", async () => {
    stubFetchForModelOptions(workerSession());
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={workerPools}
    />);

    await selectWorkerProject();
    const option = await screen.findByRole("option", { name: /empty-site/ }) as HTMLOptionElement;

    // jsdom exposes disabled as a DOM property; this project does not load the
    // jest-dom matchers into the test environment.
    expect(option.disabled).toBe(true);
  });

  it("labels the default option with its source", async () => {
    stubFetchForModelOptions(workerSession());
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={workerPools}
    />);

    await selectWorkerProject();
    const select = await screen.findByLabelText("模型站点");

    expect(select.textContent).toContain("项目默认");
  });

  it("keeps the create flow working when the model options request fails", async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return { ok: true, json: async () => ({ ok: true, result: { session: workerSession(), ticket: null } }) };
      }
      return { ok: false, json: async () => ({ ok: false, error: "options unavailable" }) };
    }));
    render(<LiveSessionWorkspace
      spaces={spaces}
      projects={projects}
      tasks={tasks}
      devices={devices}
      sessions={[]}
      workerPools={workerPools}
    />);

    await selectWorkerProject();
    await userEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(calls[0]).toMatchObject({ modelSelection: null });
  });
});
