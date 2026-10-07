// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentRevisionPanel } from "./document-revision-panel";

const revision = {
  id: "revision_2",
  documentId: "doc_1",
  version: 2,
  contentMarkdown: "# Historical Guide",
  source: "web",
  createdAt: new Date("2026-07-21T00:00:00.000Z"),
  createdById: "user_1",
};

afterEach(cleanup);

describe("DocumentRevisionPanel interactions", () => {
  it("collapses and selects a revision", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSelectRevision = vi.fn();
    render(<DocumentRevisionPanel revisions={[revision]} open mobileOpen={false} selectedRevisionId={null} onOpenChange={onOpenChange} onMobileOpenChange={vi.fn()} onSelectRevision={onSelectRevision} />);

    await user.click(screen.getByRole("button", { name: "收起修订记录" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole("button", { name: "查看版本 v2" }));
    expect(onSelectRevision).toHaveBeenCalledWith("revision_2");
  });

  it("returns to the list and closes the mobile drawer", async () => {
    const user = userEvent.setup();
    const onSelectRevision = vi.fn();
    const onMobileOpenChange = vi.fn();
    render(<DocumentRevisionPanel revisions={[revision]} open mobileOpen selectedRevisionId="revision_2" onOpenChange={vi.fn()} onMobileOpenChange={onMobileOpenChange} onSelectRevision={onSelectRevision} />);

    const backButtons = screen.getAllByRole("button", { name: "返回修订列表" });
    await user.click(backButtons[0]!);
    expect(onSelectRevision).toHaveBeenCalledWith(null);
    await user.click(screen.getByRole("button", { name: "关闭修订记录" }));
    expect(onMobileOpenChange).toHaveBeenCalledWith(false);
  });
});
