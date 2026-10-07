import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import {
  assertCanReadSpace,
  assertCanWriteSpace,
  assertValidSpaceOwner,
  type SpaceRow,
} from "./spaces";
import { effectiveDocumentPermission, permissionRank, type DocumentPermission } from "./document-permissions";

type ProjectRow = {
  id: string;
  visibility: string;
  spaceId: string | null;
  ownerType: string;
  companyId: string | null;
  ownerUserId: string | null;
  space: SpaceRow | null;
};

type RoleRow = {
  role: string;
  status: string;
};

type AccessControlDb = {
  project: {
    findUnique(input: unknown): Promise<ProjectRow | null>;
    findMany(input: unknown): Promise<unknown[]>;
  };
  projectMember: {
    findFirst(input: unknown): Promise<RoleRow | null>;
  };
  companyMember: {
    findFirst(input: unknown): Promise<RoleRow | null>;
  };
};

type ProjectListDb = {
  project: {
    findMany(input: unknown): Promise<unknown[]>;
  };
};

const COMPANY_ADMIN_ROLES = new Set(["owner", "admin"]);
const PROJECT_WRITE_ROLES = new Set(["owner", "maintainer", "contributor"]);

export interface ProjectAccess {
  projectId: string;
  role: string;
}

export interface DocumentAccess {
  documentId: string;
  role: string;
}

type DocumentAccessDb = {
  document: {
    findUnique(input: unknown): Promise<{
      id: string;
      spaceId: string | null;
      projectId: string | null;
      directoryId?: string | null;
      project?: { id: string; spaceId: string | null } | null;
    } | null>;
  };
  documentPermission?: { findMany(input: unknown): Promise<Array<{ permission: string; userDigest: string; revokedAt: Date | null }>> };
  documentDirectory?: { findUnique(input: unknown): Promise<{ id: string; parentId: string | null; spaceId: string } | null> };
};

type DocumentAccessDependencies = {
  assertCanReadSpace: typeof assertCanReadSpace;
  assertCanWriteSpace: typeof assertCanWriteSpace;
  assertCanReadProject: typeof assertCanReadProject;
  assertCanWriteProject: typeof assertCanWriteProject;
};

export function buildAccessibleProjectWhere(input: {
  userId: string;
  companyId?: string;
  ownerType?: "company" | "personal";
}): Prisma.ProjectWhereInput {
  const accessWhere: Prisma.ProjectWhereInput = {
    OR: [
      {
        space: {
          type: "personal",
          status: "active",
          ownerUserId: input.userId,
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
                userId: input.userId,
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
                userId: input.userId,
                status: "active",
                role: {
                  in: ["owner", "admin"],
                },
              },
            },
          },
        },
      },
      {
        AND: [
          {
            space: {
              type: "company",
              status: "active",
              company: {
                members: {
                  some: {
                    userId: input.userId,
                    status: "active",
                    role: {
                      in: ["member", "viewer"],
                    },
                  },
                },
              },
            },
          },
          {
            members: {
              some: {
                userId: input.userId,
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
                userId: input.userId,
                status: "active",
                role: "viewer",
              },
            },
          },
        },
        visibility: "space",
      },
      {
        spaceId: null,
        ownerType: "personal",
        ownerUserId: input.userId,
      },
      {
        spaceId: null,
        members: {
          some: {
            userId: input.userId,
            status: "active",
          },
        },
      },
      {
        spaceId: null,
        company: {
          members: {
            some: {
              userId: input.userId,
              status: "active",
              role: {
                in: ["owner", "admin"],
              },
            },
          },
        },
      },
    ],
  };
  const filters: Prisma.ProjectWhereInput[] = [];

  if (input.companyId) {
    filters.push({
      OR: [
        { space: { companyId: input.companyId } },
        { spaceId: null, companyId: input.companyId },
      ],
    });
  }

  if (input.ownerType === "personal") {
    filters.push({
      OR: [
        { space: { type: "personal" } },
        { spaceId: null, ownerType: "personal" },
      ],
    });
  } else if (input.ownerType === "company") {
    filters.push({
      OR: [
        { space: { type: "company" } },
        { spaceId: null, ownerType: "company" },
      ],
    });
  }

  return filters.length > 0
    ? {
        AND: [...filters, accessWhere],
      }
    : accessWhere;
}

function resolveAccessControlDb(db?: Partial<AccessControlDb>): AccessControlDb {
  return (db ?? prisma) as AccessControlDb;
}

function resolveProjectListDb(db?: ProjectListDb): ProjectListDb {
  return (db ?? prisma) as ProjectListDb;
}

export async function assertCanReadProject(input: {
  userId: string;
  projectId: string;
  db?: Partial<AccessControlDb>;
}): Promise<ProjectAccess> {
  const db = resolveAccessControlDb(input.db);
  const project = await db.project.findUnique({
    where: {
      id: input.projectId,
    },
    select: {
      id: true,
      visibility: true,
      spaceId: true,
      ownerType: true,
      companyId: true,
      ownerUserId: true,
      space: {
        select: {
          id: true,
          type: true,
          ownerUserId: true,
          companyId: true,
          name: true,
          status: true,
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  if (project.spaceId) {
    if (!project.space || project.space.id !== project.spaceId) {
      throw new Error("Invalid project space");
    }

    assertValidSpaceOwner(project.space);

    if (project.space.status !== "active") {
      throw new Error("Project access denied");
    }

    if (project.space.type === "personal") {
      if (project.space.ownerUserId === input.userId) {
        return {
          projectId: project.id,
          role: "owner",
        };
      }

      const projectMembership = await db.projectMember.findFirst({
        where: {
          projectId: project.id,
          userId: input.userId,
          status: "active",
        },
        select: {
          role: true,
          status: true,
        },
      });

      if (!projectMembership) {
        throw new Error("Project access denied");
      }

      return {
        projectId: project.id,
        role: projectMembership.role,
      };
    }

    const companyMembership = await db.companyMember.findFirst({
      where: {
        companyId: project.space.companyId,
        userId: input.userId,
        status: "active",
      },
      select: {
        role: true,
        status: true,
      },
    });

    if (!companyMembership || companyMembership.status !== "active") {
      throw new Error("Project access denied");
    }

    if (COMPANY_ADMIN_ROLES.has(companyMembership.role)) {
      return {
        projectId: project.id,
        role: "maintainer",
      };
    }

    const projectMembership = await db.projectMember.findFirst({
      where: {
        projectId: project.id,
        userId: input.userId,
        status: "active",
      },
      select: {
        role: true,
        status: true,
      },
    });

    if (companyMembership.role === "viewer") {
      if (!projectMembership && project.visibility !== "space") {
        throw new Error("Project access denied");
      }

      return {
        projectId: project.id,
        role: "viewer",
      };
    }

    if (companyMembership.role === "member" && projectMembership) {
      return {
        projectId: project.id,
        role: projectMembership.role,
      };
    }

    throw new Error("Project access denied");
  }

  if (project.ownerType === "personal" && project.ownerUserId === input.userId) {
    return {
      projectId: project.id,
      role: "owner",
    };
  }

  const projectMembership = await db.projectMember.findFirst({
    where: {
      projectId: project.id,
      userId: input.userId,
      status: "active",
    },
    select: {
      role: true,
      status: true,
    },
  });

  if (projectMembership) {
    return {
      projectId: project.id,
      role: projectMembership.role,
    };
  }

  if (project.companyId) {
    const companyMembership = await db.companyMember.findFirst({
      where: {
        companyId: project.companyId,
        userId: input.userId,
        status: "active",
      },
      select: {
        role: true,
        status: true,
      },
    });

    if (companyMembership && COMPANY_ADMIN_ROLES.has(companyMembership.role)) {
      return {
        projectId: project.id,
        role: "maintainer",
      };
    }
  }

  throw new Error("Project access denied");
}

export async function assertCanWriteProject(input: {
  userId: string;
  projectId: string;
  db?: Partial<AccessControlDb>;
}): Promise<ProjectAccess> {
  const access = await assertCanReadProject(input);

  if (!PROJECT_WRITE_ROLES.has(access.role)) {
    throw new Error("Project write access denied");
  }

  return access;
}

async function resolveDocumentTarget(input: {
  documentId: string;
  db?: DocumentAccessDb;
}) {
  const db = input.db ?? (prisma as unknown as DocumentAccessDb);
  const document = await db.document.findUnique({
    where: { id: input.documentId },
    select: {
      id: true,
      spaceId: true,
      projectId: true,
      directoryId: true,
      project: {
        select: { id: true, spaceId: true },
      },
    },
  });

  if (!document) {
    throw new Error("Document not found");
  }

  if (!document.spaceId) {
    throw new Error("Document has no space");
  }

  if (document.projectId) {
    if (!document.project || document.project.spaceId !== document.spaceId) {
      throw new Error("Document project belongs to another space");
    }
  }

  return {
    ...document,
    spaceId: document.spaceId,
  } as typeof document & { spaceId: string };
}

async function applyDocumentGrant(input: { userId: string; document: { id: string; spaceId: string; projectId: string | null; directoryId?: string | null }; base: DocumentPermission; db: DocumentAccessDb }) {
  const db = input.db;
  if (!db.documentPermission) return { permission: input.base, hasGrant: false };
  const userDigest = createMd5(input.userId);
  const targetDigests = [createMd5(input.document.id)];
  if (input.document.directoryId && db.documentDirectory) {
    let current: { id: string; parentId: string | null; spaceId: string } | null = await db.documentDirectory.findUnique({ where: { id: input.document.directoryId }, select: { id: true, parentId: true, spaceId: true } });
    while (current) {
      targetDigests.push(createMd5(current.id));
      current = current.parentId ? await db.documentDirectory.findUnique({ where: { id: current.parentId }, select: { id: true, parentId: true, spaceId: true } }) : null;
    }
  }
  const grants = await db.documentPermission.findMany({ where: { spaceDigest: createMd5(input.document.spaceId), userDigest, revokedAt: null, OR: [{ documentDigest: { in: targetDigests } }, { directoryDigest: { in: targetDigests } }] } });
  const relevant = grants.filter((grant) => grant.permission && isPermissionValue(grant.permission));
  return { permission: effectiveDocumentPermission({ base: input.base, inherited: relevant.map((grant) => grant.permission as DocumentPermission) }), hasGrant: relevant.length > 0 };
}

function createMd5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

function isPermissionValue(value: string): value is DocumentPermission {
  return value === "read" || value === "edit" || value === "manage";
}

export async function assertCanReadDocument(input: {
  userId: string;
  documentId: string;
  db?: DocumentAccessDb;
  dependencies?: Partial<DocumentAccessDependencies>;
}): Promise<DocumentAccess> {
  const dependencies = {
    assertCanReadSpace,
    assertCanWriteSpace,
    assertCanReadProject,
    assertCanWriteProject,
    ...input.dependencies,
  };
  const document = await resolveDocumentTarget(input);
  const db = (input.db ?? prisma) as DocumentAccessDb;
  // A document or one of its parent folders may grant access even when the
  // user is not a member of the containing project. Check that grant first.
  const access = document.projectId
    ? await dependencies.assertCanReadProject({ userId: input.userId, projectId: document.projectId }).catch(() => null)
    : await dependencies.assertCanReadSpace({ userId: input.userId, spaceId: document.spaceId }).catch(() => null);
  const grant = await applyDocumentGrant({ userId: input.userId, document, base: access ? (access.role === "viewer" ? "read" : "edit") : "read", db });
  if (!access && !grant.hasGrant) throw new Error("Document access denied");
  if (!access) return { documentId: document.id, role: grant.permission === "read" ? "viewer" : "maintainer" };

  const permission = await applyDocumentGrant({ userId: input.userId, document, base: access.role === "viewer" ? "read" : "edit", db });
  return { documentId: document.id, role: access.role };
}

export async function assertCanWriteDocument(input: {
  userId: string;
  documentId: string;
  db?: DocumentAccessDb;
  dependencies?: Partial<DocumentAccessDependencies>;
}): Promise<DocumentAccess> {
  const dependencies = {
    assertCanReadSpace,
    assertCanWriteSpace,
    assertCanReadProject,
    assertCanWriteProject,
    ...input.dependencies,
  };
  const document = await resolveDocumentTarget(input);
  const db = (input.db ?? prisma) as DocumentAccessDb;
  const access = document.projectId
    ? await dependencies.assertCanWriteProject({ userId: input.userId, projectId: document.projectId }).catch(() => null)
    : await dependencies.assertCanWriteSpace({ userId: input.userId, spaceId: document.spaceId }).catch(() => null);
  const grant = await applyDocumentGrant({ userId: input.userId, document, base: access ? (access.role === "viewer" ? "read" : "edit") : "read", db });
  if (!access && grant.permission === "read") throw new Error("Document write access denied");
  if (!access) return { documentId: document.id, role: grant.permission === "manage" ? "owner" : "maintainer" };

  const permission = await applyDocumentGrant({ userId: input.userId, document, base: access.role === "viewer" ? "read" : "edit", db });
  if (permission.permission === "read") throw new Error("Document write access denied");
  return { documentId: document.id, role: access.role };
}

export async function listAccessibleProjects(input: {
  userId: string;
  companyId?: string;
  db?: ProjectListDb;
}): Promise<unknown[]> {
  const db = resolveProjectListDb(input.db);
  const where = buildAccessibleProjectWhere(input);

  return db.project.findMany({
    where,
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        name: "asc",
      },
    ],
  });
}
