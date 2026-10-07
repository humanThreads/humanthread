import { prisma } from "../../../../../packages/db/src/index";

export interface WorkbenchProjectTaskSummary {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  updatedAt: Date;
  assigneeName: string | null;
  workflowTitle: string;
}

interface ProjectTaskRow {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
  project: {
    id: string;
    name: string;
  };
  assignee: {
    name: string;
  } | null;
  workflowInstance: {
    title: string;
  };
}

export async function listRecentTasksForProjects(input: {
  projectIds: string[];
  db?: {
    task: {
      findMany: typeof prisma.task.findMany;
    };
  };
}): Promise<WorkbenchProjectTaskSummary[]> {
  if (input.projectIds.length === 0) {
    return [];
  }

  const db = input.db ?? prisma;
  const tasks = (await db.task.findMany({
    where: {
      projectId: {
        in: input.projectIds,
      },
    },
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    take: 16,
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      assignee: {
        select: {
          name: true,
        },
      },
      workflowInstance: {
        select: {
          title: true,
        },
      },
    },
  })) as ProjectTaskRow[];

  return tasks.map((task) => ({
    id: task.id,
    projectId: task.project.id,
    projectName: task.project.name,
    title: task.title,
    status: task.status,
    updatedAt: task.updatedAt,
    assigneeName: task.assignee?.name ?? null,
    workflowTitle: task.workflowInstance.title,
  }));
}
