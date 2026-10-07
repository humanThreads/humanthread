import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("../../../lib/workbench/workbench-route-auth", () => ({ requireWorkbenchSession: vi.fn().mockResolvedValue({ session: { context: { userId: "user_owner", teamId: "team_1" }, loginEmail: "owner@example.com", account: { name: "Owner" } } }) }));
vi.mock("../../../lib/workbench/workbench-companies", () => ({ getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([{ key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_1" }]) }));
vi.mock("../../../lib/tasks/task-read-model", () => ({ getTaskDetailView: vi.fn().mockResolvedValue({ task: { id: "task_1", title: "等待验收", space: { id: "space_1" } }, capabilities: {} }) }));
vi.mock("../../../lib/tasks/task-settings", () => ({ listTaskLabelDefinitions: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../lib/orchestration/agent-read-model", () => ({ listTaskAgentProfiles: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../lib/workbench/workbench-projects", () => ({ getWorkbenchProjects: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../lib/workbench/workbench-settings", () => ({ getWorkbenchCompanyMembers: vi.fn().mockResolvedValue({ company: null, members: [] }) }));
vi.mock("../../../lib/workbench/workbench-avatar", () => ({ getWorkbenchShellLoginProps: vi.fn().mockReturnValue({ loginName: "Owner", loginAvatarSrc: null }) }));
vi.mock("../../components/tasks/task-detail", () => ({ TaskDetail: ({ layout }: { layout: string }) => createElement("div", { "data-layout": layout }, "共享任务详情") }));
vi.mock("../../components/workbench-shell", () => ({ WorkbenchShell: ({ children, contentMode }: { children: ReactNode; contentMode: string }) => createElement("main", { "data-content-mode": contentMode }, children) }));

import { getTaskDetailView } from "../../../lib/tasks/task-read-model";
import TaskDetailPage, { TASK_DETAIL_SECTION_TITLES, dynamic } from "./page";

describe("Task detail page", () => {
  it("uses the shared user Task detail in workspace mode", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(TASK_DETAIL_SECTION_TITLES).toEqual(["任务字段", "正文", "协作", "关联", "Loop"]);
    const markup = renderToStaticMarkup(await TaskDetailPage({ params: Promise.resolve({ taskId: "task_1" }) }));
    expect(getTaskDetailView).toHaveBeenCalledWith({ userId: "user_owner", taskId: "task_1", includeArchived: true });
    expect(markup).toContain('data-content-mode="workspace"');
    expect(markup).toContain('data-layout="page"');
    expect(markup).toContain("共享任务详情");
    expect(markup).not.toContain("队列位置");
    expect(markup).not.toContain("所属工作流");
  });

  it("decodes the dynamic route parameter before loading a colon-delimited Task ID", async () => {
    vi.mocked(getTaskDetailView).mockClear();
    const taskId = "task:space:company:company_1:command_1";

    await TaskDetailPage({ params: Promise.resolve({ taskId: encodeURIComponent(taskId) }) });

    expect(getTaskDetailView).toHaveBeenCalledWith({ userId: "user_owner", taskId, includeArchived: true });
  });
});
