import { describe, expect, it, vi } from "vitest";

import {
  DesktopDocumentVersionConflictError,
  readDesktopDocumentDetail,
  readDesktopDocumentRevisions,
  readDesktopDocumentTree,
  updateDesktopDocument,
} from "./desktop-document-models";

const context = {
  actor: { userId: "user_1", authKind: "desktop_token", sessionId: "session_1" },
  space: {
    id: "space:company:company_1",
    key: "company:company_1",
    kind: "company",
    name: "Acme",
    role: "admin",
    companyId: "company_1",
  },
  spaces: [],
  workbench: { teamId: "team_1" },
  nativeExecutionAuthorized: true,
  localDeviceId: "device_1",
} as const;

const document = {
  id: "doc_1",
  spaceId: context.space.id,
  projectId: "project_1",
  title: "架构说明",
  path: "architecture.md",
  contentMarkdown: "# Current",
  version: 8,
  createdAt: new Date("2026-07-20T08:00:00.000Z"),
  updatedAt: new Date("2026-07-27T08:00:00.000Z"),
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
    getWorkbenchDocument: vi.fn().mockResolvedValue(document),
    listWorkbenchDocumentTree: vi.fn(),
    listWorkbenchDocumentRevisions: vi.fn(),
    updateWorkbenchDocumentIdempotently: vi.fn(),
    assertCanWriteDocument: vi.fn().mockResolvedValue({ documentId: "doc_1", role: "maintainer" }),
    ...overrides,
  };
}

describe("desktop Document read and write models", () => {
  it("projects the selected Space tree without leaking its database ID", async () => {
    const deps = dependencies({
      listWorkbenchDocumentTree: vi.fn().mockResolvedValue({
        spaceId: context.space.id,
        groups: [{
          key: `space:${context.space.id}`,
          label: "空间文档",
          spaceId: context.space.id,
          projectId: null,
          canWrite: true,
          directories: [],
          documents: [{
            id: "doc_1", groupKey: `space:${context.space.id}`, directoryId: null,
            title: "架构说明", path: "architecture.md", sortOrder: 0, deletedAt: null,
          }],
        }],
        trash: [],
      }),
    });

    const result = await readDesktopDocumentTree(
      new Request("http://localhost/api/desktop/documents/tree?space=company:company_1"),
      deps as never,
    );

    expect(result.groups[0]).toMatchObject({ key: "space", projectId: null });
    expect(result.groups[0]?.documents[0]?.route).toBe("/documents/doc_1");
    expect(JSON.stringify(result)).not.toContain("spaceId");
  });

  it("serializes detail dates and server-projected edit capability", async () => {
    const result = await readDesktopDocumentDetail(
      new Request("http://localhost/api/desktop/documents/doc_1?space=company:company_1"),
      "doc_1",
      dependencies() as never,
    );

    expect(result.detail).toMatchObject({
      id: "doc_1",
      version: 8,
      updatedAt: "2026-07-27T08:00:00.000Z",
      capabilities: { edit: true },
    });
    expect(JSON.stringify(result)).not.toContain("spaceId");
  });

  it("rejects an otherwise readable document from another selected Space", async () => {
    await expect(readDesktopDocumentDetail(
      new Request("http://localhost/api/desktop/documents/doc_other?space=company:company_1"),
      "doc_other",
      dependencies({
        getWorkbenchDocument: vi.fn().mockResolvedValue({ ...document, spaceId: "space:personal:user_1" }),
      }) as never,
    )).rejects.toThrow("Document not found");
  });

  it("returns serialized historical Markdown only after selected-Space validation", async () => {
    const listWorkbenchDocumentRevisions = vi.fn().mockResolvedValue([{
      id: "doc_1:v7", documentId: "doc_1", version: 7,
      contentMarkdown: "历史版本正文", source: "desktop",
      createdAt: new Date("2026-07-26T08:00:00.000Z"), createdById: "user_1",
    }]);

    const result = await readDesktopDocumentRevisions(
      new Request("http://localhost/api/desktop/documents/doc_1/revisions?space=company:company_1"),
      "doc_1",
      dependencies({ listWorkbenchDocumentRevisions }) as never,
    );

    expect(result.revisions[0]).toMatchObject({
      contentMarkdown: "历史版本正文",
      createdAt: "2026-07-26T08:00:00.000Z",
    });
    expect(listWorkbenchDocumentRevisions).toHaveBeenCalledWith({
      documentId: "doc_1",
      userId: "user_1",
    });
  });

  it("reports the current server version when an optimistic update conflicts", async () => {
    const getWorkbenchDocument = vi.fn()
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce({ ...document, version: 9 });
    const deps = dependencies({
      getWorkbenchDocument,
      updateWorkbenchDocumentIdempotently: vi.fn()
        .mockRejectedValue(new Error("Document version conflict")),
    });

    await expect(updateDesktopDocument(
      new Request("http://localhost/api/desktop/documents/doc_1?space=company:company_1"),
      "doc_1",
      {
        commandId: "desktop:save:1",
        expectedVersion: 8,
        title: "架构说明",
        contentMarkdown: "# Mine",
      },
      deps as never,
    )).rejects.toEqual(new DesktopDocumentVersionConflictError(9));
  });
});
