import {
  projectDevelopmentTemplateSchema,
  type OrchestrationCommand,
  type ProjectDevelopmentTemplate,
} from "@humanthread/shared";
import { createHash } from "node:crypto";
import {
  executeIdempotentCommand,
  type OrchestrationEventsTx,
} from "./orchestration-events";
import { prisma } from "./prisma";

type JsonRecord = Record<string, unknown>;
export type DevelopmentTemplateStatus = "draft" | "published" | "deprecated";

export interface DevelopmentTemplateCatalogDb extends OrchestrationEventsTx {
  projectDevelopmentTemplate: {
    findMany(args: unknown): Promise<unknown[]>;
    findUnique(args: unknown): Promise<unknown | null>;
    findFirst(args: unknown): Promise<unknown | null>;
    create(args: { data: JsonRecord }): Promise<unknown>;
    update(args: { where: JsonRecord; data: JsonRecord }): Promise<unknown>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  developmentTemplateMarketStar: {
    findUnique(args: unknown): Promise<unknown | null>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: { data: JsonRecord }): Promise<unknown>;
    delete(args: { where: JsonRecord }): Promise<unknown>;
  };
  $transaction<T>(callback: (tx: DevelopmentTemplateCatalogDb) => Promise<T>): Promise<T>;
}

export interface SaveDevelopmentTemplateDraftInput {
  id: string;
  key: string;
  version: number;
  expectedRevision?: number;
  spaceId: string;
  kind: string;
  name: string;
  description: string | null;
  sourceTemplateId: string | null;
  projectConfigSchema: unknown;
  taskFieldSchema: unknown;
  developmentLoopVersionId: string | null;
  releaseLoopVersionId: string | null;
  triggerPolicy: unknown;
  executionPolicy: unknown;
  loopGroupConfig?: unknown;
  isPublic?: boolean;
  publicAt?: Date | string | null;
  deletedAt?: Date | string | null;
  industryTags?: readonly string[];
  starCount?: number;
  actorUserId: string;
}

const DEFAULTS = { db: prisma as unknown as DevelopmentTemplateCatalogDb };
const TEMPLATE_SELECT = {
  id: true, key: true, name: true, version: true, status: true, spaceId: true,
  origin: true, kind: true, description: true, createdByUserId: true,
  sourceTemplateId: true, revision: true, projectConfigSchema: true,
  taskFieldSchema: true, developmentLoopVersionId: true, releaseLoopVersionId: true,
  triggerPolicy: true, executionPolicy: true, loopGroupConfig: true,
  isPublic: true, publicAt: true, deletedAt: true, industryTags: true, starCount: true,
} as const;

function failure(code: "not_found" | "validation_failed" | "version_conflict", message: string, currentRevision?: number): Error {
  return Object.assign(new Error(message), { code, ...(currentRevision === undefined ? {} : { currentRevision }) });
}

function templateFromRow(row: unknown): ProjectDevelopmentTemplate {
  const value = row as Record<string, unknown>;
  return projectDevelopmentTemplateSchema.parse({
    id: value.id, key: value.key, name: value.name, version: value.version,
    status: value.status, spaceId: value.spaceId, origin: value.origin, kind: value.kind,
    description: value.description, createdByUserId: value.createdByUserId,
    sourceTemplateId: value.sourceTemplateId, revision: value.revision,
    projectConfigSchema: value.projectConfigSchema, taskFieldSchema: value.taskFieldSchema,
    developmentLoopVersionId: value.developmentLoopVersionId,
    releaseLoopVersionId: value.releaseLoopVersionId, triggerPolicy: value.triggerPolicy,
    executionPolicy: value.executionPolicy,
    isPublic: value.isPublic ?? false,
    publicAt: value.publicAt ?? null,
    deletedAt: value.deletedAt ?? null,
    industryTags: Array.isArray(value.industryTags) ? value.industryTags : [],
    starCount: typeof value.starCount === "number" ? value.starCount : 0,
    ...(value.loopGroupConfig === undefined || value.loopGroupConfig === null ? {} : { loopGroupConfig: value.loopGroupConfig }),
  });
}

export async function readDevelopmentTemplate(
  input: { templateId: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate | null> {
  const row = await dependencies.db.projectDevelopmentTemplate.findUnique({
    where: { id: input.templateId }, select: TEMPLATE_SELECT,
  });
  return row ? templateFromRow(row) : null;
}

export async function listDevelopmentTemplatesForSpace(
  input: { spaceId: string; statuses: DevelopmentTemplateStatus[] },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate[]> {
  const rows = await dependencies.db.projectDevelopmentTemplate.findMany({
    where: { OR: [
      { spaceId: input.spaceId, status: { in: input.statuses }, deletedAt: null },
      { origin: "platform", status: "published", deletedAt: null },
    ] },
    orderBy: [{ key: "asc" }, { version: "desc" }],
    select: TEMPLATE_SELECT,
  });
  return rows.map(templateFromRow);
}

export async function listPublicDevelopmentTemplates(
  input: { sort: "published" | "stars"; actorUserId?: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate[]> {
  const rows = await dependencies.db.projectDevelopmentTemplate.findMany({
    where: { OR: [
      { origin: "platform", status: "published", deletedAt: null },
      { origin: "space", status: { not: "deprecated" }, isPublic: true, deletedAt: null },
    ] },
    orderBy: input.sort === "stars"
      ? [{ starCount: "desc" }, { publicAt: "desc" }, { id: "asc" }]
      : [{ publicAt: "desc" }, { starCount: "desc" }, { id: "asc" }],
    select: TEMPLATE_SELECT,
  });
  return rows.map(templateFromRow);
}

export async function setDevelopmentTemplateMarketVisibility(
  input: { templateId: string; expectedRevision: number; isPublic: boolean; industryTags: readonly string[]; publicAt?: Date | null },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<void> {
  const updated = await dependencies.db.projectDevelopmentTemplate.updateMany({
    where: { id: input.templateId, origin: "space", revision: input.expectedRevision, deletedAt: null },
    data: {
      isPublic: input.isPublic,
      publicAt: input.isPublic ? (input.publicAt ?? new Date()) : null,
      industryTags: [...input.industryTags],
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw failure("version_conflict", "Loop 模板已发生变化");
}

export async function deleteDevelopmentTemplate(
  input: { templateId: string; expectedRevision: number },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<void> {
  const updated = await dependencies.db.projectDevelopmentTemplate.updateMany({
    where: { id: input.templateId, origin: "space", revision: input.expectedRevision, deletedAt: null },
    data: { status: "deprecated", isPublic: false, publicAt: null, deletedAt: new Date(), revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw failure("version_conflict", "Loop 模板已发生变化");
}

export async function toggleDevelopmentTemplateMarketStar(
  input: { templateId: string; userId: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<{ starred: boolean; starCount: number }> {
  const templateDigest = digest(input.templateId);
  const userDigest = digest(input.userId);
  const existing = await dependencies.db.developmentTemplateMarketStar.findUnique({ where: { templateDigest_userDigest: { templateDigest, userDigest } } });
  const template = await dependencies.db.projectDevelopmentTemplate.findUnique({ where: { id: input.templateId }, select: { isPublic: true, status: true, deletedAt: true, starCount: true } }) as { isPublic?: boolean; status?: string; deletedAt?: Date | null; starCount?: number } | null;
  if (!template || template.isPublic !== true || template.deletedAt) throw failure("not_found", "Loop 模板未公开或已删除");
  if (existing) {
    await dependencies.db.developmentTemplateMarketStar.delete({ where: { templateDigest_userDigest: { templateDigest, userDigest } } });
    const next = Math.max(0, (template.starCount ?? 0) - 1);
    await dependencies.db.projectDevelopmentTemplate.update({ where: { id: input.templateId }, data: { starCount: next } });
    return { starred: false, starCount: next };
  }
  await dependencies.db.developmentTemplateMarketStar.create({ data: { id: digest(`star\0${input.templateId}\0${input.userId}`), templateDigest, userDigest } });
  const next = (template.starCount ?? 0) + 1;
  await dependencies.db.projectDevelopmentTemplate.update({ where: { id: input.templateId }, data: { starCount: next } });
  return { starred: true, starCount: next };
}

export async function listStarredDevelopmentTemplateIds(
  input: { templateIds: readonly string[]; userId: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<string[]> {
  const digestToId = new Map(input.templateIds.map((templateId) => [digest(templateId), templateId]));
  if (digestToId.size === 0) return [];
  const rows = await dependencies.db.developmentTemplateMarketStar.findMany({
    where: { templateDigest: { in: [...digestToId.keys()] }, userDigest: digest(input.userId) },
    select: { templateDigest: true },
  });
  return rows.flatMap((row) => {
    const value = row as { templateDigest?: unknown };
    return typeof value.templateDigest === "string" && digestToId.has(value.templateDigest) ? [digestToId.get(value.templateDigest)!] : [];
  });
}

export async function createDevelopmentTemplateDraft(
  input: SaveDevelopmentTemplateDraftInput,
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate> {
  const existing = await dependencies.db.projectDevelopmentTemplate.findUnique({
    where: { key_version: { key: input.key, version: input.version } }, select: TEMPLATE_SELECT,
  });
  if (existing) throw failure("validation_failed", "Development template version already exists");
  const latest = await dependencies.db.projectDevelopmentTemplate.findFirst({
    where: { key: input.key, spaceId: input.spaceId, origin: "space" },
    orderBy: { version: "desc" }, select: { version: true },
  }) as { version?: number } | null;
  if (latest?.version !== undefined && input.version !== latest.version + 1) {
    throw failure("validation_failed", `Development template version must be ${latest.version + 1}`);
  }
  const row = await dependencies.db.projectDevelopmentTemplate.create({ data: {
    id: input.id, key: input.key, version: input.version, status: "draft", spaceId: input.spaceId,
    origin: "space", kind: input.kind, name: input.name, description: input.description,
    createdByUserId: input.actorUserId, sourceTemplateId: input.sourceTemplateId, revision: 1,
    projectConfigSchema: input.projectConfigSchema, taskFieldSchema: input.taskFieldSchema,
    developmentLoopVersionId: input.developmentLoopVersionId,
    releaseLoopVersionId: input.releaseLoopVersionId, triggerPolicy: input.triggerPolicy,
    executionPolicy: input.executionPolicy, loopGroupConfig: input.loopGroupConfig ?? null,
    isPublic: input.isPublic ?? false, publicAt: input.publicAt ?? null, deletedAt: input.deletedAt ?? null,
    industryTags: input.industryTags ?? [], starCount: input.starCount ?? 0,
  } });
  return templateFromRow(row);
}

export async function copyDevelopmentTemplate(
  input: Omit<SaveDevelopmentTemplateDraftInput, "sourceTemplateId"> & { sourceTemplateId: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate> {
  return createDevelopmentTemplateDraft(input, dependencies);
}

export async function updateDevelopmentTemplateDraft(
  input: SaveDevelopmentTemplateDraftInput & { expectedRevision: number; commandId: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate> {
  const result = { ...templateFromInput(input), status: "draft" as const, origin: "space" as const, revision: input.expectedRevision + 1 };
  return executeIdempotentCommand({
    command: templateCommand(input, "update"),
    aggregate: { type: "loop", id: input.id },
    db: dependencies.db,
    apply: async () => ({
      result,
      events: [],
      persist: async (tx) => {
        const updated = await tx.projectDevelopmentTemplate.updateMany({
          where: { id: input.id, revision: input.expectedRevision, deletedAt: null },
          data: {
            key: input.key, version: input.version, kind: input.kind, name: input.name,
            description: input.description, sourceTemplateId: input.sourceTemplateId,
            projectConfigSchema: input.projectConfigSchema, taskFieldSchema: input.taskFieldSchema,
            developmentLoopVersionId: input.developmentLoopVersionId,
            releaseLoopVersionId: input.releaseLoopVersionId, triggerPolicy: input.triggerPolicy,
            executionPolicy: input.executionPolicy, loopGroupConfig: input.loopGroupConfig ?? null,
            isPublic: input.isPublic ?? false, publicAt: input.publicAt ?? null, deletedAt: input.deletedAt ?? null,
            industryTags: input.industryTags ?? [], revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          const current = await readDevelopmentTemplate({ templateId: input.id }, { db: tx });
          if (!current) throw failure("not_found", "Development template not found");
          throw failure("version_conflict", "Development template changed", current.revision);
        }
        return 1;
      },
    }),
  });
}

export async function publishDevelopmentTemplate(
  input: { templateId: string; expectedRevision: number; actorUserId: string; commandId: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate> {
  return executeIdempotentCommand({
    command: templateCommand(input, "publish"),
    aggregate: { type: "loop", id: input.templateId },
    db: dependencies.db,
    apply: async (tx) => {
      const current = await readDevelopmentTemplate({ templateId: input.templateId }, { db: tx });
      if (!current) throw failure("not_found", "Development template not found");
      if (current.status !== "draft") throw failure("validation_failed", "Only draft development templates can be published");
      const result = { ...current, status: "published" as const, revision: input.expectedRevision + 1 };
      return {
        result,
        events: [],
        persist: async (currentTx) => {
          const updated = await currentTx.projectDevelopmentTemplate.updateMany({
            where: { id: input.templateId, status: "draft", revision: input.expectedRevision },
            data: { status: "published", revision: { increment: 1 } },
          });
          if (updated.count !== 1) {
            const current = await readDevelopmentTemplate({ templateId: input.templateId }, { db: currentTx });
            if (!current) throw failure("not_found", "Development template not found");
            throw failure("version_conflict", "Development template changed", current.revision);
          }
          return 1;
        },
      };
    },
  });
}

export async function deprecateDevelopmentTemplate(
  input: { templateId: string; expectedRevision: number; actorUserId: string; commandId: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate> {
  return executeIdempotentCommand({
    command: templateCommand(input, "deprecate"),
    aggregate: { type: "loop", id: input.templateId },
    db: dependencies.db,
    apply: async (tx) => {
      const current = await readDevelopmentTemplate({ templateId: input.templateId }, { db: tx });
      if (!current) throw failure("not_found", "Development template not found");
      if (current.status !== "published") throw failure("validation_failed", "Only published development templates can be deprecated");
      const result = { ...current, status: "deprecated" as const, revision: input.expectedRevision + 1 };
      return {
        result,
        events: [],
        persist: async (currentTx) => {
          const updated = await currentTx.projectDevelopmentTemplate.updateMany({
            where: { id: input.templateId, status: "published", revision: input.expectedRevision },
            data: { status: "deprecated", isPublic: false, deletedAt: new Date(), revision: { increment: 1 } },
          });
          if (updated.count !== 1) {
            const current = await readDevelopmentTemplate({ templateId: input.templateId }, { db: currentTx });
            if (!current) throw failure("not_found", "Development template not found");
            throw failure("version_conflict", "Development template changed", current.revision);
          }
          return 1;
        },
      };
    },
  });
}

export async function compareDevelopmentTemplateVersions(
  input: { templateId: string; fromVersion: number; toVersion: number; spaceId: string },
  dependencies: { db: DevelopmentTemplateCatalogDb } = DEFAULTS,
) {
  const selectedRow = await dependencies.db.projectDevelopmentTemplate.findUnique({
    where: { id: input.templateId }, select: TEMPLATE_SELECT,
  });
  if (!selectedRow) throw failure("not_found", "Development template not found");
  const selected = templateFromRow(selectedRow);
  if (selected.origin !== "platform" && selected.spaceId !== input.spaceId) {
    throw failure("not_found", "Development template not found");
  }
  const readVersion = async (version: number) => {
    const row = await dependencies.db.projectDevelopmentTemplate.findUnique({
      where: { key_version: { key: selected.key, version } }, select: TEMPLATE_SELECT,
    });
    if (!row) throw failure("not_found", "Development template version not found");
    const value = templateFromRow(row);
    if (value.origin !== "platform" && value.spaceId !== input.spaceId) throw failure("not_found", "Development template version not found");
    return value;
  };
  const [from, to] = await Promise.all([readVersion(input.fromVersion), readVersion(input.toVersion)]);
  return { from, to, changedConfigKeys: changedKeys(from.projectConfigSchema, to.projectConfigSchema), loopVersions: {
    from: [from.developmentLoopVersionId, from.releaseLoopVersionId],
    to: [to.developmentLoopVersionId, to.releaseLoopVersionId],
  } };
}

function templateFromInput(input: SaveDevelopmentTemplateDraftInput): ProjectDevelopmentTemplate {
  return projectDevelopmentTemplateSchema.parse({
    id: input.id, key: input.key, version: input.version, spaceId: input.spaceId, kind: input.kind,
    name: input.name, description: input.description, sourceTemplateId: input.sourceTemplateId,
    projectConfigSchema: input.projectConfigSchema, taskFieldSchema: input.taskFieldSchema,
    developmentLoopVersionId: input.developmentLoopVersionId, releaseLoopVersionId: input.releaseLoopVersionId,
    triggerPolicy: input.triggerPolicy, executionPolicy: input.executionPolicy, loopGroupConfig: input.loopGroupConfig ?? null,
    isPublic: input.isPublic ?? false, publicAt: input.publicAt ?? null, deletedAt: input.deletedAt ?? null,
    industryTags: input.industryTags ?? [], starCount: input.starCount ?? 0,
    status: "draft", origin: "space", createdByUserId: input.actorUserId,
    revision: input.expectedRevision ?? 1,
  });
}

function digest(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function templateCommand(
  input: { commandId: string; actorUserId: string; expectedRevision: number; id?: string; templateId?: string },
  operation: "update" | "publish" | "deprecate",
): OrchestrationCommand<unknown> {
  const templateId = input.id ?? input.templateId;
  if (!templateId) throw failure("validation_failed", "Development template command requires a template ID");
  return {
    commandId: input.commandId,
    correlationId: `development_template:${templateId}`,
    actor: { type: "user", id: input.actorUserId },
    expectedVersion: input.expectedRevision,
    payload: { operation },
    issuedAt: new Date(),
  };
}

function changedKeys(from: unknown, to: unknown): string[] {
  const left = isRecord(from) ? from : {};
  const right = isRecord(to) ? to : {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
