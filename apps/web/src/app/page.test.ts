import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home, { HOME_PRODUCT_MAP } from "./page";
import { DEFAULT_SOURCE_REPOSITORY_URL, resolveSourceRepositoryUrl } from "./components/public-home";

const redirect = vi.hoisted(() => vi.fn());
const resolveWorkbenchSession = vi.hoisted(() => vi.fn());
const cookieGet = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: cookieGet }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../lib/workbench/workbench-session", () => ({
  hasWorkbenchAuthenticationCookie: (getCookieValue: (name: string) => string | undefined) => Boolean(
    getCookieValue("ht_web_session"),
  ),
  resolveWorkbenchSession,
}));
vi.mock("../lib/workbench/workbench-auth-guard", () => ({
  isWorkbenchSessionAuthenticated: (session: { loginEmail: string | null; webSessionId: string | null }) => Boolean(session.loginEmail && session.webSessionId),
}));

describe("Public entry", () => {
  beforeEach(() => {
    cookieGet.mockReset();
    resolveWorkbenchSession.mockReset();
    redirect.mockReset();
  });
  it("maps the product from knowledge to evidence instead of an obsolete coding workflow", () => {
    expect(HOME_PRODUCT_MAP.map(([label]) => label)).toEqual([
      "需求、文档与知识",
      "SOP 与 Loop",
      "AI 与人共同执行",
      "结果与证据",
    ]);
  });

  it("redirects authenticated visitors to the dashboard", async () => {
    cookieGet.mockReturnValue({ value: "signed" });
    resolveWorkbenchSession.mockResolvedValue({ loginEmail: "owner@example.com", webSessionId: "a".repeat(32) });
    await Home();
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the complete delivery loop for anonymous visitors without resolving a session", async () => {
    cookieGet.mockReturnValue(undefined);
    resolveWorkbenchSession.mockResolvedValue({ loginEmail: null });
    const markup = renderToStaticMarkup(await Home());
    expect(markup).toContain("HumanThread");
    expect(markup).toContain("让复杂工作沿着一条线程，从目标走到交付");
    expect(markup).toContain("目标与上下文");
    expect(markup).toContain("Loop 已派发");
    expect(markup).toContain("人工判断");
    expect(markup).toContain("结果与知识");
    expect(markup).toContain("需求、文档与知识");
    expect(markup).toContain('aria-label="HumanThread 工作方式"');
    expect(markup.match(/data-product-layer=/g)).toHaveLength(4);
    expect(markup).toContain("Loop 是定制化 SOP，不是通用按钮");
    expect(markup).toContain("让 AI 放大思考，不把责任交给黑箱");
    expect(markup).toContain("自动化可以加速，但权限和数据边界不能被跳过");
    expect(markup).toContain("Space / Project 隔离");
    expect(markup).toContain("不局限于开发，凡是复杂工作都可以被组织起来");
    expect(markup).toContain('aria-label="开始使用 HumanThread"');
    expect(markup).toContain('href="/login?redirectTo=%2Fdashboard"');
    expect(markup).not.toContain("规划 → 执行 → 检查 → 收尾");
    expect(resolveWorkbenchSession).not.toHaveBeenCalled();
  });
});

describe("AGPL source repository link", () => {
  beforeEach(() => {
    cookieGet.mockReset();
    resolveWorkbenchSession.mockReset();
    redirect.mockReset();
  });

  it("accepts an absolute http(s) repository URL", () => {
    expect(resolveSourceRepositoryUrl("https://example.com/humanthread")).toBe("https://example.com/humanthread");
  });

  it("falls back to the upstream repository when no override is configured", () => {
    expect(resolveSourceRepositoryUrl(undefined)).toBe(DEFAULT_SOURCE_REPOSITORY_URL);
  });

  it.each([
    ["", "empty"],
    ["   ", "whitespace only"],
    ["javascript:alert(1)", "non-http scheme"],
    ["not-a-url", "relative value"],
  ] as const)("omits the link for %s (%s)", (value, _label) => {
    expect(resolveSourceRepositoryUrl(value)).toBeNull();
  });

  it("renders a source-code link in the public footer when configured", async () => {
    cookieGet.mockReturnValue(undefined);
    resolveWorkbenchSession.mockResolvedValue({ loginEmail: null });
    process.env.HUMANTHREAD_SOURCE_REPOSITORY = "https://example.com/humanthread";
    try {
      const markup = renderToStaticMarkup(await Home());
      expect(markup).toContain('href="https://example.com/humanthread"');
      expect(markup).toContain("源代码（AGPL-3.0）");
      expect(markup).toContain('rel="noreferrer noopener"');
    } finally {
      delete process.env.HUMANTHREAD_SOURCE_REPOSITORY;
    }
  });

  it("renders the upstream source-code link when no override is configured", async () => {
    cookieGet.mockReturnValue(undefined);
    resolveWorkbenchSession.mockResolvedValue({ loginEmail: null });
    const markup = renderToStaticMarkup(await Home());
    expect(markup).toContain(`href="${DEFAULT_SOURCE_REPOSITORY_URL}"`);
    expect(markup).toContain("源代码（AGPL-3.0）");
  });

  it("omits the source-code link when a deployment explicitly blanks the override", async () => {
    cookieGet.mockReturnValue(undefined);
    resolveWorkbenchSession.mockResolvedValue({ loginEmail: null });
    process.env.HUMANTHREAD_SOURCE_REPOSITORY = "";
    try {
      const markup = renderToStaticMarkup(await Home());
      expect(markup).not.toContain("源代码（AGPL-3.0）");
    } finally {
      delete process.env.HUMANTHREAD_SOURCE_REPOSITORY;
    }
  });

  it("keeps the footer description in its own span so positional styling cannot shift", async () => {
    cookieGet.mockReturnValue(undefined);
    resolveWorkbenchSession.mockResolvedValue({ loginEmail: null });
    const markup = renderToStaticMarkup(await Home());
    // The footer previously relied on `span:last-child`; adding the source link
    // must not let an extra span capture that positional rule.
    expect(markup).toContain("Human-guided delivery for Agent work.");
    expect((markup.match(/<footer[\s\S]*?<\/footer>/u)?.[0] ?? "").match(/<span/g)).toHaveLength(2);
  });
});
