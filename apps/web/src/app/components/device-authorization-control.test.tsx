// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceAuthorizationControl } from "./device-authorization-control";

afterEach(cleanup);

describe("device authorization control", () => {
  it("uses a danger dialog before revoking a personal Agent device", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue(undefined);
    render(
      <DeviceAuthorizationControl
        deviceId="device_1"
        mode="revoke"
        label="撤销授权"
        action={action}
      />,
    );

    await user.click(screen.getByRole("button", { name: "撤销授权" }));
    expect(screen.getByRole("dialog").textContent).toContain("该设备将无法继续访问 Agent 接口");
    await user.click(screen.getByRole("button", { name: "确认撤销授权" }));

    const formData = action.mock.calls[0]?.[0] as FormData;
    expect(formData.get("deviceId")).toBe("device_1");
    expect(formData.get("mode")).toBe("revoke");
  });
});
