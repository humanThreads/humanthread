// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentTemplateLibrary } from "./development-template-library";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const templates = [
  {
    id: "platform_template", name: "平台分支开发", kind: "branch-development", version: 1,
    status: "published", origin: "platform", spaceId: null, description: "平台推荐流程", revision: 1,
  },
  {
    id: "space_template", name: "团队分支开发", kind: "branch-development", version: 1,
    status: "draft", origin: "space", spaceId: "space_1", description: null, revision: 2,
  },
] as const;

describe("DevelopmentTemplateLibrary", () => {
  it("provides Loop market and my-template tabs with market sorting, stars, and card view", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { starred: true, starCount: 2 } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DevelopmentTemplateLibrary
      spaceId="space_1"
      templates={templates}
      marketTemplates={[{ ...templates[0], isPublic: true, industryTags: ["信息技术"], starCount: 1 }]}
    />);

    expect(screen.getByRole("tab", { name: "Loop 市场" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "我的模版" })).toBeTruthy();
    expect(screen.getByText("信息技术")).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "市场排序" }), "stars");
    await user.click(screen.getByRole("button", { name: "卡片" }));
    await user.click(screen.getByRole("button", { name: /星标 1/u }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/development-templates/platform_template/star",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("defaults to card view", () => {
    render(<DevelopmentTemplateLibrary spaceId="space_1" templates={templates} marketTemplates={[templates[0]]} />);

    expect(screen.getByRole("button", { name: "卡片" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "列表" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("creates a blank editable development template from the library", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { id: "space/new-template" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DevelopmentTemplateLibrary spaceId="space_1" spaceKey="company/acme" templates={templates} />);

    await user.click(screen.getByRole("tab", { name: "我的模版" }));
    await user.click(screen.getByRole("button", { name: "新建 Loop 模板" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/development-templates",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      spaceId: "space_1",
      name: "未命名 Loop 模板",
    });
    expect(push).toHaveBeenCalledWith("/templates/development/space%2Fnew-template?space=company%2Facme");
  });

  it("exposes editing for a creator-owned custom template", async () => {
    const user = userEvent.setup();
    render(<DevelopmentTemplateLibrary spaceId="space_1" templates={[{ ...templates[1], status: "published", createdByUserId: "user_1" }]} currentUserId="user_1" />);

    await user.click(screen.getByRole("tab", { name: "我的模版" }));
    expect(screen.getByRole("link", { name: "编辑" })).toBeTruthy();
  });

  it("requires confirmation before making a private template public", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DevelopmentTemplateLibrary spaceId="space_1" templates={[{ ...templates[1], createdByUserId: "user_1", isPublic: false }]} currentUserId="user_1" />);

    await user.click(screen.getByRole("tab", { name: "我的模版" }));
    const toggle = screen.getByRole("switch", { name: "团队分支开发公开状态" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);

    expect(screen.getByRole("dialog", { name: "确认公开 Loop 模板" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "确认公开 Loop 模板" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms a public-to-private switch before updating market visibility", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DevelopmentTemplateLibrary spaceId="space_1" templates={[{ ...templates[1], createdByUserId: "user_1", isPublic: true }]} currentUserId="user_1" />);

    await user.click(screen.getByRole("tab", { name: "我的模版" }));
    await user.click(screen.getByRole("switch", { name: "团队分支开发公开状态" }));

    expect(screen.getByRole("dialog", { name: "确认设为私有 Loop 模板" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认设为私有" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/development-templates/space_template/market",
      expect.objectContaining({ method: "PATCH" }),
    ));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ isPublic: false });
  });

  it("lists platform templates before Space templates and exposes copy", () => {
    render(<DevelopmentTemplateLibrary spaceId="space_1" templates={templates} marketTemplates={[templates[0]]} />);

    expect(screen.getByText("平台分支开发")).toBeTruthy();
    expect((screen.getByRole("button", { name: "复制到我的模版" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("copies with a command ID and navigates to the encoded template path in the selected Space", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { id: "space/template 1" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DevelopmentTemplateLibrary spaceId="space_1" spaceKey="company/acme" templates={templates} marketTemplates={[templates[0]]} />);

    await user.click(screen.getByRole("button", { name: "复制到我的模版" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/development-templates/platform_template/copy",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      spaceId: "space_1",
      name: "平台分支开发（副本）",
    });
    expect(push).toHaveBeenCalledWith("/templates/development/space%2Ftemplate%201?space=company%2Facme");
  });
});
