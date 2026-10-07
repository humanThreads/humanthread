import { prisma } from "../../../../../packages/db/src/index";

export interface WorkbenchWorkflowDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  currentStepKey: string;
  createdAt: Date;
  updatedAt: Date;
  project: {
    id: string;
    name: string;
    localPath: string | null;
    defaultCommand: string | null;
  };
  matterType: {
    id: string;
    name: string;
  };
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    queuePosition: number;
    stepTemplateId: string;
    updatedAt: Date;
    assignee: {
      id: string;
      name: string;
    } | null;
  }>;
}

type WorkflowDetailRow = WorkbenchWorkflowDetail;

export interface GetWorkbenchWorkflowDetailInput {
  workflowId: string;
  db?: {
    workflowInstance: {
      findUnique: typeof prisma.workflowInstance.findUnique;
    };
  };
}

export async function getWorkbenchWorkflowDetail(
  input: GetWorkbenchWorkflowDetailInput,
): Promise<WorkbenchWorkflowDetail | null> {
  const db = input.db ?? prisma;
  const workflow = (await db.workflowInstance.findUnique({
    where: {
      id: input.workflowId,
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      currentStepKey: true,
      createdAt: true,
      updatedAt: true,
      project: {
        select: {
          id: true,
          name: true,
          localPath: true,
          defaultCommand: true,
        },
      },
      matterType: {
        select: {
          id: true,
          name: true,
        },
      },
      tasks: {
        orderBy: [
          {
            queuePosition: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
        select: {
          id: true,
          title: true,
          status: true,
          queuePosition: true,
          stepTemplateId: true,
          updatedAt: true,
          assignee: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  })) as WorkflowDetailRow | null;

  return workflow;
}
