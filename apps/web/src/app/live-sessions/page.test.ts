import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import LiveSessionsPage from "./page";

describe("Live sessions page", () => {
  it("exports the live sessions route component", () => {
    expect(typeof LiveSessionsPage).toBe("function");
  });

  it("never passes request handlers into the client workspace", () => {
    // A Server Component cannot serialize functions to a Client Component.
    // Passing them made this route return 500 at runtime while all other
    // workbench pages rendered, so the boundary is pinned here.
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/createSession=\{/u);
    expect(source).not.toMatch(/onClose=\{/u);
  });

  it("renders the live session route as an edge-to-edge workspace without a page header", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain('contentMode="workspace"');
    expect(source).toContain('title="在线会话"');
    expect(source).toContain('subtitle="仅显示进行中的 Agent 与 Worker TUI 会话；公网服务不保存会话正文。"');
  });
});
