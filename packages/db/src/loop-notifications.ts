import { createHash } from "node:crypto";

import { boundedPersistenceId } from "./bounded-id";
import { prisma } from "./prisma";

export type LoopNotificationLevel =
  | "action_required"
  | "critical"
  | "important"
  | "activity";

export type LoopNotificationChannel = "in_app" | "desktop" | "email" | "enterprise_im";

export interface LoopNotificationIntentProjection {
  id: string;
  projectId: string;
  loopRunId: string;
  loopNodeRunId: string | null;
  recipientUserId: string;
  level: LoopNotificationLevel;
  title: string;
  description: string;
  eventFamily: string;
  channels: readonly LoopNotificationChannel[];
  approvalId: string | null;
  templateData: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateLoopNotificationInput {
  projectId: string;
  loopRunId: string;
  loopNodeRunId?: string | null;
  recipientUserId: string;
  eventType: string;
  title: string;
  description: string;
  approvalId?: string | null;
  occurredAt?: Date;
  templateData?: Record<string, unknown>;
  bindingNotificationPolicy?: {
    channelsByLevel?: Partial<Record<LoopNotificationLevel, readonly string[]>>;
  };
  userPreferences?: {
    channels?: Partial<Record<LoopNotificationChannel, boolean>>;
  };
  dedupeWindowMs?: number;
  dedupeKey?: string;
}

interface NotificationIntentRow {
  id: string;
  projectId: string;
  loopRunId: string;
  loopNodeRunId: string | null;
  recipientUserId: string;
  level: string;
  templateKey: string;
  templateData: unknown;
  dedupeKey: string;
  channels: unknown;
  status: string;
  deliveryState?: unknown;
  readAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

interface LoopNotificationStore {
  notificationIntent: {
    findUnique(args: { where: { dedupeKey: string } }): Promise<NotificationIntentRow | null>;
    findMany(args: unknown): Promise<NotificationIntentRow[]>;
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    updateMany(args: {
      where: { id: string; recipientUserId: string };
      data: { readAt: Date };
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { id: string; recipientUserId: string };
    }): Promise<NotificationIntentRow | null>;
    updateMany(args: {
      where: { id: string };
      data: { status: string; deliveryState: Record<string, unknown> };
    }): Promise<{ count: number }>;
  };
}

interface LoopNotificationTx extends LoopNotificationStore {
  outboxMessage: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
  };
}

interface LoopNotificationDb extends LoopNotificationStore {
  $transaction<T>(callback: (tx: LoopNotificationTx) => Promise<T>): Promise<T>;
}

interface LoopNotificationDependencies {
  db: LoopNotificationDb;
}

const DEFAULT_DEPENDENCIES: LoopNotificationDependencies = {
  db: prisma as unknown as LoopNotificationDb,
};

const DEFAULT_DEDUPE_WINDOW_MS = 5 * 60 * 1_000;
const DESCRIPTION_MAX_LENGTH = 240;
const TITLE_MAX_LENGTH = 160;
const CHANNELS = new Set<LoopNotificationChannel>([
  "in_app",
  "desktop",
  "email",
  "enterprise_im",
]);
const DEFAULT_CHANNELS: Record<LoopNotificationLevel, readonly LoopNotificationChannel[]> = {
  action_required: ["in_app", "desktop"],
  critical: ["in_app", "desktop"],
  important: ["in_app"],
  activity: [],
};
const SENSITIVE_KEY = /(?:authorization|credential|password|secret|token|api[_-]?key|private[_-]?key)/iu;

const ACTION_REQUIRED_EVENTS = new Set([
  "loop.approval.required",
  "loop.configuration.required",
  "loop.input.required",
  "loop.intervention.required",
  "loop.reconciliation.required",
  "workflow_requirement_pending",
  "workflow_mention",
  "workflow_approval_pending",
]);
const CRITICAL_EVENTS = new Set([
  "loop.grant.revoked",
  "loop.node.failed",
  "loop.run.failed",
  "loop.run.exhausted",
  "loop.reconciliation.timed_out",
]);
const IMPORTANT_EVENTS = new Set([
  "loop.run.completed",
  "loop.run.cancelled",
  "loop.artifact.important",
  "loop.knowledge.published",
  "workflow_interaction_decided",
]);

export function deriveLoopNotificationLevel(eventType: string): LoopNotificationLevel {
  const normalized = eventType.trim().toLowerCase();
  if (ACTION_REQUIRED_EVENTS.has(normalized)) return "action_required";
  if (CRITICAL_EVENTS.has(normalized)) return "critical";
  if (IMPORTANT_EVENTS.has(normalized)) return "important";
  return "activity";
}

function requiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function redactCredentials(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]{8,}\b/gu, "[REDACTED]")
    .replace(
      /\b((?:access|refresh|id)[_-]?token\s*[=:]\s*)[^\s,;]+/giu,
      "$1[REDACTED]",
    );
}

function boundedText(value: string, maxLength: number): string {
  const normalized = redactCredentials(value).replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function sanitizeTemplateValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactCredentials(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeTemplateValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeTemplateValue(entryValue, entryKey),
    ]));
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  return null;
}

function deriveChannels(
  level: LoopNotificationLevel,
  input: CreateLoopNotificationInput,
): LoopNotificationChannel[] {
  const configured = input.bindingNotificationPolicy?.channelsByLevel?.[level];
  const policyChannels = configured === undefined
    ? DEFAULT_CHANNELS[level]
    : configured.filter((channel): channel is LoopNotificationChannel =>
      CHANNELS.has(channel as LoopNotificationChannel));
  return Array.from(new Set(policyChannels)).filter(
    (channel) => input.userPreferences?.channels?.[channel] !== false,
  );
}

function notificationIdentity(input: CreateLoopNotificationInput, eventFamily: string): {
  id: string;
  dedupeKey: string;
} {
  const explicitDedupeKey = input.dedupeKey?.trim();
  if (explicitDedupeKey) {
    if (/[\u0000-\u001f\u007f]/u.test(explicitDedupeKey)) {
      throw new Error("Loop notification dedupe key is invalid");
    }
    const digest = createHash("md5").update(explicitDedupeKey).digest("hex");
    return {
      id: boundedPersistenceId("loop-notification", [digest]),
      dedupeKey: digest,
    };
  }
  const occurredAt = input.occurredAt ?? new Date();
  const requestedWindow = input.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const windowMs = Number.isSafeInteger(requestedWindow) && requestedWindow > 0
    ? requestedWindow
    : DEFAULT_DEDUPE_WINDOW_MS;
  const window = Math.floor(occurredAt.getTime() / windowMs);
  const digest = createHash("md5").update([
    input.recipientUserId,
    input.loopRunId,
    input.loopNodeRunId ?? "run",
    eventFamily,
    String(window),
  ].join("\0")).digest("hex");
  return { id: boundedPersistenceId("loop-notification", [digest]), dedupeKey: digest };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asChannels(value: unknown): LoopNotificationChannel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((channel): channel is LoopNotificationChannel =>
    typeof channel === "string" && CHANNELS.has(channel as LoopNotificationChannel));
}

function asLevel(value: string): LoopNotificationLevel {
  if (value === "action_required" || value === "critical" || value === "important") return value;
  return "activity";
}

function projectRow(row: NotificationIntentRow): LoopNotificationIntentProjection {
  const templateData = asRecord(row.templateData);
  return {
    id: row.id,
    projectId: row.projectId,
    loopRunId: row.loopRunId,
    loopNodeRunId: row.loopNodeRunId,
    recipientUserId: row.recipientUserId,
    level: asLevel(row.level),
    title: typeof templateData.title === "string" ? templateData.title : row.templateKey,
    description: typeof templateData.description === "string" ? templateData.description : "",
    eventFamily: typeof templateData.eventFamily === "string"
      ? templateData.eventFamily
      : row.templateKey,
    channels: asChannels(row.channels),
    approvalId: typeof templateData.approvalId === "string" ? templateData.approvalId : null,
    templateData,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export async function createLoopNotificationIntent(
  input: CreateLoopNotificationInput,
  dependencies: LoopNotificationDependencies = DEFAULT_DEPENDENCIES,
): Promise<LoopNotificationIntentProjection> {
  return dependencies.db.$transaction((tx) =>
    createLoopNotificationIntentInTransaction(input, tx));
}

export async function createLoopNotificationIntentInTransaction(
  input: CreateLoopNotificationInput,
  tx: LoopNotificationTx,
): Promise<LoopNotificationIntentProjection> {
  const eventFamily = requiredId(input.eventType, "eventType").slice(0, 96).toLowerCase();
  const projectId = requiredId(input.projectId, "projectId");
  const loopRunId = requiredId(input.loopRunId, "loopRunId");
  const recipientUserId = requiredId(input.recipientUserId, "recipientUserId");
  const loopNodeRunId = input.loopNodeRunId?.trim() || null;
  const level = deriveLoopNotificationLevel(eventFamily);
  const occurredAt = input.occurredAt ?? new Date();
  const title = boundedText(input.title, TITLE_MAX_LENGTH);
  const description = boundedText(input.description, DESCRIPTION_MAX_LENGTH);
  const channels = deriveChannels(level, input);
  const templateData = {
    ...asRecord(sanitizeTemplateValue(input.templateData ?? {})),
    title,
    description,
    eventFamily,
    approvalId: input.approvalId?.trim() || null,
  };
  const identity = notificationIdentity({
    ...input,
    projectId,
    loopRunId,
    loopNodeRunId,
    recipientUserId,
    occurredAt,
  }, eventFamily);

  const existing = await tx.notificationIntent.findUnique({
    where: { dedupeKey: identity.dedupeKey },
  });
  if (existing) return projectRow(existing);

  const data = {
      id: identity.id,
      projectId,
      loopRunId,
      loopNodeRunId,
      recipientUserId,
      level,
      templateKey: eventFamily,
      templateData,
      dedupeKey: identity.dedupeKey,
      channels,
      status: "pending",
      readAt: null,
      createdAt: occurredAt,
    };
  const inserted = await tx.notificationIntent.createMany({
    data: [data],
    skipDuplicates: true,
  });
  if (inserted.count === 1) {
    await tx.outboxMessage.createMany({
      data: [{
        id: boundedPersistenceId("outbox", [identity.id]),
        topic: "loop.notification.intent",
        aggregateType: "loop_run",
        aggregateId: loopRunId,
        payload: { ...data, createdAt: occurredAt.toISOString() },
        availableAt: occurredAt,
      }],
    });
    return projectRow(data as NotificationIntentRow);
  }

  const raced = await tx.notificationIntent.findUnique({
    where: { dedupeKey: identity.dedupeKey },
  });
  if (!raced) throw new Error("Loop notification dedupe conflict");
  return projectRow(raced);
}

export async function listLoopNotificationIntents(
  input: { recipientUserId: string; projectIds: string[]; limit?: number },
  dependencies: LoopNotificationDependencies = DEFAULT_DEPENDENCIES,
): Promise<LoopNotificationIntentProjection[]> {
  const recipientUserId = requiredId(input.recipientUserId, "recipientUserId");
  const projectIds = Array.from(new Set(input.projectIds.map((id) => id.trim()).filter(Boolean)));
  if (projectIds.length === 0) return [];
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const rows = await dependencies.db.notificationIntent.findMany({
    where: { recipientUserId, projectId: { in: projectIds } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map(projectRow);
}

export async function markLoopNotificationIntentRead(
  input: { notificationId: string; recipientUserId: string; readAt?: Date },
  dependencies: LoopNotificationDependencies = DEFAULT_DEPENDENCIES,
): Promise<LoopNotificationIntentProjection> {
  const notificationId = requiredId(input.notificationId, "notificationId");
  const recipientUserId = requiredId(input.recipientUserId, "recipientUserId");
  await dependencies.db.notificationIntent.updateMany({
    where: { id: notificationId, recipientUserId },
    data: { readAt: input.readAt ?? new Date() },
  });
  const row = await dependencies.db.notificationIntent.findFirst({
    where: { id: notificationId, recipientUserId },
  });
  if (!row) throw new Error("Loop notification not found");
  return projectRow(row);
}

export interface AcknowledgeLoopNotificationProjectionInput {
  notificationId: string;
  channels?: readonly LoopNotificationChannel[];
  projectedAt?: Date;
}

export interface AcknowledgeLoopNotificationProjectionResult {
  notificationId: string;
  status: "available";
  deliveryState: Record<string, { status: "available"; projectedAt: string }>;
}

interface LoopNotificationProjectionDependencies {
  db: {
    notificationIntent: {
      findUnique(args: { where: { id: string } }): Promise<NotificationIntentRow | null>;
      updateMany(args: {
        where: { id: string };
        data: { status: string; deliveryState: Record<string, unknown> };
      }): Promise<{ count: number }>;
    };
  };
}

const DEFAULT_PROJECTION_DEPENDENCIES: LoopNotificationProjectionDependencies = {
  db: prisma as unknown as LoopNotificationProjectionDependencies["db"],
};

export async function acknowledgeLoopNotificationProjection(
  input: AcknowledgeLoopNotificationProjectionInput,
  dependencies: LoopNotificationProjectionDependencies = DEFAULT_PROJECTION_DEPENDENCIES,
): Promise<AcknowledgeLoopNotificationProjectionResult> {
  const notificationId = requiredId(input.notificationId, "notificationId");
  const projectedAt = input.projectedAt ?? new Date();
  const row = await dependencies.db.notificationIntent.findUnique({ where: { id: notificationId } });
  if (!row) throw new Error("Loop notification not found");
  const current = asRecord(row.deliveryState);
  const requestedChannels = Array.from(new Set(input.channels ?? asChannels(row.channels)));
  const unsupportedChannel = requestedChannels.find(
    (channel) => channel === "email" || channel === "enterprise_im",
  );
  if (unsupportedChannel) {
    throw new Error(`Loop notification ${unsupportedChannel} connector is not configured`);
  }
  const channels = requestedChannels.filter(
    (channel) => channel === "in_app" || channel === "desktop",
  );
  const projected = Object.fromEntries(channels.map((channel) => {
    const existing = asRecord(current[channel]);
    const existingStatus = existing.status === "available" && typeof existing.projectedAt === "string"
      ? { status: "available" as const, projectedAt: existing.projectedAt }
      : { status: "available" as const, projectedAt: projectedAt.toISOString() };
    return [channel, existingStatus];
  }));
  const deliveryState = { ...current, ...projected };
  if (row.status !== "available" || JSON.stringify(current) !== JSON.stringify(deliveryState)) {
    await dependencies.db.notificationIntent.updateMany({
      where: { id: notificationId },
      data: { status: "available", deliveryState },
    });
  }
  return {
    notificationId,
    status: "available",
    deliveryState: projected as AcknowledgeLoopNotificationProjectionResult["deliveryState"],
  };
}
