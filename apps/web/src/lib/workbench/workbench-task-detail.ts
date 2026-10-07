import {
  buildAccessibleProjectWhere,
  prisma,
} from "../../../../../packages/db/src/index";
import { recordLegacyTaskUsage } from "../tasks/task-rollout";

export interface WorkbenchTaskDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  queuePosition: number;
  stepTemplateId: string;
  updatedAt: Date;
  workflow: {
    id: string;
    title: string;
    status: string;
    currentStepKey: string;
  };
  project: {
    id: string;
    name: string;
    localPath: string | null;
    defaultCommand: string | null;
  };
  assignee: {
    id: string;
    name: string;
    email: string | null;
  } | null;
}

type TaskDetailRow = WorkbenchTaskDetail;

export interface GetWorkbenchTaskDetailInput {
  taskId: string;
  userId: string;
  db?: {
    task: {
      findFirst: typeof prisma.task.findFirst;
    };
  };
}

export async function getWorkbenchTaskDetail(
  input: GetWorkbenchTaskDetailInput,
): Promise<WorkbenchTaskDetail | null> {
  recordLegacyTaskUsage({
    kind: "read",
    surface: "workbench-task-detail",
    taskId: input.taskId,
  });
  const db = input.db ?? prisma;

  return (await db.task.findFirst({
    where: {
      id: input.taskId,
      project: buildAccessibleProjectWhere({ userId: input.userId }),
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      queuePosition: true,
      stepTemplateId: true,
      updatedAt: true,
      workflowInstance: {
        select: {
          id: true,
          title: true,
          status: true,
          currentStepKey: true,
        },
      },
      project: {
        select: {
          id: true,
          name: true,
          localPath: true,
          defaultCommand: true,
        },
      },
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })) as TaskDetailRow | null;
}
