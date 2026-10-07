// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpCredentialList } from "./mcp-credential-list";

afterEach(cleanup);

describe("MCP credential list", () => {
  it("explains impact and revokes the selected personal credential", async () => {
    const user = userEvent.setup();
    const revokeAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <McpCredentialList
        credentials={[
          {
            id: "mcp_1",
            name: "Codex",
            status: "active",
            lastUsedAt: null,
            createdAt: new Date("2026-07-26T00:00:00.000Z"),
            revokedAt: null,
          },
        ]}
        revokeAction={revokeAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "撤销 Codex" }));
    expect(screen.getByRole("dialog").textContent).toContain("撤销后 Codex 将无法继续访问 HumanThread");
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(revokeAction).toHaveBeenCalledWith("mcp_1");
  });
});
