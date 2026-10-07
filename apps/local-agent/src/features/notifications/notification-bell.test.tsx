import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "./notification-bell";
import { useDesktopNotifications } from "./use-desktop-notifications";

vi.mock("./use-desktop-notifications", () => ({
  useDesktopNotifications: vi.fn(),
}));

function renderBell(unreadCount: number) {
  vi.mocked(useDesktopNotifications).mockReturnValue({
    data: {
      ok: true,
      data: { summary: { unreadCount, todayCount: 0 }, items: [] },
    },
  } as never);
  render(<MemoryRouter><NotificationBell /></MemoryRouter>);
}

describe("desktop notification bell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links to the inbox with its exact unread count", () => {
    renderBell(3);

    expect(screen.getByRole("link", { name: "通知，3 条未读" }))
      .toHaveAttribute("href", "/notifications");
    expect(screen.getByText("3")).toHaveAttribute("aria-hidden", "true");
  });

  it("does not render a badge when the inbox has no unread items", () => {
    renderBell(0);

    expect(screen.getByRole("link", { name: "通知" }))
      .toHaveAttribute("href", "/notifications");
    expect(document.querySelector(".notification-badge")).toBeNull();
  });

  it("bounds the visual badge without losing the accessible exact count", () => {
    renderBell(123);

    expect(screen.getByRole("link", { name: "通知，123 条未读" })).toBeVisible();
    expect(screen.getByText("99+")).toHaveAttribute("aria-hidden", "true");
  });
});
