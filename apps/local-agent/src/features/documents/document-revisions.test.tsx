import type { DesktopDocumentRevision } from "@humanthread/workbench-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DocumentRevisions } from "./document-revisions";

const revisions: DesktopDocumentRevision[] = [{
  id: "doc_1:v7",
  documentId: "doc_1",
  version: 7,
  contentMarkdown: "历史版本正文",
  source: "desktop",
  createdAt: "2026-07-26T08:00:00.000Z",
  createdById: "user_1",
}];

describe("DocumentRevisions", () => {
  it("stays collapsible and opens a readable historical version", async () => {
    const user = userEvent.setup();
    render(<DocumentRevisions currentVersion={8} revisions={revisions} />);

    expect(screen.queryByRole("region", { name: "修订记录" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "修订 8" }));
    expect(screen.getByRole("region", { name: "修订记录" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "版本 7" }));
    expect(screen.getByText("历史版本正文")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收起修订记录" }));
    expect(screen.queryByRole("region", { name: "修订记录" })).not.toBeInTheDocument();
  });
});
