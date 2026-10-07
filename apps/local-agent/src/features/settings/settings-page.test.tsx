import type { DesktopSettingsResponse } from "@humanthread/workbench-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../theme/theme-provider";
import { SettingsView } from "./settings-page";

const data: DesktopSettingsResponse["data"] = {
  user: {
    id: "user_1",
    name: "测试用户",
    email: "alice@example.com",
    avatarUrl: null,
    status: "active",
  },
  companies: [{
    id: "company_1",
    name: "HumanThread",
    logoUrl: null,
    role: "owner",
    canManage: true,
    route: "/settings/company/company_1",
  }],
  isSiteAdmin: false,
  selectedCompany: {
    company: {
      id: "company_1",
      name: "HumanThread",
      slug: "humanthread",
      logoUrl: null,
      status: "active",
    },
    membership: {
      role: "owner",
      canManageProfile: true,
      canManageMembers: true,
      canManageIntegrations: true,
      canTransferOwnership: true,
    },
    profile: { description: "人机协同交付平台", certificationLevel: "verified" },
    members: [{
      id: "membership_1",
      role: "owner",
      status: "active",
      user: {
        id: "user_1",
        name: "测试用户",
        email: "alice@example.com",
        avatarUrl: null,
        status: "active",
        lastSeenAt: "2026-07-27T12:00:00.000Z",
      },
    }],
    integration: {
      emailHost: "smtp.example.com",
      emailPort: 465,
      emailUsername: "notify@example.com",
      hasPassword: true,
    },
  },
};

describe("desktop settings page", () => {
  it("shows scoped identity, company permissions and secret-free integration facts", () => {
    render(
      <ThemeProvider>
        <SettingsView data={data} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("heading", { name: "测试用户" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "HumanThread" })).toBeVisible();
    expect(screen.getByText("成员管理")).toBeVisible();
    expect(screen.getByText("smtp.example.com:465")).toBeVisible();
    expect(screen.getByText("凭据已配置")).toBeVisible();
    expect(screen.queryByText(/password|secret/iu)).not.toBeInTheDocument();
  });

  it("keeps the existing three-mode appearance interaction", async () => {
    const user = userEvent.setup();
    const onAppearanceChange = vi.fn();
    render(
      <ThemeProvider onAppearanceChange={onAppearanceChange}>
        <SettingsView data={data} />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "桌面偏好" }));
    await user.click(screen.getByRole("radio", { name: "全局深色" }));

    expect(onAppearanceChange).toHaveBeenCalledWith("dark");
  });
});
