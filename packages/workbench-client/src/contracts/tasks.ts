import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime();
const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();

export const desktopTaskSchema = z.object({
  id: z.string().min(1),
  shortId: z.string().min(1).nullable(),
  title: z.string().min(1),
  statusCategory: z.enum([
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "completed",
    "cancelled",
  ]),
  status: z.object({
    id: z.string().min(1).nullable(),
    name: z.string().min(1),
    category: z.string().min(1),
    color: z.string().min(1),
  }).strict(),
  visibility: z.enum(["private", "project", "company"]),
  priority: z.number().int(),
  startAt: nullableIsoDateTimeSchema,
  dueAt: nullableIsoDateTimeSchema,
  overdue: z.boolean(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  createdById: z.string().min(1),
  assignee: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    avatarUrl: z.string().nullable(),
  }).strict().nullable(),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }).strict().nullable(),
  blocker: z.object({
    id: z.string().min(1),
    reason: z.string().min(1),
    ownerUserId: z.string().min(1).nullable(),
    createdAt: isoDateTimeSchema,
  }).strict().nullable(),
  labels: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.string().min(1),
  }).strict()),
  childCount: z.number().int().nonnegative(),
  automation: z.object({
    id: z.string().min(1),
    status: z.string().min(1),
    createdAt: isoDateTimeSchema,
    agentProfile: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      provider: z.string().min(1),
    }).strict(),
  }).strict().nullable(),
}).strict();

export const desktopTaskCollectionResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    collection: z.object({
      listRows: z.array(desktopTaskSchema),
      boardGroups: z.array(z.object({
        key: z.string().min(1),
        tasks: z.array(desktopTaskSchema),
      }).strict()),
      calendar: z.object({
        entries: z.array(z.object({
          taskId: z.string().min(1),
          shortId: z.string().min(1).nullable(),
          title: z.string().min(1),
          kind: z.enum(["start", "due"]),
          at: isoDateTimeSchema,
          dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
          overdue: z.boolean(),
        }).strict()),
        unscheduled: z.array(desktopTaskSchema),
      }).strict(),
      relationCounts: z.record(z.string(), z.number().int().nonnegative()),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().optional(),
      hasNextPage: z.boolean().optional(),
      hasPreviousPage: z.boolean().optional(),
    }).strict(),
  }).strict(),
}).strict();

export const taskSavedViewsResponseSchema = z.object({
  ok: z.literal(true),
  views: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    filters: z.unknown().optional(),
  })),
});

export const taskCommandResponseSchema = z.object({
  ok: z.literal(true),
  result: z.unknown(),
});

const desktopTaskPersonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  avatarUrl: z.string().nullable(),
}).strict();

const desktopTaskLabelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
}).strict();

const desktopTaskCapabilitiesSchema = z.object({
  read: z.boolean(),
  comment: z.boolean(),
  edit: z.boolean(),
  changeStatus: z.boolean(),
  manageMembers: z.boolean(),
  manageVisibility: z.boolean(),
  dispatchAgent: z.boolean(),
  govern: z.boolean(),
  nativeExecute: z.boolean(),
}).strict();

const desktopTaskDetailSchema = desktopTaskSchema.extend({
  contentMarkdown: z.string(),
  acceptanceMode: z.string().min(1),
  archivedAt: nullableIsoDateTimeSchema,
  createdBy: desktopTaskPersonSchema,
  acceptanceReviewer: desktopTaskPersonSchema.nullable(),
  members: z.array(z.object({
    userId: z.string().min(1),
    role: z.string().min(1),
    user: desktopTaskPersonSchema,
  }).strict()),
  blockers: z.array(z.object({
    id: z.string().min(1),
    reason: z.string().min(1),
  }).strict()),
  comments: z.array(z.object({
    id: z.string().min(1),
    contentMarkdown: z.string(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    author: desktopTaskPersonSchema,
  }).strict()),
  activities: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    actorType: z.string().min(1),
    message: z.string().nullable(),
    payload: z.unknown(),
    createdAt: isoDateTimeSchema,
  }).strict()),
  reminders: z.array(z.object({
    id: z.string().min(1),
    remindAt: isoDateTimeSchema,
    channel: z.string().min(1),
    status: z.string().min(1),
  }).strict()),
  attachments: z.array(z.object({
    id: z.string().min(1),
    originalName: z.string().min(1),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
  }).strict()),
  documentLinks: z.array(z.object({
    document: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      path: z.string(),
      version: z.number().int().positive(),
    }).strict(),
  }).strict()),
  childTasks: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    statusCategory: z.string().min(1),
  }).strict()),
}).strict();

const desktopTaskExecutionSchema = z.object({
  projectId: z.string().min(1).nullable(),
  workflowInstanceId: z.string().min(1).nullable(),
  localPath: z.string().min(1).nullable(),
  command: z.string().min(1).nullable(),
  toolSession: z.object({
    id: z.string().min(1),
    sessionType: z.string().min(1),
    sessionName: z.string().min(1),
    status: z.string().min(1),
    lastOutputSummary: z.string().nullable(),
  }).strict().nullable(),
}).strict();

export const desktopTaskDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    detail: z.object({
      task: desktopTaskDetailSchema,
      capabilities: desktopTaskCapabilitiesSchema,
      collaboration: z.object({
        availableMembers: z.array(z.object({
          id: z.string().min(1),
          name: z.string().min(1),
        }).strict()),
        availableLabels: z.array(desktopTaskLabelSchema),
      }).strict(),
      execution: desktopTaskExecutionSchema,
    }).strict(),
  }).strict(),
}).strict();

export const taskMutationResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    version: z.number().int().positive(),
  }).passthrough(),
});

export type DesktopTask = z.infer<typeof desktopTaskSchema>;
export type DesktopTaskCollectionResponse = z.infer<typeof desktopTaskCollectionResponseSchema>;
export type DesktopTaskDetailResponse = z.infer<typeof desktopTaskDetailResponseSchema>;
export type DesktopTaskDetail = DesktopTaskDetailResponse["data"]["detail"];
export type DesktopTaskExecution = DesktopTaskDetail["execution"];
