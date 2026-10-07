import { describe, expect, it, vi } from "vitest";
import { createProjectDocument, updateProjectDocument } from "./project-documents";

describe("project document compatibility service", () => {
  it("resolves the project space and creates through the generic document delegate", async () => {
    const create = vi.fn().mockResolvedValue({ id: "doc_1", version: 1 });
    const directoryUpsert = vi.fn().mockResolvedValue({ id: "dir_docs", path: "docs" });
    const db = createDb({ create, directoryUpsert });

    await expect(
      createProjectDocument({
        db,
        projectId: "project_1",
        title: "部署说明",
        path: "docs/deploy.md",
        contentMarkdown: "# 部署说明",
        actorUserId: "user_owner",
        source: "web",
        createId: () => "doc_1",
      }),
    ).resolves.toEqual({ id: "doc_1", version: 1 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          spaceId: "space:company:company_1",
          projectId: "project_1",
          containerKey: "project:project_1",
          directoryId: "dir_docs",
          path: "docs/deploy.md",
        }),
      }),
    );
    expect(directoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          containerKey_path: {
            containerKey: "project:project_1",
            path: "docs",
          },
        },
      }),
    );
  });

  it("rejects projects without a space", async () => {
    const db = createDb({ projectSpaceId: null });

    await expect(
      createProjectDocument({
        db,
        projectId: "project_1",
        title: "README",
        path: "README.md",
        contentMarkdown: "# README",
        actorUserId: "user_owner",
        source: "web",
      }),
    ).rejects.toThrow("Document project has no space");
  });

  it("keeps optimistic update compatibility", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = createDb({
      current: { id: "doc_1", version: 2, contentMarkdown: "# Old" },
      updateMany,
    });

    await expect(
      updateProjectDocument({
        db,
        documentId: "doc_1",
        expectedVersion: 2,
        title: "README",
        contentMarkdown: "# Updated",
        actorUserId: "user_owner",
        source: "mcp",
      }),
    ).resolves.toEqual({ id: "doc_1", version: 3 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "doc_1", version: 2 } }),
    );
  });
});

function createDb(input: {
  projectSpaceId?: string | null;
  create?: ReturnType<typeof vi.fn>;
  current?: { id: string; version: number; contentMarkdown: string } | null;
  updateMany?: ReturnType<typeof vi.fn>;
  directoryUpsert?: ReturnType<typeof vi.fn>;
} = {}) {
  const tx = {
    documentDirectory: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: input.directoryUpsert ?? vi.fn(),
    },
    document: {
      create: input.create ?? vi.fn(),
      findUnique: vi.fn().mockResolvedValue(input.current ?? null),
      updateMany: input.updateMany ?? vi.fn(),
    },
    documentRevision: {
      create: vi.fn().mockResolvedValue({ id: "revision" }),
    },
  };

  return {
    project: {
      findUnique: vi.fn().mockResolvedValue({
        id: "project_1",
        spaceId:
          input.projectSpaceId === undefined
            ? "space:company:company_1"
            : input.projectSpaceId,
      }),
    },
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
}
