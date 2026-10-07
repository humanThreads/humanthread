import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { WORKBENCH_NAV_GROUPS, WORKBENCH_NAV_ITEMS } from "./workbench-nav";
import {
  WorkbenchAppShell,
  WorkbenchShell,
} from "./workbench-shell";
import { WorkbenchUserMenu } from "./workbench-user-menu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("workbench shell navigation", () => {
  it("groups navigation around the Loop delivery lifecycle", () => {
    expect(WORKBENCH_NAV_GROUPS.map((group) => group.label)).toEqual(["推进", "自动化", "协作", "复盘"]);
    expect(WORKBENCH_NAV_GROUPS[1].items).toEqual(["loops", "agents", "live-sessions", "loop-runs"]);
  });
  it("keeps the confirmed workbench routes in order", () => {
    expect(WORKBENCH_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/dashboard",
      "/tasks",
      "/agents",
      "/live-sessions",
      "/loops",
      "/loop-runs",
      "/notifications",
      "/team",
      "/projects",
      "/documents",
      "/reports",
      "/templates",
      "/settings/account",
    ]);
  });

  it("uses my workbench as the default home entry", () => {
    expect(WORKBENCH_NAV_ITEMS[0]).toMatchObject({
      href: "/dashboard",
      label: "我的工作台",
      key: "workbench",
    });
  });

  it("keeps login forms out of the workbench shell", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "workbench",
        title: "我的工作台",
        subtitle: "当前线程",
        loginEmail: null,
      }),
    );

    expect(markup).not.toContain("下载客户端");
    expect(markup).not.toContain("退出登录");
    expect(markup).not.toContain("设备与 Agent");
    expect(markup).toContain("HumanThread");
    expect(markup).toContain("/brand/humanthread-mark.svg");
    expect(markup).toContain("/search");
    expect(markup).toContain('aria-label="快速创建事项"');
    expect(markup).toContain('aria-label="站内信"');
    expect(markup).not.toContain("/brand/humanthread-logo.svg");
  });

  it("keeps the mobile search control icon-only without losing its accessible name", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "agents",
        title: "客户端下载",
        subtitle: "发行目录",
        loginEmail: "review@example.com",
      }),
    );

    expect(markup).toContain('aria-label="搜索任务、项目、文档、成员"');
    expect(markup).toContain('<span class="hidden font-medium sm:inline">搜索</span>');
  });

  it("keeps the sidebar compact and icon-led", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "workbench",
        title: "我的工作台",
        subtitle: "当前线程",
        loginEmail: "alice@example.com",
        notificationUnreadCount: 7,
      }),
    );

    expect(markup).toContain("首页");
    expect(markup).toContain("推进");
    expect(markup).toContain("自动化");
    expect(markup).toContain('aria-label="打开工作台导航，当前栏目为我的工作台"');
    expect(markup).toContain("任务");
    expect(markup).toContain("Agent");
    expect(markup).toContain("提醒");
    expect(markup).toContain("团队");
    expect(markup).toContain("项目");
    expect(markup).toContain("文档");
    expect(markup).toContain("报表");
    expect(markup).toContain("模板");
    expect(markup).toContain("/notifications");
    expect(markup).toContain("w-[80px]");
    expect(markup).toContain('aria-label="打开账号菜单"');
    expect(markup).toContain(">7<");
    expect(markup).not.toContain(">3<");
    expect(markup).toContain("Web v0.1.5");
  });

  it("separates resource context from the personal account trigger", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "workbench",
        title: "我的工作台",
        subtitle: "当前线程",
        loginEmail: "alice@example.com",
        spaceLabel: "HumanThread",
        selectedSpaceKey: "company_1",
        spaceFilters: [
          { key: "all", label: "全部", companyId: null, ownerType: null },
          {
            key: "personal",
            label: "个人空间",
            companyId: null,
            ownerType: "personal",
          },
          {
            key: "company_1",
            label: "HumanThread",
            companyId: "company_1",
            ownerType: "company",
          },
        ],
      }),
    );

    expect(markup).toContain('aria-label="切换工作空间，当前为 HumanThread"');
    expect(markup).toContain('aria-label="打开账号菜单"');
    expect(markup).toContain("h-16");
    expect(markup).toContain("h-8 w-8");
    expect(markup).not.toContain("普通会员");
    expect(markup.match(/href="\/agents"/gu)).toHaveLength(1);
  });

  it("bounds and truncates a long current Space label", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "workbench",
        title: "我的工作台",
        subtitle: "当前线程",
        loginEmail: "alice@example.com",
        spaceLabel: "HumanThread Company With A Very Long Delivery Name",
        selectedSpaceKey: "company_1",
        spaceFilters: [
          { key: "all", label: "全部", companyId: null, ownerType: null },
          {
            key: "personal",
            label: "个人空间",
            companyId: null,
            ownerType: "personal",
          },
          {
            key: "company_1",
            label: "HumanThread Company With A Very Long Delivery Name",
            companyId: "company_1",
            ownerType: "company",
          },
        ],
      }),
    );

    expect(markup).toContain("max-w-[220px]");
    expect(markup).toContain("hidden min-w-0 truncate sm:block");
    expect(markup).toContain("HumanThread Company With A Very Long Delivery Name");
  });

  it("renders the uploaded avatar when one is available", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchUserMenu, {
        email: "alice@example.com",
        name: "Alice",
        avatarSrc: "/uploads/avatars/user_owner/avatar.png?v=1747900800000",
      }),
    );

    expect(markup).toContain(
      "/uploads/avatars/user_owner/avatar.png?v=1747900800000",
    );
    expect(markup).not.toContain(">C<");
  });

  it("renders only compact sidebar labels", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "projects",
        title: "项目空间",
        subtitle: "当前线程",
        loginEmail: null,
      }),
    );

    expect(markup).toContain("首页");
    expect(markup).toContain("任务");
    expect(markup).toContain("项目");
    expect(markup).toContain("文档");
    expect(markup).toContain("设置");
  });

  it("keeps WorkbenchShell as a compatibility export", () => {
    expect(WorkbenchShell).toBe(WorkbenchAppShell);
  });

  it("keeps page navigation, header, and scrolling content in separate mobile rows", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "workbench",
        title: "我的工作台",
        subtitle: "当前线程",
        loginEmail: "alice@example.com",
      }),
    );

    expect(markup).toContain("h-screen overflow-hidden");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain(
      "grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]",
    );
    expect(markup).toContain(
      'data-workbench-content-mode="page" class="min-h-0 min-w-0 overflow-y-auto',
    );
    expect(markup.match(/grid-cols-\[minmax\(0,1fr\)\]/gu) ?? []).toHaveLength(2);
    expect(markup).toContain("mt-4");
  });

  it("keeps the header create icon but routes creation through the Task dialog", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(
      new URL("./workbench-shell.tsx", import.meta.url),
      "utf8",
    ));

    expect(source).toContain("TaskCreateDialog");
    expect(source).not.toContain("createWorkbenchWorkflowAction");
    expect(source).not.toContain("WorkbenchQuickCreateFormFields");
  });

  it("renders workspace content without a page header or content padding", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "documents",
        title: "Document page heading",
        subtitle: "Document page subtitle",
        contentMode: "workspace",
      }, createElement("div", null, "Document workspace body")),
    );

    expect(markup).toContain("Document workspace body");
    expect(markup).not.toContain("Document page heading");
    expect(markup).not.toContain("Document page subtitle");
    expect(markup).toContain('data-workbench-content-mode="workspace"');
    expect(markup).toContain("min-h-0 overflow-hidden");
    expect(markup).not.toContain("overflow-y-auto px-4 pb-6 sm:px-6 lg:px-8");
  });

  it("adapts the shell width to the browser instead of capping at 1600px", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "workbench",
        title: "我的工作台",
        subtitle: "当前线程",
        loginEmail: "alice@example.com",
      }),
    );

    expect(markup).toContain("w-full");
    expect(markup).not.toContain("max-w-[1600px]");
  });

  it("collapses the desktop sidebar behind responsive mobile navigation", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchAppShell, {
        activeKey: "tasks",
        title: "任务中心",
        subtitle: "当前线程",
        loginEmail: "alice@example.com",
      }),
    );

    expect(markup).toContain("md:grid-cols-[auto_minmax(0,1fr)]");
    expect(markup).toContain("hidden md:block");
    expect(markup).toContain("md:hidden");
    expect(markup).not.toContain('class="grid min-h-0 grid-cols-[auto_minmax(0,1fr)]"');
  });
});
