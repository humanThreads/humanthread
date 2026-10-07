// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginDeviceList } from "./login-device-list";

const createdAt = new Date("2026-08-10T08:00:00.000Z");
const lastSeenAt = new Date("2026-08-12T08:00:00.000Z");
const expiresAt = new Date("2026-09-09T08:00:00.000Z");
const sessions = [
  { id: "a".repeat(32), deviceName: "macOS", browserName: "Chrome", operatingSystem: "macOS", createdAt, lastSeenAt, expiresAt },
  { id: "b".repeat(32), deviceName: "Windows", browserName: "Edge", operatingSystem: "Windows", createdAt, lastSeenAt, expiresAt },
];

afterEach(cleanup);

describe("login device list", () => {
  it("marks the current device and only offers remote logout for other devices", () => {
    render(<LoginDeviceList currentSessionId={"a".repeat(32)} sessions={sessions} revokeAction={vi.fn()} refresh={vi.fn()} />);
    expect(screen.getByText("当前设备")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "退出此设备" })).toHaveLength(1);
    expect(screen.getByText("Chrome · macOS")).toBeTruthy();
    expect(screen.queryByText(/203\.0\.113/u)).toBeNull();
  });

  it("confirms remote logout, calls the action, and refreshes", async () => {
    const user = userEvent.setup();
    const revokeAction = vi.fn().mockResolvedValue({ ok: true });
    const refresh = vi.fn();
    render(<LoginDeviceList currentSessionId={"a".repeat(32)} sessions={sessions} revokeAction={revokeAction} refresh={refresh} />);
    await user.click(screen.getByRole("button", { name: "退出此设备" }));
    await user.click(screen.getByRole("checkbox", { name: "我已确认" }));
    await user.click(screen.getByRole("button", { name: "确认退出" }));
    expect(revokeAction).toHaveBeenCalledWith(
      { ok: false },
      expect.any(FormData),
    );
    const formData = revokeAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("webSessionId")).toBe("b".repeat(32));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a remote logout failure without removing the row", async () => {
    const user = userEvent.setup();
    render(<LoginDeviceList
      currentSessionId={"a".repeat(32)}
      sessions={sessions}
      revokeAction={vi.fn().mockResolvedValue({ ok: false, formError: "退出失败" })}
      refresh={vi.fn()}
    />);
    await user.click(screen.getByRole("button", { name: "退出此设备" }));
    await user.click(screen.getByRole("checkbox", { name: "我已确认" }));
    await user.click(screen.getByRole("button", { name: "确认退出" }));
    expect((await screen.findByRole("alert")).textContent).toContain("退出失败");
    expect(screen.getByText("Windows")).toBeTruthy();
  });
});
