import { describe, expect, it, vi } from "vitest";
import {
  appendWorkbenchDocument,
  createWorkbenchDocument,
  createWorkbenchSpaceDocument,
  listAccessibleProjectDocuments,
  listAccessibleSpaceDocuments,
  listWorkbenchDocumentTree,
  listWorkbenchDocumentTargetTree,
  listWorkbenchDocumentRevisions,
  createWorkbenchDocumentDirectory,
  trashWorkbenchDocument,
  listProjectDocuments,
  listSpaceDocuments,
  searchWorkbenchDocuments,
  moveWorkbenchDocument,
  updateWorkbenchDocument,
  updateWorkbenchDocumentIdempotently,
} from "./workbench-documents";

describe("workbench document helpers", () => {
  it("filters the document tree to one selected project", async () => {
    const findProjects = vi.fn().mockResolvedValue([{ id: "project_1", name: "Platform" }]);
    const result = await listWorkbenchDocumentTree({
      userId: "user_1",
      spaceId: "space_1",
      projectId: "project_1",
      dependencies: {
        assertCanReadSpace: vi.fn().mockResolvedValue({ role: "member" }),
        assertCanReadProject: vi.fn().mockResolvedValue({ role: "viewer" }),
      },
      db: {
        project: { findMany: findProjects },
        documentDirectory: { findMany: vi.fn().mockResolvedValue([]) },
        document: { findMany: vi.fn().mockResolvedValue([]) },
      },
    });
    expect(findProjects).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "project_1" }) }));
    expect(result.groups.map((group) => group.key)).toEqual(["project:project_1"]);
  });

  it("groups the current space tree into root and accessible project containers", async () => {
    const assertCanReadSpace = vi.fn().mockResolvedValue({ role: "member" });
    const assertCanWriteProject = vi.fn().mockRejectedValue(new Error("Project write access denied"));
    const assertCanReadDocument = vi.fn().mockResolvedValue({ role: "member" });
    const findProjects = vi.fn().mockResolvedValue([{ id: "project_1", name: "Platform" }]);
    const findDirectories = vi.fn().mockResolvedValue([
      { id: "dir_root", parentId: null, projectId: null, containerKey: "space:space_1", name: "Policies", path: "Policies", sortOrder: 0 },
      { id: "dir_project", parentId: null, projectId: "project_1", containerKey: "project:project_1", name: "Runbooks", path: "Runbooks", sortOrder: 0 },
    ]);
    const findDocuments = vi.fn().mockResolvedValue([
      { id: "doc_root", directoryId: "dir_root", projectId: null, containerKey: "space:space_1", title: "Policy", path: "Policies/policy.md", sortOrder: 0, deletedAt: null },
      { id: "doc_project", directoryId: "dir_project", projectId: "project_1", containerKey: "project:project_1", title: "Deploy", path: "Runbooks/deploy.md", sortOrder: 0, deletedAt: null },
      { id: "doc_trash", directoryId: null, projectId: null, containerKey: "space:space_1", title: "Old", path: ".trash/doc_trash.md", sortOrder: 0, deletedAt: new Date("2026-07-19T00:00:00Z") },
    ]);

    const result = await listWorkbenchDocumentTree({
      userId: "user_1",
      spaceId: "space_1",
      dependencies: { assertCanReadSpace, assertCanWriteProject, assertCanReadDocument },
      db: {
        project: { findMany: findProjects },
        documentDirectory: { findMany: findDirectories },
        document: { findMany: findDocuments },
      },
    });

    expect(result.groups).toEqual([
      expect.objectContaining({ key: "space:space_1", label: "空间文档", canWrite: true }),
      expect.objectContaining({ key: "project:project_1", label: "Platform", canWrite: false }),
    ]);
    expect(result.trash).toEqual([
      expect.objectContaining({
        id: "doc_trash",
        groupKey: "space:space_1",
      }),
    ]);
  });

  it("hides documents that fail document-level permission checks", async () => {
    const assertCanReadDocument = vi.fn()
      .mockResolvedValueOnce({ role: "member" })
      .mockRejectedValueOnce(new Error("Document access denied"));
    const result = await listWorkbenchDocumentTree({
      userId: "user_1",
      spaceId: "space_1",
      dependencies: {
        assertCanReadSpace: vi.fn().mockResolvedValue({ role: "member" }),
        assertCanReadDocument,
      },
      db: {
        project: { findMany: vi.fn().mockResolvedValue([]) },
        documentDirectory: { findMany: vi.fn().mockResolvedValue([]) },
        document: { findMany: vi.fn().mockResolvedValue([
          { id: "doc_visible", directoryId: null, projectId: null, containerKey: "space:space_1", title: "可见", path: "visible.md", sortOrder: 0, deletedAt: null },
          { id: "doc_hidden", directoryId: null, projectId: null, containerKey: "space:space_1", title: "不可见", path: "hidden.md", sortOrder: 1, deletedAt: null },
        ]) },
      },
    });
    expect(result.groups[0]?.documents.map((document) => document.id)).toEqual(["doc_visible"]);
  });

  it("returns only the authorized project container for a targeted tree", async () => {
    const assertCanReadProject = vi.fn().mockResolvedValue({ role: "viewer" });
    const result = await listWorkbenchDocumentTargetTree({
      userId: "user_1",
      spaceId: "space_1",
      projectId: "project_1",
      dependencies: {
        assertCanReadSpace: vi.fn().mockResolvedValue({ role: "member" }),
        assertCanReadProject,
        assertCanWriteProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
        assertCanReadDocument: vi.fn().mockResolvedValue({ role: "viewer" }),
      },
      db: {
        project: {
          findMany: vi.fn().mockResolvedValue([{ id: "project_1", name: "Platform" }]),
        },
        documentDirectory: {
          findMany: vi.fn().mockResolvedValue([
            { id: "dir_root", parentId: null, projectId: null, containerKey: "space:space_1", name: "Policies", path: "Policies", sortOrder: 0 },
            { id: "dir_project", parentId: null, projectId: "project_1", containerKey: "project:project_1", name: "Runbooks", path: "Runbooks", sortOrder: 0 },
          ]),
        },
        document: {
          findMany: vi.fn().mockResolvedValue([
            { id: "doc_root", directoryId: "dir_root", projectId: null, containerKey: "space:space_1", title: "Policy", path: "Policies/policy.md", sortOrder: 0, deletedAt: null },
            { id: "doc_project", directoryId: "dir_project", projectId: "project_1", containerKey: "project:project_1", title: "Deploy", path: "Runbooks/deploy.md", sortOrder: 0, deletedAt: null },
          ]),
        },
      },
    });

    expect(assertCanReadProject).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
    expect(result.groups).toEqual([
      expect.objectContaining({ key: "project:project_1" }),
    ]);
    expect(result.groups[0]?.documents).toEqual([
      expect.objectContaining({ id: "doc_project" }),
    ]);
  });

  it("returns only the Space root container when no project is targeted", async () => {
    const result = await listWorkbenchDocumentTargetTree({
      userId: "user_1",
      spaceId: "space_1",
      dependencies: {
        assertCanReadSpace: vi.fn().mockResolvedValue({ role: "member" }),
        assertCanReadDocument: vi.fn().mockResolvedValue({ role: "member" }),
        assertCanWriteProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
      },
      db: {
        project: {
          findMany: vi.fn().mockResolvedValue([{ id: "project_1", name: "Platform" }]),
        },
        documentDirectory: {
          findMany: vi.fn().mockResolvedValue([
            { id: "dir_root", parentId: null, projectId: null, containerKey: "space:space_1", name: "Policies", path: "Policies", sortOrder: 0 },
            { id: "dir_project", parentId: null, projectId: "project_1", containerKey: "project:project_1", name: "Runbooks", path: "Runbooks", sortOrder: 0 },
          ]),
        },
        document: {
          findMany: vi.fn().mockResolvedValue([
            { id: "doc_root", directoryId: "dir_root", projectId: null, containerKey: "space:space_1", title: "Policy", path: "Policies/policy.md", sortOrder: 0, deletedAt: null },
            { id: "doc_project", directoryId: "dir_project", projectId: "project_1", containerKey: "project:project_1", title: "Deploy", path: "Runbooks/deploy.md", sortOrder: 0, deletedAt: null },
          ]),
        },
      },
    });

    expect(result.groups).toEqual([
      expect.objectContaining({
        key: "space:space_1",
        documents: [expect.objectContaining({ id: "doc_root" })],
      }),
    ]);
  });

  it("moves a document by path after checking document write access", async () => {
    const assertCanWriteDocument = vi.fn().mockResolvedValue({ role: "maintainer" });
    const moveDocument = vi.fn().mockResolvedValue({
      id: "doc_1",
      version: 1,
      path: "需求文档/主题/设计.md",
    });

    await moveWorkbenchDocument({
      userId: "user_1",
      documentId: "doc_1",
      targetPath: "需求文档/主题/设计.md",
      dependencies: { assertCanWriteDocument, moveDocument },
    });

    expect(assertCanWriteDocument).toHaveBeenCalledWith({
      userId: "user_1",
      documentId: "doc_1",
    });
    expect(moveDocument).toHaveBeenCalledWith({
      documentId: "doc_1",
      targetPath: "需求文档/主题/设计.md",
      sortOrder: 0,
      actorUserId: "user_1",
    });
  });

  it("authorizes directory creation and document trashing", async () => {
    const assertCanWriteSpace = vi.fn().mockResolvedValue({ role: "member" });
    const createDocumentDirectory = vi.fn().mockResolvedValue({ id: "dir_1" });
    await createWorkbenchDocumentDirectory({
      userId: "user_1",
      spaceId: "space_1",
      name: "Policies",
      dependencies: { assertCanWriteSpace, createDocumentDirectory },
    });
    expect(createDocumentDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ containerKey: "space:space_1", actorUserId: "user_1" }),
    );

    const assertCanWriteDocument = vi.fn().mockResolvedValue({ role: "member" });
    const softDeleteDocument = vi.fn().mockResolvedValue({ id: "doc_1" });
    await trashWorkbenchDocument({
      userId: "user_1",
      documentId: "doc_1",
      dependencies: { assertCanWriteDocument, softDeleteDocument },
    });
    expect(softDeleteDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc_1", actorUserId: "user_1" }),
    );
  });

  it("rejects a project directory target from another space", async () => {
    await expect(
      createWorkbenchDocumentDirectory({
        userId: "user_1",
        spaceId: "space_1",
        projectId: "project_1",
        name: "Guides",
        dependencies: {
          assertCanWriteProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
          createDocumentDirectory: vi.fn(),
        },
        db: {
          project: {
            findUnique: vi.fn().mockResolvedValue({
              id: "project_1",
              spaceId: "space_2",
            }),
          },
        },
      }),
    ).rejects.toThrow("Invalid project space");
  });
  it("lists project documents after checking project read access", async () => {
    const assertCanReadProject = vi.fn().mockResolvedValue({
      projectId: "project_1",
      role: "viewer",
    });
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "doc_1",
        projectId: "project_1",
        title: "README",
        path: "README.md",
        version: 1,
        updatedAt: new Date("2026-05-19T00:00:00.000Z"),
      },
    ]);

    const result = await listProjectDocuments({
      projectId: "project_1",
      userId: "user_owner",
      dependencies: {
        assertCanReadProject,
      },
      db: {
        document: {
          findMany,
        },
      },
    });

    expect(assertCanReadProject).toHaveBeenCalledWith({
      userId: "user_owner",
      projectId: "project_1",
    });
    expect(result).toEqual([
      {
        id: "doc_1",
        projectId: "project_1",
        title: "README",
        path: "README.md",
        version: 1,
        updatedAt: new Date("2026-05-19T00:00:00.000Z"),
      },
    ]);
  });

  it("creates a document after checking project write access", async () => {
    const assertCanWriteProject = vi.fn().mockResolvedValue({
      projectId: "project_1",
      role: "contributor",
    });
    const createProjectDocument = vi.fn().mockResolvedValue({
      id: "doc_1",
      version: 1,
    });

    const result = await createWorkbenchDocument({
      projectId: "project_1",
      directoryId: "dir_1",
      userId: "user_owner",
      title: "部署说明",
      path: "docs/deploy.md",
      contentMarkdown: "# 部署说明",
      source: "web",
      dependencies: {
        assertCanWriteProject,
        createProjectDocument,
      },
    });

    expect(assertCanWriteProject).toHaveBeenCalledWith({
      userId: "user_owner",
      projectId: "project_1",
      directoryId: "dir_1",
    });
    expect(createProjectDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        directoryId: "dir_1",
        actorUserId: "user_owner",
        source: "web",
      }),
    );
    expect(result).toEqual({
      id: "doc_1",
      version: 1,
    });
  });

  it("passes an explicit space target into project document creation", async () => {
    const createProjectDocument = vi.fn().mockResolvedValue({ id: "doc_1", version: 1 });

    await createWorkbenchDocument({
      spaceId: "space:company:company_1",
      projectId: "project_1",
      userId: "user_owner",
      title: "README",
      path: "README.md",
      contentMarkdown: "# README",
      source: "mcp",
      dependencies: {
        assertCanWriteProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
        createProjectDocument,
      },
    });

    expect(createProjectDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space:company:company_1",
        projectId: "project_1",
      }),
    );
  });

  it("lists documents across accessible projects in one query", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "doc_2",
        projectId: "project_2",
        title: "运行手册",
        path: "docs/runbook.md",
        version: 4,
        updatedAt: new Date("2026-05-20T00:00:00.000Z"),
        project: {
          id: "project_2",
          name: "Beta 项目",
        },
      },
      {
        id: "doc_1",
        projectId: "project_1",
        title: "README",
        path: "README.md",
        version: 1,
        updatedAt: new Date("2026-05-19T00:00:00.000Z"),
        project: {
          id: "project_1",
          name: "Alpha 项目",
        },
      },
    ]);

    const result = await listAccessibleProjectDocuments({
      userId: "user_owner",
      companyId: "company_1",
      ownerType: "company",
      db: {
        document: {
          findMany,
        },
      },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: { not: null },
          deletedAt: null,
          project: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ OR: expect.any(Array) }),
            ]),
          }),
        }),
      }),
    );
    expect(result).toEqual([
      {
        id: "doc_2",
        projectId: "project_2",
        projectName: "Beta 项目",
        title: "运行手册",
        path: "docs/runbook.md",
        version: 4,
        updatedAt: new Date("2026-05-20T00:00:00.000Z"),
      },
      {
        id: "doc_1",
        projectId: "project_1",
        projectName: "Alpha 项目",
        title: "README",
        path: "README.md",
        version: 1,
        updatedAt: new Date("2026-05-19T00:00:00.000Z"),
      },
    ]);
  });

  it("updates a document after checking document write access", async () => {
    const assertCanWriteDocument = vi.fn().mockResolvedValue({
      documentId: "doc_1",
      role: "maintainer",
    });
    const updateDocument = vi.fn().mockResolvedValue({
      id: "doc_1",
      version: 2,
    });

    const result = await updateWorkbenchDocument({
      documentId: "doc_1",
      userId: "user_owner",
      expectedVersion: 1,
      title: "README",
      contentMarkdown: "# Updated",
      source: "web",
      dependencies: {
        assertCanWriteDocument,
        updateDocument,
      },
    });

    expect(assertCanWriteDocument).toHaveBeenCalledWith({
      userId: "user_owner",
      documentId: "doc_1",
    });
    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc_1",
        expectedVersion: 1,
      }),
    );
    expect(result).toEqual({
      id: "doc_1",
      version: 2,
    });
  });

  it("forwards a desktop command ID through the authorized document service", async () => {
    const assertCanWriteDocument = vi.fn().mockResolvedValue({
      documentId: "doc_1",
      role: "maintainer",
    });
    const updateDocumentIdempotently = vi.fn().mockResolvedValue({
      id: "doc_1",
      version: 3,
    });

    await expect(updateWorkbenchDocumentIdempotently({
      commandId: "desktop:save:1",
      documentId: "doc_1",
      userId: "user_owner",
      expectedVersion: 2,
      title: "README",
      contentMarkdown: "# Updated again",
      source: "desktop",
      dependencies: { assertCanWriteDocument, updateDocumentIdempotently },
    })).resolves.toEqual({ id: "doc_1", version: 3 });

    expect(updateDocumentIdempotently).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "desktop:save:1",
      actorUserId: "user_owner",
      source: "desktop",
    }));
  });

  it("lists and creates root documents through space permissions", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "doc_root",
        spaceId: "space:personal:user_1",
        projectId: null,
        title: "Notes",
        path: "notes.md",
        version: 1,
        updatedAt: new Date("2026-07-18T00:00:00.000Z"),
      },
    ]);
    const assertCanReadSpace = vi.fn().mockResolvedValue({ role: "owner" });
    const assertCanWriteSpace = vi.fn().mockResolvedValue({ role: "owner" });
    const createDocument = vi.fn().mockResolvedValue({ id: "doc_root", version: 1 });

    await expect(
      listSpaceDocuments({
        userId: "user_1",
        spaceId: "space:personal:user_1",
        dependencies: { assertCanReadSpace },
        db: { document: { findMany } },
      }),
    ).resolves.toHaveLength(1);
    await expect(
      createWorkbenchSpaceDocument({
        userId: "user_1",
        spaceId: "space:personal:user_1",
        title: "Notes",
        path: "notes.md",
        contentMarkdown: "# Notes",
        source: "web",
        dependencies: { assertCanWriteSpace, createDocument },
      }),
    ).resolves.toEqual({ id: "doc_root", version: 1 });
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space:personal:user_1" }),
    );
  });

  it("searches documents inside an authorized project target", async () => {
    const assertCanReadProject = vi.fn().mockResolvedValue({ role: "viewer" });
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "doc_1",
        spaceId: "space:company:company_1",
        projectId: "project_1",
        title: "Runbook",
        path: "docs/runbook.md",
        version: 2,
        updatedAt: new Date("2026-07-18T00:00:00.000Z"),
        project: { id: "project_1", name: "Platform" },
      },
    ]);

    await expect(
      searchWorkbenchDocuments({
        userId: "user_1",
        spaceId: "space:company:company_1",
        projectId: "project_1",
        query: "runbook",
        dependencies: { assertCanReadProject },
        db: { document: { findMany } },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "doc_1", projectName: "Platform" }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          spaceId: "space:company:company_1",
          projectId: "project_1",
          OR: [
            { title: { contains: "runbook" } },
            { path: { contains: "runbook" } },
            { contentMarkdown: { contains: "runbook" } },
          ],
        }),
      }),
    );
  });

  it("appends through document authorization and shared storage", async () => {
    const assertCanWriteDocument = vi.fn().mockResolvedValue({ role: "member" });
    const appendDocument = vi.fn().mockResolvedValue({ id: "doc_root", version: 3 });

    await expect(
      appendWorkbenchDocument({
        userId: "user_1",
        documentId: "doc_root",
        expectedVersion: 2,
        title: "Notes",
        contentMarkdown: "More",
        source: "mcp",
        dependencies: { assertCanWriteDocument, appendDocument },
      }),
    ).resolves.toEqual({ id: "doc_root", version: 3 });
    expect(appendDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc_root",
        actorUserId: "user_1",
        source: "mcp",
      }),
    );
  });

  it("lists root documents only from spaces accessible to the user", async () => {
    const listAccessibleSpaces = vi.fn().mockResolvedValue([
      {
        id: "space:personal:user_1",
        type: "personal",
        name: "Personal",
        role: "owner",
        ownerUserId: "user_1",
        companyId: null,
      },
      {
        id: "space:company:company_1",
        type: "company",
        name: "Acme",
        role: "viewer",
        ownerUserId: null,
        companyId: "company_1",
      },
    ]);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "doc_root",
        spaceId: "space:company:company_1",
        projectId: null,
        title: "Policy",
        path: "policy.md",
        version: 1,
        updatedAt: new Date("2026-07-18T00:00:00.000Z"),
      },
    ]);

    await expect(
      listAccessibleSpaceDocuments({
        userId: "user_1",
        dependencies: { listAccessibleSpaces },
        db: { document: { findMany } },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "doc_root",
        spaceName: "Acme",
        spaceRole: "viewer",
      }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: null,
          spaceId: {
            in: ["space:personal:user_1", "space:company:company_1"],
          },
        },
      }),
    );
  });

  it("returns revision markdown after checking document read access", async () => {
    const assertCanReadDocument = vi.fn().mockResolvedValue({ role: "viewer" });
    const findMany = vi.fn().mockResolvedValue([{
      id: "revision_2",
      documentId: "doc_1",
      version: 2,
      contentMarkdown: "# Historical version",
      source: "web",
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      createdById: "user_1",
    }]);

    await expect(listWorkbenchDocumentRevisions({
      documentId: "doc_1",
      userId: "user_viewer",
      dependencies: { assertCanReadDocument },
      db: { documentRevision: { findMany } },
    })).resolves.toEqual([
      expect.objectContaining({ contentMarkdown: "# Historical version" }),
    ]);
    expect(assertCanReadDocument).toHaveBeenCalledWith({
      userId: "user_viewer",
      documentId: "doc_1",
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ contentMarkdown: true }),
    }));
  });
});
