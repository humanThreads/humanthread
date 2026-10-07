import { NextResponse } from "next/server";
import { assertCanWriteProject, prisma } from "@humanthread/db";
import { buildProjectExecutionOptions } from "../../../../../../lib/orchestration/execution-options";
import { milestoneTaskSkipReason } from "../../../../../../lib/orchestration/milestone-batch-loop";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export async function GET(request: Request, context: { params: Promise<{ milestoneId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { milestoneId } = await context.params;
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: {
        id: true,
        name: true,
        projectId: true,
        tasks: { select: { id: true, title: true, statusCategory: true, archivedAt: true } },
        project: {
          select: {
            spaceId: true,
            workerPool: {
              select: {
                id: true, displayName: true, status: true, revokedAt: true, maxConcurrentRuns: true,
                sessions: {
                  where: { status: "active", revokedAt: null, expiresAt: { gt: new Date() } },
                  select: {
                    requestedConcurrency: true,
                    lastSeenAt: true,
                    linuxRuns: {
                      where: { status: { in: ["claimed", "starting", "running", "waiting_approval"] } },
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!milestone) return NextResponse.json({ ok: false, error: "里程碑不存在" }, { status: 404 });
    await assertCanWriteProject({ userId: actor.userId, projectId: milestone.projectId });
    const binding = await prisma.projectLoopBinding.findFirst({
      where: {
        projectId: milestone.projectId,
        bindingRole: "task_development",
        status: "enabled",
        loopDefinition: { scope: "project" },
      },
      select: { allowedAgentProfileIds: true, allowedProviders: true, workerStageConfigurations: true },
    });
    const allowedProfiles = binding && Array.isArray(binding.allowedAgentProfileIds)
      ? binding.allowedAgentProfileIds.filter((id): id is string => typeof id === "string")
      : [];
    const spaceId = milestone.project.spaceId;
    const profiles = allowedProfiles.length === 0 || !spaceId ? [] : await prisma.agentProfile.findMany({
      where: { id: { in: allowedProfiles }, spaceId, status: "active" },
      select: { id: true, name: true, provider: true },
      orderBy: { name: "asc" },
    });
    const { options, defaultTarget } = buildProjectExecutionOptions({
      binding,
      workerPool: milestone.project.workerPool,
      agentProfiles: profiles,
    });
    const tasks = milestone.tasks.map((task) => {
      const reason = milestoneTaskSkipReason({ ...task, hasLoopBinding: Boolean(binding) });
      return { id: task.id, title: task.title, eligible: !reason, reason };
    });
    return NextResponse.json({ ok: true, milestone: { id: milestone.id, name: milestone.name }, tasks, options, defaultTarget });
  } catch (error) {
    const message = error instanceof Error ? error.message : "里程碑 Loop 选项加载失败";
    const status = message === "Workbench API authentication required" ? 401 : message.includes("access denied") ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
