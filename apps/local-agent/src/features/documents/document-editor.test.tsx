import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DocumentEditor,
  getInitialDocumentEditorMode,
  getRestoredDocumentEditorMode,
} from "./document-editor";
import { getDocumentWorkspaceStorageKey } from "./document-workspace-state";

describe("DocumentEditor", () => {
  it("defaults newly opened documents to preview", () => {
    expect(getInitialDocumentEditorMode()).toBe("preview");
  });

  it("restores every desktop editor mode only for an in-place reload", () => {
    const storage = new Map<string, string>();
    const scopeKey = "project_1/doc_1";

    for (const mode of ["edit", "source", "split", "preview"] as const) {
      storage.set(getDocumentWorkspaceStorageKey(scopeKey), JSON.stringify({
        expandedDirectoryIds: [],
        mode,
      }));
      expect(getRestoredDocumentEditorMode(scopeKey, storage, true)).toBe(mode);
    }
    expect(getRestoredDocumentEditorMode(scopeKey, storage, false)).toBe("preview");
  });

  it("switches between source, split and preview without mounting revisions inside the editor", async () => {
    const user = userEvent.setup();
    render(<DocumentEditor
      markdown="# Draft"
      onChange={vi.fn()}
      readOnly={false}
    />);

    expect(screen.getByRole("tab", { name: "预览" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "源码" }));
    expect(screen.getByRole("textbox", { name: "Markdown 源码" })).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "分栏" }));
    expect(screen.getByRole("textbox", { name: "Markdown 源码" })).toBeVisible();
    expect(screen.getByTestId("document-preview")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "预览" }));
    expect(screen.getByTestId("document-preview")).toHaveClass("document-preview-scroll");
    expect(screen.queryByRole("region", { name: "修订记录" })).not.toBeInTheDocument();
  });

  it("offers Markdown formatting controls and reports source changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function ControlledEditor() {
      const [markdown, setMarkdown] = useState("Draft");
      return <DocumentEditor
        markdown={markdown}
        onChange={(value) => { setMarkdown(value); onChange(value); }}
        readOnly={false}
      />;
    }
    render(<ControlledEditor />);

    await user.click(screen.getByRole("tab", { name: "源码" }));
    await user.clear(screen.getByRole("textbox", { name: "Markdown 源码" }));
    await user.type(screen.getByRole("textbox", { name: "Markdown 源码" }), "Updated");
    expect(onChange).toHaveBeenLastCalledWith("Updated");
    expect(screen.getByRole("button", { name: "加粗" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "插入链接" })).toBeEnabled();
  });
});
