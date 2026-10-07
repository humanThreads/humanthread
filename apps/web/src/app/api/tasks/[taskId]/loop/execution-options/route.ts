import { NextResponse } from "next/server";
import { assertCanDispatchTaskAgent, prisma } from "@humanthread/db";
import { projectLoopGroupConfigSchema } from "@humanthread/shared";
import { buildProjectExecutionOptions } from "../../../../../../lib/orchestration/execution-options";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    await assertCanDispatchTaskAgent({ userId: actor.userId, taskId });
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        project: {
          select: {
            id: true,
            spaceId: true,
            loopGroupConfig: true,
            workerPool: {
              select: {
                id: true, displayName: true, status: true, revokedAt: true, maxConcurrentRuns: true,
                sessions: {
                  where: { status: "active", revokedAt: null, expiresAt: { gt: new Date() } },
                  select: {
                    requestedConcurrency: true,
                    lastSeenAt: true,
                    linuxRuns: { where: { status: { in: ["claimed", "starting", "running", "waiting_approval"] } }, select: { id: true } },
                  },
                },
              },
            },
            loopBindings: {
              where: { status: "enabled", loopDefinition: { scope: "project" } },
              select: {
                id: true,
                loopDefinitionId: true,
                activeVersionId: true,
                bindingRole: true,
                allowedAgentProfileIds: true,
                allowedProviders: true,
                workerStageConfigurations: true,
                loopDefinition: { select: { name: true, description: true } },
                activeVersion: { select: { versionNumber: true } },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
    const project = task?.project;
    if (!project?.spaceId) return NextResponse.json({ ok: false, error: "Task project is not configured" }, { status: 404 });

    const parsedLoopGroup = projectLoopGroupConfigSchema.safeParse(project.loopGroupConfig);
    const configuredOrder = parsedLoopGroup.success
      ? new Map(parsedLoopGroup.data.projectLoopVersionIds.map((id, index) => [id, index]))
      : null;
    const selectableBindings = project.loopBindings
      .filter((candidate) => candidate.bindingRole !== "milestone_release")
      .filter((candidate) => configuredOrder
        ? configuredOrder.has(candidate.activeVersionId)
        : candidate.bindingRole === "task_development")
      .sort((left, right) => {
        if (left.activeVersionId === right.activeVersionId) {
          return Number(right.bindingRole === "task_development") - Number(left.bindingRole === "task_development");
        }
        if (!configuredOrder) return left.activeVersionId.localeCompare(right.activeVersionId);
        return (configuredOrder.get(left.activeVersionId) ?? Number.MAX_SAFE_INTEGER)
          - (configuredOrder.get(right.activeVersionId) ?? Number.MAX_SAFE_INTEGER);
      })
      .filter((candidate, index, values) => values.findIndex((value) => value.activeVersionId === candidate.activeVersionId) === index);
    if (selectableBindings.length === 0) {
      return NextResponse.json({ ok: false, error: "No selectable Project task Loop is configured" }, { status: 404 });
    }

    const allowedProfileIds = [...new Set(selectableBindings.flatMap((candidate) => (
      Array.isArray(candidate.allowedAgentProfileIds)
        ? candidate.allowedAgentProfileIds.filter((id): id is string => typeof id === "string")
        : []
    )))];
    const profiles = allowedProfileIds.length === 0 ? [] : await prisma.agentProfile.findMany({
      where: { id: { in: allowedProfileIds }, spaceId: project.spaceId, status: "active" },
      select: { id: true, name: true, provider: true },
      orderBy: { name: "asc" },
    });
    const defaultBindingId = parsedLoopGroup.success
      ? selectableBindings.find((candidate) => candidate.activeVersionId === parsedLoopGroup.data.defaultTaskLoopVersionId)?.id ?? null
      : null;
    const requestedBindingId = new URL(request.url).searchParams.get("bindingId");
    const selectedBinding = requestedBindingId
      ? selectableBindings.find((candidate) => candidate.id === requestedBindingId)
      : selectableBindings.find((candidate) => candidate.id === defaultBindingId)
        ?? selectableBindings.find((candidate) => buildProjectExecutionOptions({ binding: candidate, workerPool: project.workerPool, agentProfiles: profiles }).options.some((option) => option.ready))
        ?? selectableBindings[0];
    if (!selectedBinding) {
      return NextResponse.json({ ok: false, error: "Selected Project task Loop is unavailable" }, { status: 400 });
    }

    const loops = selectableBindings
      .map((candidate) => {
        const selectedOptions = buildProjectExecutionOptions({ binding: candidate, workerPool: project.workerPool, agentProfiles: profiles });
        const unavailableTarget = selectedOptions.options.find((option) => !option.ready);
        return {
          bindingId: candidate.id,
          loopDefinitionId: candidate.loopDefinitionId,
          loopVersionId: candidate.activeVersionId,
          name: candidate.loopDefinition.name,
          description: candidate.loopDefinition.description,
          versionNumber: candidate.activeVersion.versionNumber,
          isDefault: candidate.id === defaultBindingId,
          ready: selectedOptions.options.some((option) => option.ready),
          reason: selectedOptions.options.some((option) => option.ready) ? null : unavailableTarget?.reason ?? "没有可用的执行目标",
        };
      })
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
    const { options, defaultTarget } = buildProjectExecutionOptions({
      binding: selectedBinding,
      workerPool: project.workerPool,
      agentProfiles: profiles,
    });
    return NextResponse.json({ ok: true, loops, selectedBindingId: selectedBinding.id, options, defaultTarget });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution options unavailable";
    const status = message === "Workbench API authentication required" ? 401 : message.includes("access denied") ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
