import { createHash } from "node:crypto";
import {
  milestoneReleaseSnapshotSchema,
  projectDevelopmentTemplateSchema,
  type MilestoneReleaseSnapshot,
  type OrchestrationCommand,
  type ProjectDevelopmentTemplate,
} from "@humanthread/shared";
import { boundedPersistenceId } from "./bounded-id";
import {
  executeIdempotentCommand,
  OrchestrationPersistenceError,
  type OrchestrationEventsTx,
} from "./orchestration-events";
import { prisma } from "./prisma";
import { listDevelopmentTemplatesForSpace } from "./development-template-catalog";

type JsonRecord = Record<string, unknown>;

interface DevelopmentModeDb extends OrchestrationEventsTx {
  projectDevelopmentTemplate: {
    findMany(args: unknown): Promise<unknown[]>;
    findUnique(args: unknown): Promise<unknown | null>;
    findFirst(args: unknown): Promise<unknown | null>;
  };
  milestoneReleaseSnapshot: {
    findUnique(args: unknown): Promise<SnapshotRow | null>;
    create(args: { data: JsonRecord }): Promise<SnapshotRow>;
  };
  $transaction<T>(callback: (tx: DevelopmentModeDb) => Promise<T>): Promise<T>;
}

interface SnapshotRow {
  id: string;
  projectId: string;
  milestoneId: string;
  loopRunId: string;
  triggerType: string;
  snapshot: unknown;
  checksum: string;
  stagingBaseCommit: string;
  productionBaseCommit: string;
  createdAt?: Date | string;
}

const DEFAULTS = { db: prisma as unknown as DevelopmentModeDb };
const TEMPLATE_SELECT = {
  id: true,
  key: true,
  name: true,
  version: true,
  status: true,
  spaceId: true,
  origin: true,
  kind: true,
  description: true,
  createdByUserId: true,
  sourceTemplateId: true,
  revision: true,
  projectConfigSchema: true,
  taskFieldSchema: true,
  developmentLoopVersionId: true,
  releaseLoopVersionId: true,
  triggerPolicy: true,
  executionPolicy: true,
  isPublic: true,
  publicAt: true,
  deletedAt: true,
  industryTags: true,
  starCount: true,
} as const;

function projectDevelopmentTemplateFromRow(row: unknown): ProjectDevelopmentTemplate {
  const template = row as Record<string, unknown>;
  return projectDevelopmentTemplateSchema.parse({
    id: template.id,
    key: template.key,
    name: template.name,
    version: template.version,
    status: template.status,
    spaceId: template.spaceId,
    origin: template.origin,
    kind: template.kind,
    description: template.description,
    createdByUserId: template.createdByUserId,
    sourceTemplateId: template.sourceTemplateId,
    revision: template.revision,
    projectConfigSchema: template.projectConfigSchema,
    taskFieldSchema: template.taskFieldSchema,
    developmentLoopVersionId: template.developmentLoopVersionId,
    releaseLoopVersionId: template.releaseLoopVersionId,
    triggerPolicy: template.triggerPolicy,
    executionPolicy: template.executionPolicy,
    isPublic: template.isPublic ?? false,
    publicAt: template.publicAt ?? null,
    deletedAt: template.deletedAt ?? null,
    industryTags: Array.isArray(template.industryTags) ? template.industryTags : [],
    starCount: typeof template.starCount === "number" ? template.starCount : 0,
  });
}

export async function listPublishedDevelopmentTemplates(
  input: { spaceId: string },
  dependencies: { db: DevelopmentModeDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate[]> {
  return listDevelopmentTemplatesForSpace({ spaceId: input.spaceId, statuses: ["published"] }, { db: dependencies.db as never });
}

export async function getPublishedDevelopmentTemplate(
  input: { key: string; version?: number; spaceId: string },
  dependencies: { db: DevelopmentModeDb } = DEFAULTS,
): Promise<ProjectDevelopmentTemplate | null> {
  const row = input.version === undefined
    ? await dependencies.db.projectDevelopmentTemplate.findFirst({
        where: { key: input.key, status: "published", OR: [{ origin: "platform" }, { spaceId: input.spaceId }] },
        orderBy: { version: "desc" },
        select: TEMPLATE_SELECT,
      })
    : await dependencies.db.projectDevelopmentTemplate.findUnique({
        where: { key_version: { key: input.key, version: input.version } },
        select: TEMPLATE_SELECT,
      });
  if (!row) return null;
  const parsed = projectDevelopmentTemplateFromRow(row);
  return parsed.status === "published" && parsed.key === input.key
    && (parsed.origin === "platform" || parsed.spaceId === input.spaceId)
    && (input.version === undefined || parsed.version === input.version)
    ? parsed
    : null;
}

export type CreateMilestoneReleaseSnapshotInput = MilestoneReleaseSnapshot & {
  command: OrchestrationCommand<unknown>;
  id?: string;
  loopRunId: string;
};

type MilestoneReleaseSnapshotResult = MilestoneReleaseSnapshot & {
  id: string;
  loopRunId: string;
  checksum: string;
};

export async function createMilestoneReleaseSnapshot(
  input: CreateMilestoneReleaseSnapshotInput,
  dependencies: { db: DevelopmentModeDb } = DEFAULTS,
): Promise<MilestoneReleaseSnapshotResult> {
  const { command, id: requestedId, loopRunId, ...snapshotInput } = input;
  const id = requestedId ?? boundedPersistenceId("release-snapshot", [loopRunId], 96);
  const parsed = milestoneReleaseSnapshotSchema.parse(snapshotInput);
  const checksum = checksumJson(parsed);

  return executeIdempotentCommand({
    command,
    aggregate: { type: "run", id: loopRunId },
    db: dependencies.db,
    apply: async (tx) => {
      const existing = await tx.milestoneReleaseSnapshot.findUnique({ where: { id } })
        ?? await tx.milestoneReleaseSnapshot.findUnique({ where: { loopRunId } });
      if (existing) {
        if (existing.id !== id || existing.loopRunId !== loopRunId || existing.checksum !== checksum) {
          throw new OrchestrationPersistenceError(
            "validation_failed",
            `Milestone release snapshot is immutable: ${id}`,
          );
        }
        return { result: snapshotResult(existing), events: [], persist: async () => undefined };
      }

      const result = { id, loopRunId, checksum, ...parsed };
      return {
        result,
        events: [],
        persist: async (currentTx) => {
          await currentTx.milestoneReleaseSnapshot.create({
            data: {
              id,
              projectId: parsed.projectId,
              milestoneId: parsed.milestoneId,
              loopRunId,
              triggerType: parsed.triggerType,
              snapshot: parsed,
              checksum,
              stagingBaseCommit: parsed.stagingBaseCommit,
              productionBaseCommit: parsed.productionBaseCommit,
              createdAt: new Date(parsed.createdAt),
            },
          });
          return 1;
        },
      };
    },
  });
}

export async function getMilestoneReleaseSnapshot(
  input: { id: string },
  dependencies: { db: DevelopmentModeDb } = DEFAULTS,
): Promise<MilestoneReleaseSnapshotResult | null> {
  const row = await dependencies.db.milestoneReleaseSnapshot.findUnique({ where: { id: input.id } });
  return row ? snapshotResult(row) : null;
}

function snapshotResult(row: SnapshotRow): MilestoneReleaseSnapshotResult {
  const parsed = milestoneReleaseSnapshotSchema.parse(row.snapshot);
  return { id: row.id, loopRunId: row.loopRunId, checksum: row.checksum, ...parsed };
}

function checksumJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
