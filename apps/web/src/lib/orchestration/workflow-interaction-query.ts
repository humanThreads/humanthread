import { assertCanReadProject, listLoopRunInteractions, prisma, recoverLegacyLoopIntervention } from "@humanthread/db";
import type { WorkflowInteractionView } from "@humanthread/shared";
import { workflowSpeakerKey } from "../../../../../packages/db/src/workflow-interaction-discussion";

export async function readAuthorizedLoopRunInteractions(input: {
  userId: string;
  loopRunId: string;
}): Promise<{ interactions: WorkflowInteractionView[]; capabilities: InteractionCapabilities; currentUserId: string }> {
  const run = await prisma.loopRun.findFirst({
    where: { id: input.loopRunId, engineKind: "graph_v1" },
    select: { projectId: true },
  });
  if (!run?.projectId) throw Object.assign(new Error("Graph LoopRun not found"), { code: "not_found" as const });
  const access = await assertCanReadProject({ userId: input.userId, projectId: run.projectId });
  const role = access && typeof access === "object" && "role" in access ? String(access.role) : "viewer";
  const canWrite = ["owner", "maintainer", "contributor"].includes(role);
  const canGovern = ["owner", "maintainer"].includes(role);
  await recoverLegacyLoopIntervention({
    loopRunId: input.loopRunId,
    occurredAt: new Date(),
    correlationId: `loop:${input.loopRunId}:legacy-recovery`,
    actor: { type: "system", id: "legacy-loop-recovery" },
  });
  const [project, tasks] = await Promise.all([
    prisma.project.findUnique({ where: { id: run.projectId }, select: { managerUserId: true } }),
    prisma.task.findMany({
      where: { loopRuns: { some: { id: input.loopRunId } } },
      select: {
        id: true,
        assigneeUserId: true,
        createdById: true,
        createdBy: { select: { name: true } },
        assignee: { select: { name: true } },
        members: { select: { userId: true, user: { select: { name: true } } } },
      },
    }),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const interactions = await listLoopRunInteractions({ loopRunId: input.loopRunId });
  return {
    interactions: interactions.map((interaction) => {
      const task = interaction.taskId ? taskById.get(interaction.taskId) : undefined;
      const candidates = task ? [
        { userId: task.createdById, displayName: task.createdBy.name },
        ...(task.assigneeUserId ? [{ userId: task.assigneeUserId, displayName: task.assignee?.name ?? task.assigneeUserId }] : []),
        ...task.members.map((member) => ({ userId: member.userId, displayName: member.user.name })),
      ].filter((candidate, index, values) => values.findIndex((entry) => entry.userId === candidate.userId) === index) : [];
      return {
        ...interaction,
        capabilities: deriveInteractionCapabilities({
          interaction,
          userId: input.userId,
          projectRole: role,
          projectManagerUserId: project?.managerUserId ?? null,
          taskAssigneeUserId: task?.assigneeUserId ?? null,
          taskParticipantCandidates: candidates,
          canWrite,
        }),
      };
    }),
    capabilities: {
      canReply: canWrite,
      canConfirm: canGovern,
      canDecideApproval: canGovern,
      canExport: true,
      supportsInteractions: true,
    },
    currentUserId: input.userId,
  };
}

export interface InteractionCapabilityProjectionInput {
  interaction: WorkflowInteractionView;
  userId: string;
  projectRole: string;
  projectManagerUserId: string | null;
  taskAssigneeUserId: string | null;
  taskParticipantCandidates: Array<{ userId: string; displayName: string | null }>;
  canWrite?: boolean;
}

export function deriveInteractionCapabilities(input: InteractionCapabilityProjectionInput) {
  const state = input.interaction.discussionState ?? {
    phase: "ordinary" as const,
    activeSpeakerKey: null,
    speakers: [],
    conflicts: [],
    missingConfirmationCount: 0,
    allSpeakersConfirmed: true,
  };
  const phase = state?.phase ?? "ordinary";
  const speakers = state?.speakers ?? [];
  const active = phase === "conflict_resolution"
    && state.activeSpeakerKey === workflowSpeakerKey(input.userId);
  const currentParticipant = input.projectManagerUserId === input.userId
    || input.taskParticipantCandidates.some((candidate) => candidate.userId === input.userId);
  const canWrite = input.canWrite ?? ["owner", "maintainer", "contributor"].includes(input.projectRole);
  const canReply = input.interaction.status === "open"
    && canWrite
    && (phase === "ordinary" || (active && currentParticipant));
  const ownSpeaker = speakers.find((speaker) => (
    (speaker as Record<string, unknown>).actorUserId === input.userId
  ));
  const canConfirmOwnPosition = input.interaction.status === "open"
    && phase === "ordinary"
    && ownSpeaker !== undefined
    && ownSpeaker.confirmed !== true;
  const canSubmit = input.interaction.status === "open" && (
    phase === "ordinary"
      ? input.taskAssigneeUserId === input.userId && state.allSpeakersConfirmed === true
      : active && currentParticipant && canReply
  );
  return {
    canReply,
    canConfirmOwnPosition,
    canSubmit,
    canDelegateConflictSpeaker: input.interaction.status === "open"
      && phase === "conflict_resolution"
      && input.projectManagerUserId === input.userId,
    canResolveConflict: input.interaction.status === "open" && phase === "conflict_resolution" && active && currentParticipant && canReply,
    conflictSpeakerCandidates: input.taskParticipantCandidates,
    projectRole: input.projectRole,
  };
}

export interface InteractionCapabilities {
  canReply: boolean;
  canConfirm: boolean;
  canDecideApproval: boolean;
  canExport: boolean;
  supportsInteractions: boolean;
}
