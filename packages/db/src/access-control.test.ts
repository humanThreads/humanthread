import { describe, expect, it, vi } from "vitest";
import {
  assertCanReadDocument,
  assertCanWriteDocument,
  assertCanReadProject,
  assertCanWriteProject,
  listAccessibleProjects,
} from "./access-control";

function createProjectAccessDb(input: {
  project?: {
    id: string;
    ownerType: string;
    companyId: string | null;
    ownerUserId: string | null;
    visibility?: string;
    spaceId?: string | null;
    space?: {
      id: string;
      type: string;
      ownerUserId: string | null;
      companyId: string | null;
      name: string;
      status: string;
    } | null;
  } | null;
  projectMembership?: { role: string; status: string } | null;
  companyMembership?: { role: string; status: string } | null;
}) {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue(input.project ?? null),
      findMany: vi.fn(),
    },
    projectMember: {
      findFirst: vi.fn().mockResolvedValue(input.projectMembership ?? null),
    },
    companyMember: {
      findFirst: vi.fn().mockResolvedValue(input.companyMembership ?? null),
    },
  };
}

describe("project access control", () => {
  it("allows an explicit active project member to read a project", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "project_1",
        ownerType: "company",
        companyId: "company_1",
        ownerUserId: null,
      },
      projectMembership: {
        role: "viewer",
        status: "active",
      },
    });

    await expect(
      assertCanReadProject({
        userId: "user_1",
        projectId: "project_1",
        db,
      }),
    ).resolves.toEqual({
      projectId: "project_1",
      role: "viewer",
    });
  });

  it("allows a company admin to read and write a company project", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "project_1",
        ownerType: "company",
        companyId: "company_1",
        ownerUserId: null,
      },
      companyMembership: {
        role: "admin",
        status: "active",
      },
    });

    await expect(
      assertCanWriteProject({
        userId: "user_admin",
        projectId: "project_1",
        db,
      }),
    ).resolves.toEqual({
      projectId: "project_1",
      role: "maintainer",
    });
  });

  it("allows a personal project owner to read and write their project", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "project_personal",
        ownerType: "personal",
        companyId: null,
        ownerUserId: "user_owner",
      },
    });

    await expect(
      assertCanWriteProject({
        userId: "user_owner",
        projectId: "project_personal",
        db,
      }),
    ).resolves.toEqual({
      projectId: "project_personal",
      role: "owner",
    });
  });

  it("rejects a user without project membership or company admin role", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "project_1",
        ownerType: "company",
        companyId: "company_1",
        ownerUserId: null,
      },
      companyMembership: {
        role: "member",
        status: "active",
      },
    });

    await expect(
      assertCanReadProject({
        userId: "user_2",
        projectId: "project_1",
        db,
      }),
    ).rejects.toThrow("Project access denied");
  });

  it("rejects write access for read-only project members", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "project_1",
        ownerType: "company",
        companyId: "company_1",
        ownerUserId: null,
      },
      projectMembership: {
        role: "viewer",
        status: "active",
      },
    });

    await expect(
      assertCanWriteProject({
        userId: "user_viewer",
        projectId: "project_1",
        db,
      }),
    ).rejects.toThrow("Project write access denied");
  });

  it("gives company owners implicit maintainer access through the company space", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "project_1",
        ownerType: "company",
        companyId: "company_1",
        ownerUserId: null,
        visibility: "private",
        spaceId: "space:company:company_1",
        space: {
          id: "space:company:company_1",
          type: "company",
          ownerUserId: null,
          companyId: "company_1",
          name: "Company",
          status: "active",
        },
      },
      companyMembership: {
        role: "owner",
        status: "active",
      },
    });

    await expect(
      assertCanWriteProject({
        userId: "user_owner",
        projectId: "project_1",
        db,
      }),
    ).resolves.toEqual({
      projectId: "project_1",
      role: "maintainer",
    });
  });

  it("requires company members to have an explicit project membership", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "project_1",
        ownerType: "company",
        companyId: "company_1",
        ownerUserId: null,
        visibility: "private",
        spaceId: "space:company:company_1",
        space: {
          id: "space:company:company_1",
          type: "company",
          ownerUserId: null,
          companyId: "company_1",
          name: "Company",
          status: "active",
        },
      },
      companyMembership: {
        role: "member",
        status: "active",
      },
    });

    await expect(
      assertCanReadProject({
        userId: "user_member",
        projectId: "project_1",
        db,
      }),
    ).rejects.toThrow("Project access denied");
  });

  it("keeps company viewers read-only despite a contributor project role", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "project_1",
        ownerType: "company",
        companyId: "company_1",
        ownerUserId: null,
        visibility: "private",
        spaceId: "space:company:company_1",
        space: {
          id: "space:company:company_1",
          type: "company",
          ownerUserId: null,
          companyId: "company_1",
          name: "Company",
          status: "active",
        },
      },
      projectMembership: {
        role: "contributor",
        status: "active",
      },
      companyMembership: {
        role: "viewer",
        status: "active",
      },
    });

    await expect(
      assertCanReadProject({
        userId: "user_viewer",
        projectId: "project_1",
        db,
      }),
    ).resolves.toEqual({
      projectId: "project_1",
      role: "viewer",
    });
    await expect(
      assertCanWriteProject({
        userId: "user_viewer",
        projectId: "project_1",
        db,
      }),
    ).rejects.toThrow("Project write access denied");
  });

  it("retains legacy project authorization when no space is assigned", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "legacy_project",
        ownerType: "personal",
        companyId: null,
        ownerUserId: "user_owner",
        spaceId: null,
        space: null,
      },
    });

    await expect(
      assertCanReadProject({
        userId: "user_owner",
        projectId: "legacy_project",
        db,
      }),
    ).resolves.toEqual({
      projectId: "legacy_project",
      role: "owner",
    });
  });

  it("keeps explicit collaborators on personal-space projects", async () => {
    const db = createProjectAccessDb({
      project: {
        id: "personal_project",
        ownerType: "personal",
        companyId: null,
        ownerUserId: "user_owner",
        visibility: "private",
        spaceId: "space:personal:user_owner",
        space: {
          id: "space:personal:user_owner",
          type: "personal",
          ownerUserId: "user_owner",
          companyId: null,
          name: "Personal",
          status: "active",
        },
      },
      projectMembership: {
        role: "contributor",
        status: "active",
      },
    });

    await expect(
      assertCanWriteProject({
        userId: "user_collaborator",
        projectId: "personal_project",
        db,
      }),
    ).resolves.toEqual({
      projectId: "personal_project",
      role: "contributor",
    });
  });

  it("filters accessible projects by company", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "project_1" }]);
    const result = await listAccessibleProjects({
      userId: "user_1",
      companyId: "company_1",
      db: {
        project: {
          findMany,
        },
      },
    });

    expect(result).toEqual([{ id: "project_1" }]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { space: { companyId: "company_1" } },
                { spaceId: null, companyId: "company_1" },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("lists projects through space ownership and membership rules", async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await listAccessibleProjects({
      userId: "user_1",
      db: { project: { findMany } },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            {
              space: {
                type: "personal",
                status: "active",
                ownerUserId: "user_1",
              },
            },
            {
              AND: [
                {
                  space: {
                    type: "personal",
                    status: "active",
                  },
                },
                {
                  members: {
                    some: {
                      userId: "user_1",
                      status: "active",
                    },
                  },
                },
              ],
            },
            {
              space: {
                type: "company",
                status: "active",
                company: {
                  members: {
                    some: {
                      userId: "user_1",
                      status: "active",
                      role: { in: ["owner", "admin"] },
                    },
                  },
                },
              },
            },
            {
              AND: expect.arrayContaining([
                {
                  members: {
                    some: {
                      userId: "user_1",
                      status: "active",
                    },
                  },
                },
              ]),
            },
          ]),
        },
      }),
    );
  });

  it("authorizes root documents through their space", async () => {
    const assertCanReadSpace = vi.fn().mockResolvedValue({
      spaceId: "space:company:company_1",
      role: "member",
    });
    const db = {
      document: {
        findUnique: vi.fn().mockResolvedValue({
          id: "doc_root",
          spaceId: "space:company:company_1",
          projectId: null,
        }),
      },
    };

    await expect(
      assertCanReadDocument({
        userId: "user_1",
        documentId: "doc_root",
        db,
        dependencies: { assertCanReadSpace },
      }),
    ).resolves.toEqual({ documentId: "doc_root", role: "member" });
    expect(assertCanReadSpace).toHaveBeenCalledWith({
      userId: "user_1",
      spaceId: "space:company:company_1",
    });
  });

  it("authorizes project documents through the project and rejects cross-space targets", async () => {
    const assertCanWriteProject = vi.fn().mockResolvedValue({
      projectId: "project_1",
      role: "contributor",
    });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: "doc_1",
        spaceId: "space:company:company_1",
        projectId: "project_1",
        project: { id: "project_1", spaceId: "space:company:company_1" },
      })
      .mockResolvedValueOnce({
        id: "doc_invalid",
        spaceId: "space:personal:user_1",
        projectId: "project_1",
        project: { id: "project_1", spaceId: "space:company:company_1" },
      });
    const db = { document: { findUnique } };

    await expect(
      assertCanWriteDocument({
        userId: "user_1",
        documentId: "doc_1",
        db,
        dependencies: { assertCanWriteProject },
      }),
    ).resolves.toEqual({ documentId: "doc_1", role: "contributor" });
    await expect(
      assertCanWriteDocument({
        userId: "user_1",
        documentId: "doc_invalid",
        db,
        dependencies: { assertCanWriteProject },
      }),
    ).rejects.toThrow("Document project belongs to another space");
  });

  it("allows a folder grant to authorize a document without project membership", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "doc_folder_grant",
      spaceId: "space:company:company_1",
      projectId: "project_1",
      directoryId: "directory_1",
      project: { id: "project_1", spaceId: "space:company:company_1" },
    });
    const db = {
      document: { findUnique },
      documentDirectory: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: "directory_1", parentId: null, spaceId: "space:company:company_1" })
          .mockResolvedValueOnce(null),
      },
      documentPermission: {
        findMany: vi.fn().mockResolvedValue([{ permission: "read", userDigest: "digest", revokedAt: null }]),
      },
    };

    await expect(assertCanReadDocument({
      userId: "user_folder_member",
      documentId: "doc_folder_grant",
      db,
      dependencies: {
        assertCanReadProject: vi.fn().mockRejectedValue(new Error("Project access denied")),
      },
    })).resolves.toEqual({ documentId: "doc_folder_grant", role: "viewer" });
  });

  it("keeps project member access level when a lower document grant also exists", async () => {
    const db = {
      document: { findUnique: vi.fn().mockResolvedValue({
        id: "doc_project_member",
        spaceId: "space:company:company_1",
        projectId: "project_1",
        directoryId: "directory_1",
        project: { id: "project_1", spaceId: "space:company:company_1" },
      }) },
      documentDirectory: { findUnique: vi.fn().mockResolvedValueOnce({ id: "directory_1", parentId: null, spaceId: "space:company:company_1" }) },
      documentPermission: { findMany: vi.fn().mockResolvedValue([{ permission: "read", userDigest: "digest", revokedAt: null }]) },
    };

    await expect(assertCanReadDocument({
      userId: "user_project_member",
      documentId: "doc_project_member",
      db,
      dependencies: { assertCanReadProject: vi.fn().mockResolvedValue({ role: "contributor" }) },
    })).resolves.toEqual({ documentId: "doc_project_member", role: "contributor" });
  });
});
