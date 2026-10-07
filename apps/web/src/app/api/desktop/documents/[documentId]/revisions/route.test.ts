import { beforeEach, describe, expect, it, vi } from "vitest";

import { readDesktopDocumentRevisions } from "@/lib/desktop/desktop-document-models";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-document-models", () => ({ readDesktopDocumentRevisions: vi.fn() }));

describe("desktop Document revisions route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns historical Markdown through the selected Space route", async () => {
    vi.mocked(readDesktopDocumentRevisions).mockResolvedValue({
      revisions: [{
        id: "doc_1:v7", documentId: "doc_1", version: 7,
        contentMarkdown: "历史版本正文", source: "desktop",
        createdAt: "2026-07-26T08:00:00.000Z", createdById: "user_1",
      }],
    });
    const response = await GET(
      new Request("http://localhost/api/desktop/documents/doc_1/revisions?space=personal"),
      { params: Promise.resolve({ documentId: "doc_1" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.revisions[0].contentMarkdown).toBe("历史版本正文");
  });
});
