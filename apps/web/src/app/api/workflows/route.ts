import { NextRequest, NextResponse } from "next/server";
import {
  createWorkflowInstanceRecordsWithPrisma,
  prisma,
} from "@humanthread/db";
import { getWorkflowTemplateByMatterType } from "@/lib/templates/matter-templates";
import { createWorkflowFromTemplate } from "@/lib/workflows/create-workflow-from-template";

interface CreateWorkflowRequestBody {
  teamId: string;
  projectId: string;
  matterTypeId: string;
  title: string;
  description?: string;
  createdById: string;
}

function createWorkflowId(): string {
  return `workflow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateWorkflowRequestBody;

  if (
    !body.teamId ||
    !body.projectId ||
    !body.matterTypeId ||
    !body.title ||
    !body.createdById
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing required fields",
      },
      { status: 400 },
    );
  }

  try {
    const template = getWorkflowTemplateByMatterType(body.matterTypeId);
    const result = await createWorkflowFromTemplate(
      {
        teamId: body.teamId,
        projectId: body.projectId,
        matterTypeId: body.matterTypeId,
        title: body.title,
        description: body.description ?? "",
        createdById: body.createdById,
        template,
        now: new Date(),
      },
      {
        createId: createWorkflowId,
        persist: async ({ teamId, result }) => {
          await createWorkflowInstanceRecordsWithPrisma({
            prisma,
            teamId,
            result,
          });
        },
      },
    );

    return NextResponse.json({
      ok: true,
      workflow: result.workflow,
      tasks: result.tasks,
      events: result.events,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown workflow creation error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 },
    );
  }
}
