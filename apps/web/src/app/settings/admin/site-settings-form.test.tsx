// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteSettingsForm } from "./site-settings-form";

afterEach(cleanup);

describe("SiteSettingsForm", () => {
  it("retains the entered domain when the server denies the update", async () => {
    const user = userEvent.setup();
    render(
      <SiteSettingsForm
        initialSiteBaseUrl="http://localhost:3000"
        mcpUrl="http://localhost:3000/api/mcp"
        action={vi.fn().mockResolvedValue({ ok: false, formError: "Site administrator permission is required" })}
      />,
    );

    const input = screen.getByLabelText("站点域名") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "https://console.example.com");
    await user.click(screen.getByRole("button", { name: "保存站点配置" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Site administrator permission is required");
    expect(input.value).toBe("https://console.example.com");
  });
});
