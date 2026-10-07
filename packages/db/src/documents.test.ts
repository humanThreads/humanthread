import { describe, expect, it, vi } from "vitest";
import {
  appendDocument,
  createDocument,
  normalizeDocumentPath,
  parseDocumentPath,
  updateDocument,
  updateDocumentIdempotently,
} from "./documents";

describe("document storage", () => {
  it("creates root and project documents with stable container keys", async () => {
    const create = vi.fn().mockResolvedValue({ id: "doc_1", version: 1 });
    const db = createDb({ create });

    await createDocument({
      db,
      spaceId: "space:personal:user_1",
      title: "Notes",
      path: "notes.md",
      contentMarkdown: "# Notes",
      actorUserId: "user_1",
      source: "web",
      createId: () => "doc_1",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          spaceId: "space:personal:user_1",
          projectId: null,
          containerKey: "space:space:personal:user_1",
        }),
      }),
    );
  });

  it("uses a project container and rejects cross-space projects", async () => {
    const create = vi.fn().mockResolvedValue({ id: "doc_1", version: 1 });
    const db = createDb({
      create,
      project: { id: "project_1", spaceId: "space:company:company_1" },
    });

    await createDocument({
      db,
      spaceId: "space:company:company_1",
      projectId: "project_1",
      title: "README",
      path: "README.md",
      contentMarkdown: "# README",
      actorUserId: "user_1",
      source: "web",
      createId: () => "doc_1",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          containerKey: "project:project_1",
        }),
      }),
    );

    await expect(
      createDocument({
        db,
        spaceId: "space:personal:user_1",
        projectId: "project_1",
        title: "Invalid",
        path: "invalid.md",
        contentMarkdown: "invalid",
        actorUserId: "user_1",
        source: "web",
      }),
    ).rejects.toThrow("Document project belongs to another space");
  });

  it("resolves nested document paths into idempotent directory membership", async () => {
    const create = vi.fn().mockResolvedValue({ id: "doc_1", version: 1 });
    const directoryUpsert = vi
      .fn()
      .mockResolvedValueOnce({ id: "dir_requirements", path: "需求文档" })
      .mockResolvedValueOnce({
        id: "dir_topic",
        path: "需求文档/项目中心路线图与决策活动",
      });
    const db = createDb({
      create,
      directoryUpsert,
      project: { id: "project_1", spaceId: "space:company:company_1" },
    });

    await createDocument({
      db,
      spaceId: "space:company:company_1",
      projectId: "project_1",
      title: "项目中心路线图与决策活动设计",
      path: "需求文档/项目中心路线图与决策活动/项目中心路线图与决策活动设计.md",
      contentMarkdown: "# 设计",
      actorUserId: "user_1",
      source: "mcp",
      createId: () => "doc_1",
    });

    expect(directoryUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          containerKey_path: {
            containerKey: "project:project_1",
            path: "需求文档",
          },
        },
        create: expect.objectContaining({ parentId: null, name: "需求文档" }),
      }),
    );
    expect(directoryUpsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          containerKey_path: {
            containerKey: "project:project_1",
            path: "需求文档/项目中心路线图与决策活动",
          },
        },
        create: expect.objectContaining({
          parentId: "dir_requirements",
          name: "项目中心路线图与决策活动",
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          directoryId: "dir_topic",
          path: "需求文档/项目中心路线图与决策活动/项目中心路线图与决策活动设计.md",
        }),
      }),
    );
  });

  it("returns a stable conflict when the document path already exists", async () => {
    const db = createDb({
      create: vi.fn().mockRejectedValue({ code: "P2002", message: "Unique constraint failed" }),
    });

    await expect(
      createDocument({
        db,
        spaceId: "space:personal:user_1",
        title: "Notes",
        path: "notes.md",
        contentMarkdown: "# Notes",
        actorUserId: "user_1",
        source: "mcp",
      }),
    ).rejects.toThrow("Document path conflict");
  });

  it("reuses a directory created by a concurrent resolver", async () => {
    const create = vi.fn().mockResolvedValue({ id: "doc_1", version: 1 });
    const directoryFindUnique = vi.fn().mockResolvedValue({
      id: "dir_docs",
      containerKey: "space:space_1",
      path: "docs",
    });
    const db = createDb({
      create,
      directoryFindUnique,
      directoryUpsert: vi
        .fn()
        .mockRejectedValue({ code: "P2002", message: "Unique constraint failed" }),
    });

    await createDocument({
      db,
      spaceId: "space_1",
      title: "README",
      path: "docs/README.md",
      contentMarkdown: "# README",
      actorUserId: "user_1",
      source: "mcp",
    });

    expect(directoryFindUnique).toHaveBeenCalledWith({
      where: {
        containerKey_path: {
          containerKey: "space:space_1",
          path: "docs",
        },
      },
      select: { id: true, path: true },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ directoryId: "dir_docs" }),
      }),
    );
  });

  it("uses a conditional version update and creates a revision", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const revisionCreate = vi.fn().mockResolvedValue({ id: "doc_1:v2" });
    const db = createDb({
      current: {
        id: "doc_1",
        version: 1,
        contentMarkdown: "# Old",
      },
      updateMany,
      revisionCreate,
    });

    await expect(
      updateDocument({
        db,
        documentId: "doc_1",
        expectedVersion: 1,
        title: "README",
        contentMarkdown: "# New",
        actorUserId: "user_1",
        source: "mcp",
      }),
    ).resolves.toEqual({ id: "doc_1", version: 2 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc_1", version: 1 },
        data: expect.objectContaining({ version: 2 }),
      }),
    );
    expect(revisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: expect.stringMatching(/^[a-f0-9]{32}$/u),
          version: 2,
          source: "mcp",
        }),
      }),
    );
  });

  it("keeps a revision identity at 32 characters for a maximum-length document ID", async () => {
    const documentId = "d".repeat(96);
    const revisionCreate = vi.fn().mockResolvedValue({ id: "revision" });
    const db = createDb({
      current: { id: documentId, version: 999, contentMarkdown: "# Old" },
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      revisionCreate,
    });

    await updateDocument({
      db,
      documentId,
      expectedVersion: 999,
      title: "README",
      contentMarkdown: "# New",
      actorUserId: "user_1",
      source: "web",
    });

    expect(revisionCreate.mock.calls[0]?.[0]?.data.id).toMatch(/^[a-f0-9]{32}$/u);
  });

  it("rejects a lost conditional update as a version conflict", async () => {
    const db = createDb({
      current: { id: "doc_1", version: 1, contentMarkdown: "# Old" },
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    });

    await expect(
      updateDocument({
        db,
        documentId: "doc_1",
        expectedVersion: 1,
        title: "README",
        contentMarkdown: "# New",
        actorUserId: "user_1",
        source: "web",
      }),
    ).rejects.toThrow("Document version conflict");
  });

  it("appends markdown through the same optimistic update", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = createDb({
      current: { id: "doc_1", version: 2, contentMarkdown: "# Existing" },
      updateMany,
    });

    await appendDocument({
      db,
      documentId: "doc_1",
      expectedVersion: 2,
      title: "README",
      contentMarkdown: "More",
      actorUserId: "user_1",
      source: "mcp",
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentMarkdown: "# Existing\n\nMore",
        }),
      }),
    );
  });

  it("stores a desktop update and command receipt in one transaction", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const revisionCreate = vi.fn().mockResolvedValue({ id: "doc_1:v2" });
    const db = createDb({
      current: { id: "doc_1", version: 1, contentMarkdown: "# Old" },
      updateMany,
      revisionCreate,
    });

    await expect(updateDocumentIdempotently({
      db,
      commandId: "desktop:document:save:1",
      documentId: "doc_1",
      expectedVersion: 1,
      title: "README",
      contentMarkdown: "# New",
      actorUserId: "user_1",
      source: "desktop",
    })).resolves.toEqual({ id: "doc_1", version: 2 });

    expect(db.tx.commandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.stringMatching(/^document:/u),
        aggregateType: "document",
        aggregateId: "doc_1",
        status: "processing",
      }),
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(revisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, source: "desktop" }),
    });
  });

  it("returns the stored document result for a repeated desktop command", async () => {
    const updateMany = vi.fn();
    const revisionCreate = vi.fn();
    const db = createDb({
      current: { id: "doc_1", version: 2, contentMarkdown: "# New" },
      updateMany,
      revisionCreate,
      existingReceipt: {
        id: "document:receipt",
        status: "completed",
        result: { id: "doc_1", version: 2 },
      },
    });

    await expect(updateDocumentIdempotently({
      db,
      commandId: "desktop:document:save:1",
      documentId: "doc_1",
      expectedVersion: 1,
      title: "README",
      contentMarkdown: "# New",
      actorUserId: "user_1",
      source: "desktop",
    })).resolves.toEqual({ id: "doc_1", version: 2 });

    expect(updateMany).not.toHaveBeenCalled();
    expect(revisionCreate).not.toHaveBeenCalled();
  });

  it("parses root and nested markdown paths", () => {
    expect(parseDocumentPath(" README.md ")).toEqual({
      path: "README.md",
      fileName: "README.md",
      directorySegments: [],
    });
    expect(parseDocumentPath("需求文档/主题/设计.md")).toEqual({
      path: "需求文档/主题/设计.md",
      fileName: "设计.md",
      directorySegments: ["需求文档", "主题"],
    });
    expect(normalizeDocumentPath("docs/readme.md")).toBe("docs/readme.md");
  });

  it.each([
    "/absolute.md",
    "a//b.md",
    "a/./b.md",
    "a/../b.md",
    "a\\\\b.md",
    "folder/",
    "folder/readme.txt",
  ])("rejects an invalid document path: %s", (path) => {
    expect(() => parseDocumentPath(path)).toThrow(/document path/iu);
  });
});

function createDb(input: {
  create?: ReturnType<typeof vi.fn>;
  project?: { id: string; spaceId: string | null } | null;
  current?: { id: string; version: number; contentMarkdown: string } | null;
  updateMany?: ReturnType<typeof vi.fn>;
  revisionCreate?: ReturnType<typeof vi.fn>;
  directoryUpsert?: ReturnType<typeof vi.fn>;
  directoryFindUnique?: ReturnType<typeof vi.fn>;
  existingReceipt?: unknown;
} = {}) {
  const tx = {
    commandReceipt: {
      findUnique: vi.fn().mockResolvedValue(input.existingReceipt ?? null),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    documentDirectory: {
      findUnique: input.directoryFindUnique ?? vi.fn().mockResolvedValue(null),
      upsert: input.directoryUpsert ?? vi.fn(),
    },
    document: {
      create: input.create ?? vi.fn(),
      findUnique: vi.fn().mockResolvedValue(input.current ?? null),
      updateMany: input.updateMany ?? vi.fn(),
    },
    documentRevision: {
      create: input.revisionCreate ?? vi.fn().mockResolvedValue({ id: "revision" }),
    },
  };

  return {
    tx,
    project: {
      findUnique: vi.fn().mockResolvedValue(input.project ?? null),
    },
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
}
