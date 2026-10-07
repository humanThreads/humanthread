import type { Prisma } from "@prisma/client";
import {
  buildAccessibleTaskWhere,
  prisma,
} from "../../../../../packages/db/src/index";

export interface WorkbenchSearchProjectItem {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
}

export interface WorkbenchSearchDocumentItem {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  path: string;
  version: number;
  updatedAt: Date;
}

export interface WorkbenchSearchTaskItem {
  id: string;
  projectId: string | null;
  projectName: string;
  title: string;
  status: string;
  updatedAt: Date;
  assigneeName: string | null;
  workflowTitle?: string;
  href: string;
}

export interface WorkbenchSearchMemberItem {
  id: string;
  name: string;
  email: string | null;
  status: string;
  lastSeenAt: Date | null;
}

export interface WorkbenchSearchResult {
  query: string;
  projects: WorkbenchSearchProjectItem[];
  documents: WorkbenchSearchDocumentItem[];
  tasks: WorkbenchSearchTaskItem[];
  members: WorkbenchSearchMemberItem[];
}

function normalizeWorkbenchSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function matchesWorkbenchSearchValue(haystack: string, query: string) {
  return normalizeWorkbenchSearchValue(haystack).includes(query);
}

export function filterWorkbenchSearchResults(input: {
  query: string;
  projects: WorkbenchSearchProjectItem[];
  documents: WorkbenchSearchDocumentItem[];
  tasks: WorkbenchSearchTaskItem[];
  members: WorkbenchSearchMemberItem[];
}): WorkbenchSearchResult {
  const query = normalizeWorkbenchSearchValue(input.query);

  if (!query) {
    return {
      query,
      projects: input.projects,
      documents: input.documents,
      tasks: input.tasks,
      members: input.members,
    };
  }

  return {
    query,
    projects: input.projects.filter((project) =>
      [
        project.name,
        project.description ?? "",
      ].some((value) => matchesWorkbenchSearchValue(value, query)),
    ),
    documents: input.documents.filter((document) =>
      [
        document.title,
        document.path,
        document.projectName,
      ].some((value) => matchesWorkbenchSearchValue(value, query)),
    ),
    tasks: input.tasks.filter((task) =>
      [
        task.title,
        task.projectName,
        task.assigneeName ?? "",
        task.status,
      ].some((value) => matchesWorkbenchSearchValue(value, query)),
    ),
    members: input.members.filter((member) =>
      [
        member.name,
        member.email ?? "",
        member.status,
      ].some((value) => matchesWorkbenchSearchValue(value, query)),
    ),
  };
}

interface WorkbenchTaskSearchDb {
  task: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      title: string;
      statusCategory: string | null;
      updatedAt: Date;
      assignee: { name: string } | null;
      project: { id: string; name: string } | null;
    }>>;
  };
}

export async function searchWorkbenchTasks(input: {
  userId: string;
  query: string;
  spaceId?: string;
  take?: number;
  db?: WorkbenchTaskSearchDb;
}): Promise<WorkbenchSearchTaskItem[]> {
  const db = input.db ?? (prisma as unknown as WorkbenchTaskSearchDb);
  const query = input.query.trim();
  if (!query) return [];
  const textFilter: Prisma.TaskWhereInput = {
    OR: [
      { title: { contains: query } },
      { contentMarkdown: { contains: query } },
    ],
  };
  const rows = await db.task.findMany({
    where: {
      AND: [
        buildAccessibleTaskWhere({
          userId: input.userId,
          ...(input.spaceId ? { spaceId: input.spaceId } : {}),
        }),
        textFilter,
      ],
    },
    select: {
      id: true,
      title: true,
      statusCategory: true,
      updatedAt: true,
      assignee: { select: { name: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: input.take ?? 50,
  });
  return rows.map((task) => ({
    id: task.id,
    projectId: task.project?.id ?? null,
    projectName: task.project?.name ?? "无项目",
    title: task.title,
    status: task.statusCategory ?? "todo",
    updatedAt: task.updatedAt,
    assigneeName: task.assignee?.name ?? null,
    href: `/tasks/${task.id}`,
  }));
}
