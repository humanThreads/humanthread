import {
  createLoopNotificationIntentInTransaction,
  prisma,
  type CreateLoopNotificationInput,
} from "@humanthread/db";

export type WorkflowInteractionNotificationTemplate =
  | "workflow_requirement_pending"
  | "workflow_mention"
  | "workflow_approval_pending"
  | "workflow_interaction_decided"
  | "workflow_speaker_confirmation_required"
  | "workflow_all_speakers_confirmed"
  | "workflow_conflict_speaker_assigned"
  | "workflow_intervention_resolved";

export interface EnqueueInteractionNotificationsInput {
  projectId: string;
  loopRunId: string;
  loopNodeRunId: string;
  interactionId: string;
  messageId?: string;
  templateKey: WorkflowInteractionNotificationTemplate;
  body: string;
  recipientUserIds: string[];
  occurredAt: Date;
  dedupeKey?: string;
}

interface NotificationDependencies {
  createLoopNotificationIntentInTransaction: typeof createLoopNotificationIntentInTransaction;
}

const DEFAULTS: NotificationDependencies = { createLoopNotificationIntentInTransaction };

type NotificationAudience = "requirement_pending" | "approval_pending" | "interaction_decided";

interface RecipientContext {
  projectManagerUserId: string | null;
  projectOwnerUserId: string | null;
  projectMembers: Array<{
    userId: string;
    role: string;
    status: string;
    userStatus: string;
  }>;
  task: null | {
    createdById: string;
    createdByStatus: string;
    assigneeUserId: string | null;
    assigneeStatus: string | null;
  };
  directUsers: Array<{ userId: string; userStatus: string }>;
}

interface RecipientDb {
  project: typeof prisma.project;
  task: typeof prisma.task;
  user: typeof prisma.user;
}

const TITLES: Record<WorkflowInteractionNotificationTemplate, string> = {
  workflow_requirement_pending: "需求待确认",
  workflow_mention: "工作流沟通中提及了你",
  workflow_approval_pending: "发版审批待处理",
  workflow_interaction_decided: "工作流交互已处理",
  workflow_speaker_confirmation_required: "发言确认待处理",
  workflow_all_speakers_confirmed: "所有发言人已确认",
  workflow_conflict_speaker_assigned: "冲突二次确认待处理",
  workflow_intervention_resolved: "人工介入已处理",
};

export function buildInteractionNotification(input: {
  templateKey: WorkflowInteractionNotificationTemplate;
  interactionId: string;
  loopRunId: string;
  messageId?: string;
  body: string;
}) {
  const path = `/loop-runs/${encodeURIComponent(input.loopRunId)}`
    + `?interaction=${encodeURIComponent(input.interactionId)}`
    + (input.messageId ? `&message=${encodeURIComponent(input.messageId)}` : "");
  return {
    title: TITLES[input.templateKey],
    description: bounded(redactWorkflowInteractionText(input.body), 240),
    path,
  };
}

export async function enqueueInteractionNotifications(
  tx: Parameters<typeof createLoopNotificationIntentInTransaction>[1],
  input: EnqueueInteractionNotificationsInput,
  overrides: Partial<NotificationDependencies> = {},
) {
  const dependencies = { ...DEFAULTS, ...overrides };
  const notification = buildInteractionNotification(input);
  const recipients = [...new Set(input.recipientUserIds.filter(Boolean))];
  return Promise.all(recipients.map((recipientUserId) => {
    const notificationInput: CreateLoopNotificationInput = {
      projectId: input.projectId,
      loopRunId: input.loopRunId,
      loopNodeRunId: input.loopNodeRunId,
      recipientUserId,
      eventType: input.templateKey,
      title: notification.title,
      description: notification.description,
      occurredAt: input.occurredAt,
      dedupeKey: [
        "workflow",
        input.interactionId,
        input.dedupeKey ?? input.messageId ?? "decision",
        recipientUserId,
        input.templateKey,
      ].join(":"),
      templateData: {
        interactionId: input.interactionId,
        messageId: input.messageId ?? null,
        path: notification.path,
      },
    };
    return dependencies.createLoopNotificationIntentInTransaction(notificationInput, tx);
  }));
}

export async function resolveInteractionNotificationRecipients(
  input: {
    projectId: string;
    taskId: string | null;
    audience: NotificationAudience;
    actorUserId: string;
  },
  overrides: {
    db?: RecipientDb;
    loadRecipientContext?: (input: { projectId: string; taskId: string | null }) => Promise<RecipientContext | null>;
  } = {},
) {
  const context = await (overrides.loadRecipientContext
    ? overrides.loadRecipientContext({ projectId: input.projectId, taskId: input.taskId })
    : loadRecipientContextWithDb({ projectId: input.projectId, taskId: input.taskId }, overrides.db ?? prisma));
  if (!context) return [];

  const recipients: string[] = [];
  const add = (userId: string | null, active: boolean) => {
    if (active && userId && userId !== input.actorUserId && !recipients.includes(userId)) recipients.push(userId);
  };
  if (input.audience !== "approval_pending") {
    add(context.task?.assigneeUserId ?? null, context.task?.assigneeStatus === "active");
    add(context.task?.createdById ?? null, context.task?.createdByStatus === "active");
  }
  for (const member of context.projectMembers) {
    add(
      member.userId,
      member.status === "active"
        && member.userStatus === "active"
        && (member.role === "owner" || member.role === "maintainer"),
    );
  }
  for (const user of context.directUsers) add(user.userId, user.userStatus === "active");
  return recipients;
}

async function loadRecipientContextWithDb(
  input: { projectId: string; taskId: string | null },
  db: RecipientDb,
): Promise<RecipientContext | null> {
  const [project, task] = await Promise.all([
    db.project.findUnique({
      where: { id: input.projectId },
      select: {
        managerUserId: true,
        ownerUserId: true,
        members: {
          select: {
            userId: true,
            role: true,
            status: true,
            user: { select: { status: true } },
          },
        },
      },
    }),
    input.taskId
      ? db.task.findUnique({
          where: { id: input.taskId },
          select: {
            createdById: true,
            assigneeUserId: true,
            createdBy: { select: { status: true } },
            assignee: { select: { status: true } },
          },
        })
      : null,
  ]);
  if (!project) return null;
  const directIds = [...new Set([project.managerUserId, project.ownerUserId].filter((value): value is string => Boolean(value)))];
  const directUsers = directIds.length > 0
    ? await db.user.findMany({ where: { id: { in: directIds } }, select: { id: true, status: true } })
    : [];
  return {
    projectManagerUserId: project.managerUserId,
    projectOwnerUserId: project.ownerUserId,
    projectMembers: project.members.map((member) => ({
      userId: member.userId,
      role: member.role,
      status: member.status,
      userStatus: member.user.status,
    })),
    task: task ? {
      createdById: task.createdById,
      createdByStatus: task.createdBy.status,
      assigneeUserId: task.assigneeUserId,
      assigneeStatus: task.assignee?.status ?? null,
    } : null,
    directUsers: directUsers.map((user) => ({ userId: user.id, userStatus: user.status })),
  };
}

export function redactWorkflowInteractionText(value: string) {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/giu, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "[REDACTED]")
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(/\bLTAI[A-Za-z0-9]{8,}\b/gu, "[REDACTED]")
    .replace(/\b((?:access[_-]?key|api[_-]?key|password|secret|token|AK)\s*[=:]\s*)[^\s,;]+/giu, "$1[REDACTED]")
    .replace(/([?&](?:OSSAccessKeyId|Signature|Expires)=)[^&\s]+/giu, "$1[REDACTED]");
}

function bounded(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
