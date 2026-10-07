import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime();
const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();

const desktopLoopRouteDecisionSchema = z.object({
  decisionId: z.string().min(1).max(191),
  sourceNodeId: z.string().min(1).max(96),
  targetNodeId: z.string().min(1).max(96),
  reasonCode: z.string().min(1).max(96),
  summary: z.string().min(1).max(4_000),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(512)).max(20),
  routerContractVersion: z.number().int().nonnegative(),
  routerContractDigest: z.string().min(1).max(128),
  selectedEdgeId: z.string().min(1).max(96).nullable(),
  errorSummary: z.string().max(2_000).nullable(),
}).strict();

const desktopTaskSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  assigneeName: z.string().min(1).nullable(),
  updatedAt: nullableIsoDateTimeSchema,
  route: z.string().startsWith("/tasks/"),
}).strict();

export const desktopDashboardResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    currentTask: desktopTaskSummarySchema.nullable(),
    stats: z.array(z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      count: z.number().int().nonnegative(),
      description: z.string(),
    }).strict()),
    actionSignals: z.array(z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      count: z.number().int().nonnegative(),
      description: z.string(),
    }).strict()),
    tasks: z.array(desktopTaskSummarySchema),
    devices: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      platform: z.string().min(1),
      status: z.string().min(1),
      lastSeenAt: nullableIsoDateTimeSchema,
      userName: z.string().min(1),
    }).strict()),
  }).strict(),
}).strict();

export const desktopSearchItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  status: z.string().nullable(),
  updatedAt: nullableIsoDateTimeSchema,
  route: z.string().startsWith("/"),
}).strict();

export const desktopSearchResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    query: z.string(),
    tasks: z.array(desktopSearchItemSchema).max(20),
    projects: z.array(desktopSearchItemSchema).max(20),
    documents: z.array(desktopSearchItemSchema).max(20),
    members: z.array(desktopSearchItemSchema).max(20),
    agents: z.array(desktopSearchItemSchema).max(20),
  }).strict(),
}).strict();

export const desktopAgentsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    canManage: z.boolean(),
    profiles: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      provider: z.string().min(1),
      status: z.string().min(1),
      model: z.string().nullable(),
      route: z.string().startsWith("/agents"),
    }).strict()),
    workers: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      runtimeType: z.string().min(1),
      agentVersion: z.string().min(1).max(64).nullable().optional(),
      status: z.string().min(1),
      activeRunCount: z.number().int().nonnegative(),
      maxConcurrentRuns: z.number().int().nonnegative(),
      lastHeartbeatAt: nullableIsoDateTimeSchema,
    }).strict()),
    runs: z.array(z.object({
      id: z.string().min(1),
      taskId: z.string().min(1).nullable(),
      taskTitle: z.string().min(1),
      status: z.string().min(1),
      attempt: z.number().int().nonnegative(),
      provider: z.string().min(1),
      workerName: z.string().min(1).nullable(),
      createdAt: isoDateTimeSchema,
      lastHeartbeatAt: nullableIsoDateTimeSchema,
      route: z.string().startsWith("/").refine(
        (route) => route.startsWith("/tasks/") || route.startsWith("/loop-runs/"),
        { message: "Agent run route must target a task or Loop run" },
      ),
    }).strict()),
    loops: z.array(z.object({
      id: z.string().min(1),
      taskId: z.string().min(1).nullable(),
      taskTitle: z.string().min(1),
      loopName: z.string().min(1),
      scope: z.enum(["task", "project"]),
      parentLoopRunId: z.string().min(1).nullable(),
      parentLoopName: z.string().min(1).nullable(),
      status: z.string().min(1),
      waitingReason: z.string().nullable().optional(),
      version: z.number().int().positive(),
      currentIteration: z.number().int().nonnegative(),
      maxIterations: z.number().int().positive(),
      attempt: z.number().int().nonnegative(),
      lastHeartbeatAt: nullableIsoDateTimeSchema,
      route: z.string().startsWith("/").refine(
        (route) => route.startsWith("/tasks/") || route.startsWith("/loop-runs/"),
        { message: "Agent Loop route must target a task or Loop run" },
      ),
    }).strict()),
    approvals: z.array(z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      status: z.string().min(1),
      taskTitle: z.string().nullable(),
      createdAt: isoDateTimeSchema,
      action: z.string().min(1),
      scope: z.string().min(1),
      policyReason: z.string().min(1),
    }).strict()),
  }).strict(),
}).strict();

const desktopLoopAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  status: z.string().min(1),
  executorType: z.string().min(1),
  startedAt: nullableIsoDateTimeSchema,
  finishedAt: nullableIsoDateTimeSchema,
  summary: z.string().max(2_000).nullable(),
  errorSummary: z.string().max(2_000).nullable(),
}).strict();

const desktopLoopInteractionSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  closedAt: nullableIsoDateTimeSchema,
  messages: z.array(z.object({
    id: z.string().min(1).max(128),
    sequence: z.number().int().positive(),
    actorType: z.enum(["user", "agent", "system"]),
    actorId: z.string().min(1).max(128),
    body: z.string().max(20_000),
    answers: z.record(z.string(), z.array(z.string())),
    createdAt: isoDateTimeSchema,
  }).strict()),
  decision: z.object({
    decision: z.enum(["confirmed", "approved", "rejected", "cancelled", "expired"]),
    actorType: z.enum(["user", "agent", "system"]),
    actorId: z.string().min(1).max(128),
    reason: z.string().max(4_000).nullable(),
    createdAt: isoDateTimeSchema,
  }).strict().nullable(),
}).strict();

export const desktopLoopDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    run: z.object({
      id: z.string().min(1).max(96),
      status: z.string().min(1).max(64),
      version: z.number().int().positive(),
      definitionVersion: z.number().int().positive(),
      projectionVersion: z.number().int().nonnegative(),
      currentIteration: z.number().int().nonnegative(),
      maxIterations: z.number().int().positive(),
      transitionCount: z.number().int().nonnegative(),
      stopReason: z.string().max(2_000).nullable(),
      waitingReason: z.string().max(191).nullable(),
      lastHeartbeatAt: nullableIsoDateTimeSchema,
    }).strict(),
    task: z.object({
      id: z.string().min(1).max(96),
      title: z.string().min(1).max(500),
      route: z.string().startsWith("/tasks/"),
    }).strict(),
    worker: z.object({
      id: z.string().min(1).max(96),
      name: z.string().min(1).max(191),
      status: z.string().min(1).max(64),
    }).strict().nullable(),
    agentRunId: z.string().min(1).max(96).nullable(),
    nodes: z.array(z.object({
      nodeKey: z.string().min(1).max(96),
      label: z.string().min(1).max(191),
      type: z.string().min(1).max(64),
      status: z.string().min(1).max(64),
      currentNodeRunId: z.string().min(1).max(96).nullable(),
      attemptNo: z.number().int().nonnegative(),
      waitingReason: z.string().max(191).nullable(),
      attempts: z.array(desktopLoopAttemptSchema),
    }).strict()),
    edges: z.array(z.object({
      edgeId: z.string().min(1).max(96),
      source: z.string().min(1).max(96),
      target: z.string().min(1).max(96),
      kind: z.string().min(1).max(64),
      outcome: z.string().min(1).max(64),
      traversalCount: z.number().int().nonnegative(),
      limit: z.number().int().positive().nullable(),
      lastTraversalAt: nullableIsoDateTimeSchema,
    }).strict()),
    timeline: z.array(z.object({
      id: z.string().min(1).max(191),
      kind: z.string().min(1).max(191),
      occurredAt: isoDateTimeSchema,
      summary: z.string().min(1).max(2_000),
      actorType: z.string().min(1).max(64).optional(),
      actorId: z.string().min(1).max(128).optional(),
      status: z.string().min(1).max(64).nullable().optional(),
      routeDecision: desktopLoopRouteDecisionSchema.optional(),
    }).strict()),
    interaction: desktopLoopInteractionSchema.nullable(),
    capabilities: z.object({
      canReply: z.boolean(),
      canConfirm: z.boolean(),
      canDecideApproval: z.boolean(),
    }).strict(),
  }).strict(),
}).strict();

const desktopNotificationTargetSchema = z.discriminatedUnion("resourceType", [
  z.object({
    resourceType: z.literal("task"),
    resourceId: z.string().min(1),
    route: z.string(),
    label: z.string().min(1),
  }).strict().refine(
    (target) => target.route === `/tasks/${encodeURIComponent(target.resourceId)}`,
    { message: "Task route must match resourceId", path: ["route"] },
  ),
  z.object({
    resourceType: z.literal("document"),
    resourceId: z.string().min(1),
    route: z.string(),
    label: z.string().min(1),
  }).strict().refine(
    (target) => target.route === `/documents/${encodeURIComponent(target.resourceId)}`,
    { message: "Document route must match resourceId", path: ["route"] },
  ),
  z.object({
    resourceType: z.literal("project"),
    resourceId: z.string().min(1),
    route: z.string(),
    label: z.string().min(1),
  }).strict().refine(
    (target) => target.route === `/projects/${encodeURIComponent(target.resourceId)}`,
    { message: "Project route must match resourceId", path: ["route"] },
  ),
  z.object({
    resourceType: z.literal("loop_run"),
    resourceId: z.string().min(1),
    route: z.string(),
    label: z.string().min(1),
  }).strict().refine(
    (target) => target.route === `/loop-runs/${encodeURIComponent(target.resourceId)}`,
    { message: "Loop Run route must match resourceId", path: ["route"] },
  ),
  z.object({
    resourceType: z.literal("approval"),
    resourceId: z.string().min(1),
    route: z.string(),
    label: z.string().min(1),
  }).strict().refine(
    (target) => target.route === `/agents?approvalId=${encodeURIComponent(target.resourceId)}`,
    { message: "Approval route must match resourceId", path: ["route"] },
  ),
]);

export const desktopNotificationsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    summary: z.object({
      unreadCount: z.number().int().nonnegative(),
      todayCount: z.number().int().nonnegative(),
    }).strict(),
    items: z.array(z.object({
      id: z.string().min(1),
      kind: z.enum(["task", "agent", "document", "system"]),
      title: z.string().min(1),
      description: z.string(),
      occurredAt: nullableIsoDateTimeSchema,
      timeLabel: z.string().min(1),
      tone: z.enum(["neutral", "success", "warning", "info", "danger"]),
      isUnread: z.boolean(),
      target: desktopNotificationTargetSchema,
    }).strict()),
  }).strict(),
}).strict();

export const desktopTeamResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    team: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict().nullable(),
    members: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      email: z.string().nullable(),
      status: z.string().min(1),
      lastSeenAt: nullableIsoDateTimeSchema,
      queueLength: z.number().int().nonnegative(),
      currentTask: desktopTaskSummarySchema.nullable(),
      route: z.string().startsWith("/team"),
    }).strict()),
  }).strict(),
}).strict();

const automationSuccessSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unavailable"), label: z.string().min(1) }).strict(),
  z.object({
    state: z.literal("known"),
    succeeded: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    rate: z.number().min(0).max(100),
  }).strict(),
]);

export const desktopReportsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    range: z.enum(["7d", "30d", "90d"]),
    generatedAt: isoDateTimeSchema,
    metrics: z.object({
      completedTasks: z.number().int().nonnegative(),
      overdueTasks: z.number().int().nonnegative(),
      blockerMedianAgeHours: z.number().nonnegative().nullable(),
      humanWaitMedianAgeHours: z.number().nonnegative().nullable(),
      automationSuccess: automationSuccessSchema,
    }).strict(),
    trend: z.discriminatedUnion("state", [
      z.object({
        state: z.literal("ready"),
        points: z.array(z.object({
          label: z.string().min(1),
          completed: z.number().int().nonnegative(),
          blockers: z.number().int().nonnegative(),
        }).strict()),
      }).strict(),
      z.object({ state: z.literal("insufficient"), message: z.string().min(1) }).strict(),
    ]),
    projects: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      status: z.string().min(1),
      health: z.string().min(1),
      openTaskCount: z.number().int().nonnegative(),
      overdueTaskCount: z.number().int().nonnegative(),
      blockedTaskCount: z.number().int().nonnegative(),
      updatedAt: isoDateTimeSchema,
      route: z.string().startsWith("/projects/"),
    }).strict()),
    insights: z.array(z.object({
      label: z.string().min(1),
      count: z.number().int().nonnegative(),
      tone: z.enum(["default", "danger", "warning"]),
      route: z.string().startsWith("/"),
    }).strict()),
  }).strict(),
}).strict();

export const desktopTemplatesResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    templates: z.array(z.object({
      key: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      savedView: z.string().min(1),
      quickCreate: z.object({
        titlePrefix: z.string(),
        phase: z.string().min(1),
        priority: z.enum(["high", "medium", "low"]),
        acceptanceCriteria: z.array(z.string().min(1)),
        requiredDocs: z.array(z.string().min(1)),
        agentPrerequisites: z.array(z.string().min(1)),
      }).strict(),
      route: z.string().startsWith("/tasks"),
    }).strict()),
  }).strict(),
}).strict();

const desktopSettingsUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  status: z.string().min(1),
}).strict();

export const desktopSettingsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    user: desktopSettingsUserSchema,
    companies: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      logoUrl: z.string().nullable(),
      role: z.enum(["owner", "admin", "member", "viewer"]),
      canManage: z.boolean(),
      route: z.string().startsWith("/settings"),
    }).strict()),
    isSiteAdmin: z.boolean(),
    selectedCompany: z.object({
      company: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        slug: z.string().min(1),
        logoUrl: z.string().nullable(),
        status: z.string().min(1),
      }).strict(),
      membership: z.object({
        role: z.enum(["owner", "admin", "member", "viewer"]),
        canManageProfile: z.boolean(),
        canManageMembers: z.boolean(),
        canManageIntegrations: z.boolean(),
        canTransferOwnership: z.boolean(),
      }).strict(),
      profile: z.object({
        description: z.string().nullable(),
        certificationLevel: z.string().min(1),
      }).strict(),
      members: z.array(z.object({
        id: z.string().min(1),
        role: z.enum(["owner", "admin", "member", "viewer"]),
        status: z.string().min(1),
        user: desktopSettingsUserSchema.extend({ lastSeenAt: nullableIsoDateTimeSchema }).strict(),
      }).strict()),
      integration: z.object({
        emailHost: z.string().nullable(),
        emailPort: z.number().int().positive().nullable(),
        emailUsername: z.string().nullable(),
        hasPassword: z.boolean(),
      }).strict().optional(),
    }).strict().nullable(),
  }).strict(),
}).strict();

export type DesktopDashboardResponse = z.infer<typeof desktopDashboardResponseSchema>;
export type DesktopSearchResponse = z.infer<typeof desktopSearchResponseSchema>;
export type DesktopAgentsResponse = z.infer<typeof desktopAgentsResponseSchema>;
export type DesktopLoopDetailResponse = z.infer<typeof desktopLoopDetailResponseSchema>;
export type DesktopNotificationsResponse = z.infer<typeof desktopNotificationsResponseSchema>;
export type DesktopNotificationItem = DesktopNotificationsResponse["data"]["items"][number];
export type DesktopTeamResponse = z.infer<typeof desktopTeamResponseSchema>;
export type DesktopReportsResponse = z.infer<typeof desktopReportsResponseSchema>;
export type DesktopTemplatesResponse = z.infer<typeof desktopTemplatesResponseSchema>;
export type DesktopSettingsResponse = z.infer<typeof desktopSettingsResponseSchema>;
