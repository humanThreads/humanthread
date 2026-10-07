import { assertCanReadProject, prisma } from "@humanthread/db";

export type WorkflowParticipantRelationship =
  | "task_assignee"
  | "task_creator"
  | "project_member"
  | "project_admin"
  | "release_approver";

export interface WorkflowParticipantView {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  relationship: WorkflowParticipantRelationship;
}

interface ParticipantUser {
  name: string;
  avatarUrl: string | null;
  status: string;
}

interface LoopRunParticipantContext {
  loopRunId: string;
  projectId: string;
  projectManagerUserId: string | null;
  projectOwnerUserId: string | null;
  projectMembers: Array<{
    userId: string;
    role: string;
    status: string;
    user: ParticipantUser;
  }>;
  task: null | {
    createdById: string;
    assigneeUserId: string | null;
    createdBy: ParticipantUser;
    assignee: ParticipantUser | null;
  };
}

interface MentionCandidate {
  userId: string;
  memberStatus: string;
  userStatus: string;
}

interface ListDependencies {
  loadLoopRunContext(input: { loopRunId: string }): Promise<LoopRunParticipantContext | null>;
  assertCanReadProject: typeof assertCanReadProject;
}

interface MentionDependencies {
  loadProjectMentionCandidates(input: { projectId: string; userIds: string[] }): Promise<MentionCandidate[]>;
}

interface MentionDb {
  project: typeof prisma.project;
  user: typeof prisma.user;
}

const LIST_DEFAULTS: ListDependencies = {
  loadLoopRunContext: async ({ loopRunId }) => {
    const run = await prisma.loopRun.findUnique({
      where: { id: loopRunId },
      select: {
        id: true,
        projectId: true,
        project: {
          select: {
            managerUserId: true,
            ownerUserId: true,
            members: {
              select: {
                userId: true,
                role: true,
                status: true,
                user: { select: { name: true, avatarUrl: true, status: true } },
              },
            },
          },
        },
        task: {
          select: {
            createdById: true,
            assigneeUserId: true,
            createdBy: { select: { name: true, avatarUrl: true, status: true } },
            assignee: { select: { name: true, avatarUrl: true, status: true } },
          },
        },
      },
    });
    if (!run?.projectId || !run.project) return null;
    return {
      loopRunId: run.id,
      projectId: run.projectId,
      projectManagerUserId: run.project.managerUserId,
      projectOwnerUserId: run.project.ownerUserId,
      projectMembers: run.project.members,
      task: run.task,
    };
  },
  assertCanReadProject,
};

async function loadProjectMentionCandidatesWithDb(
  { projectId, userIds }: { projectId: string; userIds: string[] },
  db: MentionDb,
) {
    if (userIds.length === 0) return [];
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        managerUserId: true,
        ownerUserId: true,
        members: {
          where: { userId: { in: userIds } },
          select: { userId: true, status: true, user: { select: { status: true } } },
        },
      },
    });
    if (!project) return [];
    const directIds = [project.managerUserId, project.ownerUserId]
      .filter((value): value is string => Boolean(value) && userIds.includes(value!));
    const directUsers = directIds.length > 0
      ? await db.user.findMany({ where: { id: { in: directIds } }, select: { id: true, status: true } })
      : [];
    return [
      ...project.members.map((member) => ({
        userId: member.userId,
        memberStatus: member.status,
        userStatus: member.user.status,
      })),
      ...directUsers.map((user) => ({
        userId: user.id,
        memberStatus: "active",
        userStatus: user.status,
      })),
    ];
}

export async function listEligibleWorkflowParticipants(
  input: { userId: string; loopRunId: string; query: string },
  overrides: Partial<ListDependencies> = {},
): Promise<WorkflowParticipantView[]> {
  const dependencies = { ...LIST_DEFAULTS, ...overrides };
  const context = await dependencies.loadLoopRunContext({ loopRunId: input.loopRunId });
  if (!context) throw participantError("not_found", "LoopRun not found");
  await dependencies.assertCanReadProject({ userId: input.userId, projectId: context.projectId });

  const participants = new Map<string, WorkflowParticipantView>();
  const add = (userId: string | null, user: ParticipantUser | null, relationship: WorkflowParticipantRelationship) => {
    if (!userId || !user || user.status !== "active" || participants.has(userId)) return;
    participants.set(userId, { userId, displayName: user.name, avatarUrl: user.avatarUrl, relationship });
  };
  add(context.task?.assigneeUserId ?? null, context.task?.assignee ?? null, "task_assignee");
  add(context.task?.createdById ?? null, context.task?.createdBy ?? null, "task_creator");
  for (const member of context.projectMembers) {
    if (member.status !== "active") continue;
    const relationship = member.role === "owner" || member.role === "maintainer"
      ? "project_admin"
      : member.userId === context.projectManagerUserId
        ? "release_approver"
        : "project_member";
    add(member.userId, member.user, relationship);
  }

  const normalizedQuery = input.query.trim().toLocaleLowerCase();
  return [...participants.values()]
    .filter((participant) => !normalizedQuery
      || participant.displayName.toLocaleLowerCase().includes(normalizedQuery)
      || participant.userId.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.userId.localeCompare(right.userId));
}

export async function resolveWorkflowMentions(
  input: { projectId: string; mentionedUserIds: string[]; actorUserId: string },
  overrides: Partial<MentionDependencies> & { db?: MentionDb } = {},
): Promise<string[]> {
  const mentionedUserIds = [...new Set(input.mentionedUserIds)];
  if (mentionedUserIds.length > 50) throw participantError("validation_failed", "Too many workflow mentions");
  if (mentionedUserIds.length === 0) return [];
  const loadCandidates = overrides.loadProjectMentionCandidates
    ?? ((candidateInput: { projectId: string; userIds: string[] }) => loadProjectMentionCandidatesWithDb(
      candidateInput,
      overrides.db ?? prisma,
    ));
  const candidates = await loadCandidates({
    projectId: input.projectId,
    userIds: mentionedUserIds,
  });
  const eligible = new Set(candidates
    .filter((candidate) => candidate.memberStatus === "active" && candidate.userStatus === "active")
    .map((candidate) => candidate.userId));
  if (mentionedUserIds.some((userId) => !eligible.has(userId))) {
    throw participantError("validation_failed", "Workflow mention contains an inactive or ineligible Project member");
  }
  return mentionedUserIds;
}

function participantError(code: "not_found" | "validation_failed", message: string) {
  return Object.assign(new Error(message), { code });
}
