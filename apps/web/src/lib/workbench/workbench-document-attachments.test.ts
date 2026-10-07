import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  WORKBENCH_DOCUMENT_ATTACHMENT_ALLOWED_MIME_TYPES,
  WORKBENCH_DOCUMENT_ATTACHMENT_MAX_BYTES,
  readWorkbenchDocumentAttachment,
  resolveWorkbenchDocumentAttachmentMimeType,
  saveWorkbenchDocumentAttachment,
  isInlineDocumentAttachmentMimeType,
} from "./workbench-document-attachments";

describe("workbench document attachments", () => {
  it("stores an authorized attachment outside the public tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-attachment-"));
    const assertCanWriteDocument = vi.fn().mockResolvedValue({ role: "owner" });
    const create = vi.fn().mockResolvedValue({
      id: "attachment_1",
      originalName: "design.pdf",
      mimeType: "application/pdf",
      byteSize: 3n,
    });

    const result = await saveWorkbenchDocumentAttachment({
      userId: "user_1",
      documentId: "doc_1",
      file: new File([new Uint8Array([1, 2, 3])], "design.pdf", {
        type: "application/pdf",
      }),
      storageRoot: root,
      createId: () => "attachment_1",
      dependencies: { assertCanWriteDocument },
      db: { documentAttachment: { create } },
    });

    expect(assertCanWriteDocument).toHaveBeenCalledWith({
      userId: "user_1",
      documentId: "doc_1",
    });
    expect(result.markdownUrl).toBe(
      "/api/document-attachments/attachment_1",
    );
    expect(await readFile(join(root, "doc_1", "attachment_1"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storageKey: "doc_1/attachment_1",
          originalName: "design.pdf",
          uploadedById: "user_1",
        }),
      }),
    );
  });

  it("rejects unsupported and oversized files", async () => {
    const input = {
      userId: "user_1",
      documentId: "doc_1",
      dependencies: {
        assertCanWriteDocument: vi.fn().mockResolvedValue({ role: "owner" }),
      },
      db: { documentAttachment: { create: vi.fn() } },
    };
    await expect(
      saveWorkbenchDocumentAttachment({
        ...input,
        file: new File(["binary"], "tool.exe", {
          type: "application/x-msdownload",
        }),
      }),
    ).rejects.toThrow("Unsupported document attachment type");
    await expect(
      saveWorkbenchDocumentAttachment({
        ...input,
        file: new File(
          [new Uint8Array(WORKBENCH_DOCUMENT_ATTACHMENT_MAX_BYTES + 1)],
          "large.pdf",
          { type: "application/pdf" },
        ),
      }),
    ).rejects.toThrow("Document attachment is too large");
  });

  it("only renders safe bitmap formats inline", () => {
    expect(isInlineDocumentAttachmentMimeType("image/png")).toBe(true);
    expect(isInlineDocumentAttachmentMimeType("image/svg+xml")).toBe(false);
    expect(isInlineDocumentAttachmentMimeType("application/pdf")).toBe(false);
  });

  it("accepts XMind and Visio files for protected document previews", () => {
    expect(WORKBENCH_DOCUMENT_ATTACHMENT_ALLOWED_MIME_TYPES).toContain(
      "application/vnd.xmind.workbook",
    );
    expect(WORKBENCH_DOCUMENT_ATTACHMENT_ALLOWED_MIME_TYPES).toContain(
      "application/vnd.ms-visio.drawing",
    );
    expect(isInlineDocumentAttachmentMimeType("application/vnd.xmind.workbook")).toBe(false);
    expect(isInlineDocumentAttachmentMimeType("application/vnd.ms-visio.drawing")).toBe(false);
  });

  it("recovers XMind and Visio MIME types when browsers omit them", () => {
    expect(resolveWorkbenchDocumentAttachmentMimeType({ name: "roadmap.XMIND", type: "" })).toBe("application/vnd.xmind.workbook");
    expect(resolveWorkbenchDocumentAttachmentMimeType({ name: "flow.vsdx", type: "" })).toBe("application/vnd.ms-visio.drawing");
    expect(resolveWorkbenchDocumentAttachmentMimeType({ name: "roadmap.xmind", type: "application/zip" })).toBe("application/vnd.xmind.workbook");
    expect(resolveWorkbenchDocumentAttachmentMimeType({ name: "flow.vsdx", type: "application/octet-stream" })).toBe("application/vnd.ms-visio.drawing");
    expect(resolveWorkbenchDocumentAttachmentMimeType({ name: "notes.txt", type: "" })).toBe("");
  });

  it("checks read authorization before returning a private path", async () => {
    const assertCanReadDocument = vi.fn().mockResolvedValue({ role: "viewer" });
    const result = await readWorkbenchDocumentAttachment({
      userId: "user_2",
      attachmentId: "attachment_1",
      storageRoot: "/private/attachments",
      dependencies: { assertCanReadDocument },
      db: {
        documentAttachment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "attachment_1",
            documentId: "doc_1",
            storageKey: "doc_1/attachment_1",
            originalName: "notes.txt",
            mimeType: "text/plain",
            byteSize: 5n,
            deletedAt: null,
          }),
        },
      },
    });

    expect(assertCanReadDocument).toHaveBeenCalledWith({
      userId: "user_2",
      documentId: "doc_1",
    });
    expect(result.filePath).toBe(
      "/private/attachments/doc_1/attachment_1",
    );
  });

  it("accepts HTML documents and renders them inline", () => {
    expect(WORKBENCH_DOCUMENT_ATTACHMENT_ALLOWED_MIME_TYPES).toContain("text/html");
    expect(isInlineDocumentAttachmentMimeType("text/html")).toBe(true);
  });
});
