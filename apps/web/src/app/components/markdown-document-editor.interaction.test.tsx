// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownDocumentEditor } from "./markdown-document-editor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

describe("MarkdownDocumentEditor interactions", () => {
  it("enters edit mode and inserts a preview link after an XMind upload", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      attachment: {
        originalName: "roadmap.xmind",
        mimeType: "application/vnd.xmind.workbook",
        markdownUrl: "/api/document-attachments/attachment_xmind",
      },
    }), { status: 201, headers: { "content-type": "application/json" } })));

    render(<MarkdownDocumentEditor document={{ id: "doc_1", title: "Guide", path: "guide.md", contentMarkdown: "# Guide", version: 1 }} />);

    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array([1, 2, 3])], "roadmap.xmind", { type: "application/vnd.xmind.workbook" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith("/api/documents/doc_1/attachments", expect.objectContaining({ method: "POST" }));
  });
});
