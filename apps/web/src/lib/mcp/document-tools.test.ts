import { describe, expect, it, vi } from "vitest";
import { dispatchMcpDocumentTool } from "./document-tools";
import { WORKBENCH_DOCUMENT_ATTACHMENT_MAX_BYTES } from "../workbench/workbench-document-attachments";

describe("MCP document tools", () => {
  it("lists root documents for an accessible space", async () => {
    const listSpaceDocuments = vi.fn().mockResolvedValue([
      {
        id: "doc_root",
        spaceId: "space:personal:user_owner",
        projectId: null,
        title: "Notes",
        path: "notes.md",
        version: 1,
        updatedAt: new Date("2026-07-18T00:00:00.000Z"),
      },
    ]);

    await expect(
      dispatchMcpDocumentTool(
        {
          tool: "list_documents",
          arguments: { spaceId: "space:personal:user_owner" },
          actorUserId: "user_owner",
        },
        { listSpaceDocuments },
      ),
    ).resolves.toEqual({ documents: expect.any(Array) });
    expect(listSpaceDocuments).toHaveBeenCalledWith({
      spaceId: "space:personal:user_owner",
      userId: "user_owner",
    });
  });

  it("creates a root document with MCP source", async () => {
    const createWorkbenchSpaceDocument = vi.fn().mockResolvedValue({
      id: "doc_root",
      version: 1,
    });

    await dispatchMcpDocumentTool(
      {
        tool: "create_document",
        arguments: {
          spaceId: "space:company:company_1",
          title: "Policy",
          path: "policy.md",
          contentMarkdown: "# Policy",
        },
        actorUserId: "user_owner",
      },
      { createWorkbenchSpaceDocument },
    );

    expect(createWorkbenchSpaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space:company:company_1",
        userId: "user_owner",
        source: "mcp",
      }),
    );
  });

  it("creates a nested project document with the declared target and path", async () => {
    const createWorkbenchDocument = vi.fn().mockResolvedValue({
      id: "doc_project",
      version: 1,
    });

    await dispatchMcpDocumentTool(
      {
        tool: "create_document",
        arguments: {
          spaceId: "space:company:company_1",
          projectId: "project_1",
          title: "设计",
          path: "需求文档/主题/设计.md",
          contentMarkdown: "# 设计",
        },
        actorUserId: "user_owner",
      },
      { createWorkbenchDocument },
    );

    expect(createWorkbenchDocument).toHaveBeenCalledWith({
      spaceId: "space:company:company_1",
      projectId: "project_1",
      userId: "user_owner",
      title: "设计",
      path: "需求文档/主题/设计.md",
      contentMarkdown: "# 设计",
      source: "mcp",
    });
  });

  it("lists one authorized document tree target", async () => {
    const listWorkbenchDocumentTargetTree = vi.fn().mockResolvedValue({
      spaceId: "space_1",
      groups: [{ key: "project:project_1", directories: [], documents: [] }],
      trash: [],
    });

    const result = await dispatchMcpDocumentTool(
      {
        tool: "list_document_tree",
        arguments: { spaceId: "space_1", projectId: "project_1" },
        actorUserId: "user_owner",
      },
      { listWorkbenchDocumentTargetTree },
    );

    expect(listWorkbenchDocumentTargetTree).toHaveBeenCalledWith({
      spaceId: "space_1",
      projectId: "project_1",
      userId: "user_owner",
    });
    expect(result).toEqual({ tree: expect.objectContaining({ spaceId: "space_1" }) });
  });

  it("moves a document to a target path as the authenticated actor", async () => {
    const moveWorkbenchDocument = vi.fn().mockResolvedValue({
      id: "doc_1",
      version: 1,
      path: "需求文档/主题/设计.md",
    });

    const result = await dispatchMcpDocumentTool(
      {
        tool: "move_document",
        arguments: {
          documentId: "doc_1",
          targetPath: "需求文档/主题/设计.md",
        },
        actorUserId: "user_owner",
      },
      { moveWorkbenchDocument },
    );

    expect(moveWorkbenchDocument).toHaveBeenCalledWith({
      documentId: "doc_1",
      targetPath: "需求文档/主题/设计.md",
      sortOrder: 0,
      userId: "user_owner",
    });
    expect(result).toEqual({ document: expect.objectContaining({ version: 1 }) });
  });

  it("appends to any authorized document", async () => {
    const appendWorkbenchDocument = vi.fn().mockResolvedValue({
      id: "doc_root",
      version: 2,
    });

    await dispatchMcpDocumentTool(
      {
        tool: "append_document",
        arguments: {
          documentId: "doc_root",
          expectedVersion: 1,
          title: "Notes",
          contentMarkdown: "More",
        },
        actorUserId: "user_owner",
      },
      { appendWorkbenchDocument },
    );

    expect(appendWorkbenchDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc_root", source: "mcp" }),
    );
  });

  it("lists project documents for the authenticated user", async () => {
    const listProjectDocuments = vi.fn().mockResolvedValue([
      {
        id: "doc_1",
        projectId: "project_1",
        title: "README",
        path: "README.md",
        version: 1,
        updatedAt: new Date("2026-05-19T00:00:00.000Z"),
      },
    ]);

    const result = await dispatchMcpDocumentTool(
      {
        tool: "list_project_documents",
        arguments: {
          projectId: "project_1",
        },
        actorUserId: "user_owner",
      },
      {
        listProjectDocuments,
      },
    );

    expect(result).toEqual({
      documents: [
        {
          id: "doc_1",
          projectId: "project_1",
          title: "README",
          path: "README.md",
          version: 1,
          updatedAt: new Date("2026-05-19T00:00:00.000Z"),
        },
      ],
    });
    expect(listProjectDocuments).toHaveBeenCalledWith({
      projectId: "project_1",
      userId: "user_owner",
    });
  });

  it("creates a project document with MCP source", async () => {
    const createWorkbenchDocument = vi.fn().mockResolvedValue({
      id: "doc_2",
      version: 1,
    });

    const result = await dispatchMcpDocumentTool(
      {
        tool: "create_project_document",
        arguments: {
          projectId: "project_1",
          title: "部署说明",
          path: "docs/deploy.md",
          contentMarkdown: "# 部署说明",
        },
        actorUserId: "user_owner",
      },
      {
        createWorkbenchDocument,
      },
    );

    expect(result).toEqual({
      document: {
        id: "doc_2",
        version: 1,
      },
    });
    expect(createWorkbenchDocument).toHaveBeenCalledWith({
      projectId: "project_1",
      userId: "user_owner",
      title: "部署说明",
      path: "docs/deploy.md",
      contentMarkdown: "# 部署说明",
      source: "mcp",
    });
  });

  it("rejects stale MCP document updates", async () => {
    const updateWorkbenchDocument = vi.fn().mockRejectedValue(
      new Error("Document version conflict"),
    );

    await expect(
      dispatchMcpDocumentTool(
        {
          tool: "update_project_document",
          arguments: {
            documentId: "doc_1",
            expectedVersion: 1,
            title: "README",
            contentMarkdown: "# Updated",
          },
          actorUserId: "user_owner",
        },
        {
          updateWorkbenchDocument,
        },
      ),
    ).rejects.toThrow("Document version conflict");
  });

  it("uploads an attachment from base64 through the protected document service", async () => {
    const saveWorkbenchDocumentAttachment = vi.fn().mockResolvedValue({
      id: "attachment_1",
      originalName: "roadmap.xmind",
      mimeType: "application/vnd.xmind.workbook",
      byteSize: 3,
      markdownUrl: "/api/document-attachments/attachment_1",
    });

    const result = await dispatchMcpDocumentTool(
      {
        tool: "upload_document_attachment",
        arguments: {
          documentId: "doc_1",
          fileName: "roadmap.xmind",
          mimeType: "application/vnd.xmind.workbook",
          contentBase64: Buffer.from([1, 2, 3]).toString("base64"),
        },
        actorUserId: "user_owner",
      },
      { saveWorkbenchDocumentAttachment },
    );

    expect(result).toEqual({ attachment: expect.objectContaining({
      id: "attachment_1",
      markdownUrl: "/api/document-attachments/attachment_1",
    }) });
    const call = saveWorkbenchDocumentAttachment.mock.calls[0]?.[0];
    expect(call).toMatchObject({ userId: "user_owner", documentId: "doc_1" });
    expect(call.file).toBeInstanceOf(File);
    expect(call.file.name).toBe("roadmap.xmind");
    expect(call.file.type).toBe("application/vnd.xmind.workbook");
    expect(Buffer.from(await call.file.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("rejects invalid base64 before uploading an attachment", async () => {
    const saveWorkbenchDocumentAttachment = vi.fn();

    await expect(dispatchMcpDocumentTool(
      {
        tool: "upload_document_attachment",
        arguments: {
          documentId: "doc_1",
          fileName: "broken.xmind",
          mimeType: "application/vnd.xmind.workbook",
          contentBase64: "not-base64!",
        },
        actorUserId: "user_owner",
      },
      { saveWorkbenchDocumentAttachment },
    )).rejects.toThrow("Document attachment contentBase64 is invalid");
    expect(saveWorkbenchDocumentAttachment).not.toHaveBeenCalled();
  });

  it("rejects attachments over the document attachment size limit before uploading", async () => {
    const saveWorkbenchDocumentAttachment = vi.fn();
    const oversized = Buffer.alloc(WORKBENCH_DOCUMENT_ATTACHMENT_MAX_BYTES + 1);

    await expect(dispatchMcpDocumentTool(
      {
        tool: "upload_document_attachment",
        arguments: {
          documentId: "doc_1",
          fileName: "oversized.xmind",
          mimeType: "application/vnd.xmind.workbook",
          contentBase64: oversized.toString("base64"),
        },
        actorUserId: "user_owner",
      },
      { saveWorkbenchDocumentAttachment },
    )).rejects.toThrow("Document attachment contentBase64 is too large");
    expect(saveWorkbenchDocumentAttachment).not.toHaveBeenCalled();
  });
});
