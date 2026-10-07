import { KNOWLEDGE_ENTRY_TYPES, type KnowledgeEntryType } from "@humanthread/shared";

import { assertCanReadProject, assertCanWriteProject } from "./access-control";
import { knowledgeProjectDigest } from "./knowledge-reference";
import { prisma } from "./prisma";

const ENTRY_TYPES = new Set<string>(KNOWLEDGE_ENTRY_TYPES);

export interface KnowledgePolicySettings {
  projectId: string | null;
  projectDigest: string;
  autoPublishEnabled: boolean;
  minimumConfidence: number;
  allowedSourceTypes: string[];
  allowedEntryTypes: KnowledgeEntryType[];
  allowAutomaticDelete: boolean;
  allowAutomaticExpire: boolean;
  allowAutomaticSupersede: boolean;
  scheduleTimezone: string;
  scheduleRule: string | null;
  fullRebuildEvery: number;
  subscribeSpaceKnowledge: boolean;
  version: number;
  updatedAt: Date;
}

export interface UpdateKnowledgePolicySettingsInput {
  userId: string;
  projectId: string;
  expectedVersion: number;
  autoPublishEnabled: boolean;
  minimumConfidence: number;
  allowedSourceTypes: string[];
  allowedEntryTypes: string[];
  allowAutomaticDelete?: boolean;
  allowAutomaticExpire?: boolean;
  allowAutomaticSupersede?: boolean;
  subscribeSpaceKnowledge?: boolean;
}

interface KnowledgePolicySettingsDb {
  knowledgePolicy: {
    findUnique(args: { where: { projectDigest: string } }): Promise<Record<string, unknown> | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    createMany(args: { data: Array<Record<string, unknown>>; skipDuplicates: boolean }): Promise<{ count: number }>;
  };
}

const DEFAULT_DB = prisma as unknown as KnowledgePolicySettingsDb;

export async function readKnowledgePolicySettings(
  input: { userId: string; projectId: string },
  dependencies: {
    assertCanReadProject: typeof assertCanReadProject;
    db: KnowledgePolicySettingsDb;
  } = { assertCanReadProject, db: DEFAULT_DB },
): Promise<KnowledgePolicySettings | null> {
  await dependencies.assertCanReadProject({ userId: input.userId, projectId: input.projectId });
  const projectDigest = knowledgeProjectDigest(input.projectId);
  const row = await dependencies.db.knowledgePolicy.findUnique({ where: { projectDigest } });
  return row ? projectPolicy(row, projectDigest) : null;
}

export async function updateKnowledgePolicySettings(
  input: UpdateKnowledgePolicySettingsInput,
  dependencies: {
    assertCanWriteProject: typeof assertCanWriteProject;
    db: KnowledgePolicySettingsDb;
    now?: () => Date;
  } = { assertCanWriteProject, db: DEFAULT_DB },
): Promise<KnowledgePolicySettings> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw validationError("Knowledge policy version is invalid");
  }
  if (!Number.isFinite(input.minimumConfidence) || input.minimumConfidence < 0 || input.minimumConfidence > 1) {
    throw validationError("Knowledge minimum confidence must be between 0 and 1");
  }
  const allowedEntryTypes = normalizeEntryTypes(input.allowedEntryTypes);
  if (input.autoPublishEnabled && allowedEntryTypes.length === 0) {
    throw validationError("自动审核启用前至少选择一个知识类型");
  }
  const allowedSourceTypes = normalizeSourceTypes(input.allowedSourceTypes);
  if (input.autoPublishEnabled && allowedSourceTypes.length === 0) {
    throw validationError("自动审核启用前至少选择一个来源类型");
  }

  await dependencies.assertCanWriteProject({ userId: input.userId, projectId: input.projectId });
  const projectDigest = knowledgeProjectDigest(input.projectId);
  const now = dependencies.now?.() ?? new Date();
  const current = await dependencies.db.knowledgePolicy.findUnique({ where: { projectDigest } });
  if (!current) throw notFound("Knowledge policy not found");
  if (Number(current.version) !== input.expectedVersion) {
    throw versionConflict(
      `Knowledge policy changed while updating: expected version ${input.expectedVersion}, current version ${Number(current.version)}. Reload the policy and retry.`,
    );
  }

  const updated = await dependencies.db.knowledgePolicy.updateMany({
    where: { projectDigest, version: input.expectedVersion },
    data: {
      autoPublishEnabled: input.autoPublishEnabled,
      minimumConfidence: input.minimumConfidence,
      allowedSourceTypes,
      allowedEntryTypes,
      allowAutomaticDelete: input.allowAutomaticDelete ?? false,
      allowAutomaticExpire: input.allowAutomaticExpire ?? false,
      allowAutomaticSupersede: input.allowAutomaticSupersede ?? false,
      subscribeSpaceKnowledge: input.subscribeSpaceKnowledge ?? false,
      version: { increment: 1 },
      updatedAt: now,
    },
  });
  if (updated.count !== 1) {
    throw versionConflict("Knowledge policy changed while updating. Reload the policy and retry.");
  }

  const canonical = await dependencies.db.knowledgePolicy.findUnique({ where: { projectDigest } });
  if (!canonical) throw notFound("Knowledge policy not found");
  return projectPolicy(canonical, projectDigest);
}

function projectPolicy(row: Record<string, unknown>, projectDigest: string): KnowledgePolicySettings {
  return {
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    projectDigest,
    autoPublishEnabled: row.autoPublishEnabled === true,
    minimumConfidence: finiteNumber(row.minimumConfidence, 0.9),
    allowedSourceTypes: stringArray(row.allowedSourceTypes),
    allowedEntryTypes: stringArray(row.allowedEntryTypes).filter((value): value is KnowledgeEntryType => ENTRY_TYPES.has(value)),
    allowAutomaticDelete: row.allowAutomaticDelete === true,
    allowAutomaticExpire: row.allowAutomaticExpire === true,
    allowAutomaticSupersede: row.allowAutomaticSupersede === true,
    scheduleTimezone: typeof row.scheduleTimezone === "string" ? row.scheduleTimezone : "Asia/Shanghai",
    scheduleRule: typeof row.scheduleRule === "string" ? row.scheduleRule : null,
    fullRebuildEvery: finiteNumber(row.fullRebuildEvery, 10),
    subscribeSpaceKnowledge: row.subscribeSpaceKnowledge === true,
    version: finiteNumber(row.version, 1),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt ?? 0)),
  };
}

function normalizeEntryTypes(values: string[]): KnowledgeEntryType[] {
  const normalized = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (normalized.some((value) => !ENTRY_TYPES.has(value))) {
    throw validationError("Knowledge entry type is invalid");
  }
  return normalized as KnowledgeEntryType[];
}

function normalizeSourceTypes(values: string[]): string[] {
  const normalized = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (normalized.some((value) => value.length > 64)) {
    throw validationError("Knowledge source type is invalid");
  }
  return normalized;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function versionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "version_conflict" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}
