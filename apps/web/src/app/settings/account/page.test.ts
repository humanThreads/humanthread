import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: {
        userId: "user_owner",
        teamId: "team_1",
      },
      loginEmail: "alice@example.com",
      account: {
        name: "Alice",
        email: "alice@example.com",
        status: "active",
        avatarUrl: "/uploads/avatars/user_owner/avatar.png",
        avatarUpdatedAt: new Date("2026-05-22T08:00:00.000Z"),
        isSiteAdmin: true,
        lastSeenAt: new Date("2026-05-22T09:00:00.000Z"),
      },
    },
    cookieStore: {
      get: vi.fn().mockReturnValue(undefined),
    },
  }),
}));

vi.mock("../../../lib/workbench/workbench-settings", () => ({
  getWorkbenchAccountSettings: vi.fn().mockResolvedValue({
    name: "Alice",
    email: "alice@example.com",
    status: "active",
    avatarUrl: "/uploads/avatars/user_owner/avatar.png",
    avatarUpdatedAt: new Date("2026-05-22T08:00:00.000Z"),
    isSiteAdmin: true,
    lastSeenAt: new Date("2026-05-22T09:00:00.000Z"),
  }),
}));

vi.mock("../../../lib/workbench/workbench-settings-context", () => ({
  getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
    user: {
      id: "user_owner",
      name: "Alice",
      email: "alice@example.com",
      avatarUrl: "/uploads/avatars/user_owner/avatar.png",
      status: "active",
    },
    companies: [],
    isSiteAdmin: true,
  }),
}));

vi.mock("../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "personal", label: "个人空间", companyId: null, ownerType: "personal", spaceId: "space_personal" },
  ]),
}));

import * as pageModule from "./page";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchAccountSettings } from "../../../lib/workbench/workbench-settings";

describe("Account settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forces dynamic rendering", () => {
    expect(pageModule.dynamic).toBe("force-dynamic");
  });

  it("uses the authenticated workbench session and account settings query", () => {
    expect(typeof requireWorkbenchSession).toBe("function");
    expect(typeof getWorkbenchAccountSettings).toBe("function");
  });

  it("documents read-only fields", () => {
    expect(pageModule.SETTINGS_ACCOUNT_READONLY_FIELDS).toEqual([
      "邮箱",
      "账号状态",
    ]);
  });

  it("keeps the avatar upload mime whitelist stable", () => {
    expect(pageModule).toHaveProperty("ACCOUNT_AVATAR_ALLOWED_TYPES", [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
  });

  it("renders the avatar upload as a button-driven modal flow", async () => {
    const markup = renderToStaticMarkup(await pageModule.default());

    expect(markup).toContain("上传头像");
    expect(markup).toContain("打开上传弹窗");
    expect(markup).toContain("开始上传");
    expect(markup).not.toContain("保存头像");
  });

  it("keeps password editing out of personal profile settings", async () => {
    const markup = renderToStaticMarkup(await pageModule.default());

    expect(markup).not.toContain("当前密码");
    expect(markup).not.toContain("保存新密码");
    expect(markup).toContain("/settings/security");
    expect(markup).toContain("个人资料");
  });

  it("shows the administrator settings entry for site administrators", async () => {
    const markup = renderToStaticMarkup(await pageModule.default());

    expect(markup).toContain("平台设置");
    expect(markup).toContain("/settings/admin");
  });
});
