import type { Prisma } from "@prisma/client";
import { buildAccessibleProjectWhere, prisma } from "../../../../../packages/db/src/index";

export interface ProjectMemberView {
  project: { id: string; name: string };
  members: Array<{
    id: string;
    role: string;
    joinedAt: Date;
    user: { id: string; name: string; email: string | null; lastSeenAt: Date | null };
  }>;
}

export async function getProjectMemberView(input: {
  projectId: string;
  userId: string;
  db?: { project: { findFirst: typeof prisma.project.findFirst } };
}): Promise<ProjectMemberView | null> {
  const db = input.db ?? prisma;
  const project = await db.project.findFirst({
    where: {
      id: input.projectId,
      AND: [buildAccessibleProjectWhere({ userId: input.userId }) as Prisma.ProjectWhereInput],
    },
    select: {
      id: true,
      name: true,
      members: {
        where: { status: "active" },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, lastSeenAt: true } },
        },
      },
    },
  });
  if (!project) return null;
  return {
    project: { id: project.id, name: project.name },
    members: project.members.map((member) => ({
      id: member.id,
      role: member.role,
      joinedAt: member.createdAt,
      user: member.user,
    })),
  };
}
