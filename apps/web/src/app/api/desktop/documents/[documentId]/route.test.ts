import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DesktopDocumentVersionConflictError,
  readDesktopDocumentDetail,
  updateDesktopDocument,
} from "@/lib/desktop/desktop-document-models";
import { GET, PUT } from "./route";

vi.mock("@/lib/desktop/desktop-document-models", () => ({
  DesktopDocumentVersionConflictError: class extends Error {
    currentVersion: number;
    constructor(currentVersion: number) {
      super("Document version conflict");
      this.currentVersion = currentVersion;
    }
  },
  readDesktopDocumentDetail: vi.fn(),
  updateDesktopDocument: vi.fn(),
}));

const params = { params: Promise.resolve({ documentId: "doc_1" }) };

describe("desktop Document detail route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps a cross-Space document to 404", async () => {
    vi.mocked(readDesktopDocumentDetail).mockRejectedValue(new Error("Document not found"));
    const response = await GET(
      new Request("http://localhost/api/desktop/documents/doc_1?space=personal"),
      params,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "document_not_found" });
  });

  it("returns currentVersion and desktop CORS for a stale update", async () => {
    vi.mocked(updateDesktopDocument).mockRejectedValue(new DesktopDocumentVersionConflictError(9));
    const response = await PUT(new Request(
      "http://localhost/api/desktop/documents/doc_1?space=personal",
      {
        method: "PUT",
        headers: { "content-type": "application/json", origin: "http://localhost:1420" },
        body: JSON.stringify({
          commandId: "desktop:save:1",
          expectedVersion: 8,
          title: "架构说明",
          contentMarkdown: "# Mine",
        }),
      },
    ), params);

    expect(response.status).toBe(409);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(await response.json()).toEqual({
      ok: false,
      code: "version_conflict",
      error: "Document version conflict",
      currentVersion: 9,
    });
  });

  it("rejects updates without a command ID before calling the service", async () => {
    const response = await PUT(new Request(
      "http://localhost/api/desktop/documents/doc_1?space=personal",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 8, title: "架构说明", contentMarkdown: "# Mine" }),
      },
    ), params);

    expect(response.status).toBe(400);
    expect(updateDesktopDocument).not.toHaveBeenCalled();
  });

  it("treats malformed JSON as a validation error", async () => {
    const response = await PUT(new Request(
      "http://localhost/api/desktop/documents/doc_1?space=personal",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      },
    ), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_failed" });
    expect(updateDesktopDocument).not.toHaveBeenCalled();
  });
});
