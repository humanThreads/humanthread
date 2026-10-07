import { prisma } from "./prisma";

export type SpaceRole = "owner" | "admin" | "member" | "viewer";

export interface SpaceAccess {
  spaceId: string;
  role: SpaceRole;
}

export interface AccessibleSpace {
  id: string;
  type: "personal" | "company";
  name: string;
  role: SpaceRole;
  ownerUserId: string | null;
  companyId: string | null;
}

export interface SpaceRow {
  id: string;
  type: string;
  ownerUserId: string | null;
  companyId: string | null;
  name: string;
  status: string;
}

type SpaceProvisionDb = {
  space: {
    upsert(input: unknown): Promise<{ id: string }>;
  };
};

type SpaceAccessDb = {
  space: {
    findUnique(input: unknown): Promise<SpaceRow | null>;
  };
  companyMember: {
    findFirst(input: unknown): Promise<{ role: string; status: string } | null>;
  };
};

type SpaceListRow = SpaceRow & {
  company?: {
    members: Array<{ role: string; status: string }>;
  } | null;
};

type SpaceListDb = {
  space: {
    findMany(input: unknown): Promise<SpaceListRow[]>;
  };
};

const COMPANY_ROLES = new Set<SpaceRole>([
  "owner",
  "admin",
  "member",
  "viewer",
]);
const SPACE_WRITE_ROLES = new Set<SpaceRole>(["owner", "admin", "member"]);

export function buildPersonalSpaceId(userId: string): string {
  return `space:personal:${userId}`;
}

export function buildCompanySpaceId(companyId: string): string {
  return `space:company:${companyId}`;
}

export async function provisionPersonalSpace(input: {
  userId: string;
  name: string;
  db?: SpaceProvisionDb;
}): Promise<{ id: string }> {
  const db = input.db ?? (prisma as unknown as SpaceProvisionDb);
  const name = input.name.trim();

  if (!name) {
    throw new Error("Space name is required");
  }

  return db.space.upsert({
    where: { ownerUserId: input.userId },
    update: { name, status: "active" },
    create: {
      id: buildPersonalSpaceId(input.userId),
      type: "personal",
      ownerUserId: input.userId,
      companyId: null,
      name,
      status: "active",
    },
    select: { id: true },
  });
}

export async function provisionCompanySpace(input: {
  companyId: string;
  name: string;
  db?: SpaceProvisionDb;
}): Promise<{ id: string }> {
  const db = input.db ?? (prisma as unknown as SpaceProvisionDb);
  const name = input.name.trim();

  if (!name) {
    throw new Error("Space name is required");
  }

  return db.space.upsert({
    where: { companyId: input.companyId },
    update: { name, status: "active" },
    create: {
      id: buildCompanySpaceId(input.companyId),
      type: "company",
      ownerUserId: null,
      companyId: input.companyId,
      name,
      status: "active",
    },
    select: { id: true },
  });
}

export function assertValidSpaceOwner<T extends SpaceRow>(
  space: T,
): asserts space is T & { type: "personal" | "company" } {
  const isPersonal =
    space.type === "personal" && Boolean(space.ownerUserId) && !space.companyId;
  const isCompany =
    space.type === "company" && Boolean(space.companyId) && !space.ownerUserId;

  if (!isPersonal && !isCompany) {
    throw new Error("Invalid space ownership");
  }
}

function resolveCompanyRole(role: string): SpaceRole {
  if (!COMPANY_ROLES.has(role as SpaceRole)) {
    throw new Error("Invalid company membership role");
  }

  return role as SpaceRole;
}

async function resolveSpaceAccess(input: {
  userId: string;
  spaceId: string;
  db?: Partial<SpaceAccessDb>;
}): Promise<SpaceAccess> {
  const db = (input.db ?? prisma) as SpaceAccessDb;
  const space = await db.space.findUnique({
    where: { id: input.spaceId },
    select: {
      id: true,
      type: true,
      ownerUserId: true,
      companyId: true,
      name: true,
      status: true,
    },
  });

  if (!space) {
    throw new Error("Space not found");
  }

  assertValidSpaceOwner(space);

  if (space.status !== "active") {
    throw new Error("Space access denied");
  }

  if (space.type === "personal") {
    if (space.ownerUserId !== input.userId) {
      throw new Error("Space access denied");
    }

    return { spaceId: space.id, role: "owner" };
  }

  const membership = await db.companyMember.findFirst({
    where: {
      companyId: space.companyId,
      userId: input.userId,
      status: "active",
    },
    select: { role: true, status: true },
  });

  if (!membership || membership.status !== "active") {
    throw new Error("Space access denied");
  }

  return {
    spaceId: space.id,
    role: resolveCompanyRole(membership.role),
  };
}

export function assertCanReadSpace(input: {
  userId: string;
  spaceId: string;
  db?: Partial<SpaceAccessDb>;
}): Promise<SpaceAccess> {
  return resolveSpaceAccess(input);
}

export async function assertCanWriteSpace(input: {
  userId: string;
  spaceId: string;
  db?: Partial<SpaceAccessDb>;
}): Promise<SpaceAccess> {
  const access = await resolveSpaceAccess(input);

  if (!SPACE_WRITE_ROLES.has(access.role)) {
    throw new Error("Space write access denied");
  }

  return access;
}

export async function listAccessibleSpaces(input: {
  userId: string;
  db?: SpaceListDb;
}): Promise<AccessibleSpace[]> {
  const db = input.db ?? (prisma as unknown as SpaceListDb);
  const spaces = await db.space.findMany({
    where: {
      status: "active",
      OR: [
        { type: "personal", ownerUserId: input.userId },
        {
          type: "company",
          company: {
            members: {
              some: { userId: input.userId, status: "active" },
            },
          },
        },
      ],
    },
    orderBy: [{ type: "desc" }, { name: "asc" }],
    select: {
      id: true,
      type: true,
      ownerUserId: true,
      companyId: true,
      name: true,
      status: true,
      company: {
        select: {
          members: {
            where: { userId: input.userId, status: "active" },
            select: { role: true, status: true },
            take: 1,
          },
        },
      },
    },
  });

  return spaces.map((space) => {
    assertValidSpaceOwner(space);

    if (space.type === "personal") {
      if (space.ownerUserId !== input.userId) {
        throw new Error("Space access denied");
      }

      return {
        id: space.id,
        type: "personal",
        name: space.name,
        role: "owner",
        ownerUserId: space.ownerUserId,
        companyId: null,
      };
    }

    const membership = space.company?.members[0];

    if (!membership || membership.status !== "active") {
      throw new Error("Space access denied");
    }

    return {
      id: space.id,
      type: "company",
      name: space.name,
      role: resolveCompanyRole(membership.role),
      ownerUserId: null,
      companyId: space.companyId,
    };
  });
}
