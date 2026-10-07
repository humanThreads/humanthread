import { describe, expect, it, vi } from "vitest";
import {
  buildDocumentTree,
  deleteDocumentDirectory,
  moveDocument,
  moveDocumentDirectory,
  normalizeDocumentDirectoryName,
  restoreDocument,
  softDeleteDocument,
} from "./document-tree";

describe("document tree services", () => {
  it("builds ordered nested directory nodes with documents", () => {
    expect(
      buildDocumentTree({
        directories: [
          { id: "child", parentId: "root", name: "Setup", path: "Guides/Setup", sortOrder: 1 },
          { id: "root", parentId: null, name: "Guides", path: "Guides", sortOrder: 0 },
        ],
        documents: [
          { id: "doc_2", directoryId: "child", title: "Install", path: "Guides/Setup/install.md", sortOrder: 1 },
          { id: "doc_1", directoryId: null, title: "Home", path: "README.md", sortOrder: 0 },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        type: "directory",
        id: "root",
        children: [
          expect.objectContaining({
            type: "directory",
            id: "child",
            children: [expect.objectContaining({ type: "document", id: "doc_2" })],
          }),
        ],
      }),
      expect.objectContaining({ type: "document", id: "doc_1" }),
    ]);
  });

  it("normalizes directory names and rejects path-like names", () => {
    expect(normalizeDocumentDirectoryName("  Product Notes  ")).toBe("Product Notes");
    expect(() => normalizeDocumentDirectoryName("docs/setup")).toThrow(
      "Invalid document directory name",
    );
    expect(() => normalizeDocumentDirectoryName("..")).toThrow(
      "Invalid document directory name",
    );
  });

  it("rejects moving a directory into its own descendant", async () => {
    const db = createTreeDb({
      directory: {
        id: "root",
        containerKey: "project:project_1",
        parentId: null,
        name: "Guides",
        path: "Guides",
      },
      target: {
        id: "child",
        containerKey: "project:project_1",
        parentId: "root",
        name: "Setup",
        path: "Guides/Setup",
      },
    });

    await expect(
      moveDocumentDirectory({
        db,
        directoryId: "root",
        parentId: "child",
        sortOrder: 0,
        actorUserId: "user_1",
      }),
    ).rejects.toThrow("Document directory cycle");
  });

  it("rejects cross-container moves", async () => {
    const db = createTreeDb({
      directory: {
        id: "root",
        containerKey: "project:project_1",
        parentId: null,
        name: "Guides",
        path: "Guides",
      },
      target: {
        id: "other",
        containerKey: "project:project_2",
        parentId: null,
        name: "Other",
        path: "Other",
      },
    });

    await expect(
      moveDocumentDirectory({
        db,
        directoryId: "root",
        parentId: "other",
        sortOrder: 0,
        actorUserId: "user_1",
      }),
    ).rejects.toThrow("Document tree move crosses containers");
  });

  it("moves a document by target path without changing revision fields", async () => {
    const db = createTreeDb({
      documentReads: [
        {
          id: "doc_1",
          spaceId: "space_1",
          projectId: "project_1",
          containerKey: "project:project_1",
          path: "项目中心路线图与决策活动设计.md",
          directoryId: null,
          version: 1,
          contentMarkdown: "# 设计",
        },
      ],
      directoryUpserts: [
        { id: "dir_requirements", path: "需求文档" },
        {
          id: "dir_topic",
          path: "需求文档/项目中心路线图与决策活动",
        },
      ],
    });

    await moveDocument({
      db,
      documentId: "doc_1",
      targetPath: "需求文档/项目中心路线图与决策活动/项目中心路线图与决策活动设计.md",
      sortOrder: 0,
      actorUserId: "user_1",
    });

    expect(db.document.update).toHaveBeenCalledWith({
      where: { id: "doc_1" },
      data: {
        directoryId: "dir_topic",
        path: "需求文档/项目中心路线图与决策活动/项目中心路线图与决策活动设计.md",
        sortOrder: 0,
        updatedById: "user_1",
      },
    });
    const update = db.document.update.mock.calls[0]?.[0];
    expect(update.data).not.toHaveProperty("version");
    expect(update.data).not.toHaveProperty("contentMarkdown");
  });

  it("returns a stable conflict when a move target path is occupied", async () => {
    const db = createTreeDb({
      documentReads: [
        {
          id: "doc_1",
          spaceId: "space_1",
          projectId: null,
          containerKey: "space:space_1",
          path: "old.md",
          directoryId: null,
        },
      ],
      documentUpdate: vi
        .fn()
        .mockRejectedValue({ code: "P2002", message: "Unique constraint failed" }),
    });

    await expect(
      moveDocument({
        db,
        documentId: "doc_1",
        targetPath: "occupied.md",
        sortOrder: 0,
        actorUserId: "user_1",
      }),
    ).rejects.toThrow("Document path conflict");
  });

  it("rejects deleting a non-empty directory", async () => {
    const db = createTreeDb({ childCount: 1 });
    await expect(
      deleteDocumentDirectory({
        db,
        directoryId: "root",
        actorUserId: "user_1",
      }),
    ).rejects.toThrow("Document directory is not empty");
  });

  it("soft deletes and restores a document with conflict checks", async () => {
    const now = new Date("2026-07-19T00:00:00.000Z");
    const db = createTreeDb({
      activePathCount: 0,
      documentReads: [
        {
          id: "doc_1",
          containerKey: "project:project_1",
          path: "Guides/readme.md",
          directoryId: "root",
          deletedAt: null,
          deletedFromPath: null,
          deletedFromDirectoryId: null,
        },
        {
          id: "doc_1",
          containerKey: "project:project_1",
          path: ".trash/doc_1.md",
          directoryId: null,
          deletedAt: now,
          deletedFromPath: "Guides/readme.md",
          deletedFromDirectoryId: "root",
        },
      ],
    });

    await softDeleteDocument({
      db,
      documentId: "doc_1",
      actorUserId: "user_1",
      now,
    });
    expect(db.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          path: ".trash/doc_1.md",
          directoryId: null,
          deletedAt: now,
          deletedById: "user_1",
          deletedFromPath: "Guides/readme.md",
        }),
      }),
    );

    await restoreDocument({
      db,
      documentId: "doc_1",
      actorUserId: "user_1",
    });
    expect(db.document.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          path: "Guides/readme.md",
          deletedAt: null,
          deletedById: null,
          deletedFromPath: null,
          deletedFromDirectoryId: null,
          updatedById: "user_1",
        }),
      }),
    );
  });
});

function createTreeDb(input: {
  directory?: Record<string, unknown>;
  target?: Record<string, unknown> | null;
  childCount?: number;
  activePathCount?: number;
  documentReads?: Array<Record<string, unknown>>;
  directoryUpserts?: Array<Record<string, unknown>>;
  documentUpdate?: ReturnType<typeof vi.fn>;
} = {}) {
  const document = {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce(input.documentReads?.[0] ?? {
        id: "doc_1",
        containerKey: "project:project_1",
        path: "Guides/readme.md",
        directoryId: "root",
        deletedAt: null,
        deletedFromPath: null,
        deletedFromDirectoryId: null,
      })
      .mockResolvedValue(input.documentReads?.[1] ?? null),
    count: vi.fn().mockResolvedValue(input.activePathCount ?? 0),
    update: input.documentUpdate ?? vi.fn().mockResolvedValue({ id: "doc_1" }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const directory = {
    findUnique: vi
      .fn()
      .mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === "root"
            ? input.directory ?? {
                id: "root",
                containerKey: "project:project_1",
                parentId: null,
                name: "Guides",
                path: "Guides",
              }
            : input.target ?? null,
        ),
      ),
    count: vi.fn().mockResolvedValue(input.childCount ?? 0),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    upsert: vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(input.directoryUpserts?.[0] ?? { id: "dir_root", path: "Guides" }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(input.directoryUpserts?.[1] ?? { id: "dir_child", path: "Guides/Setup" }),
      ),
  };
  const tx = { document, documentDirectory: directory };
  return {
    document,
    documentDirectory: directory,
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
  };
}
