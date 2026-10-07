import { derivedPersistenceId } from "./bounded-id";
import { prisma } from "./prisma";
import { isPrismaUniqueConstraintError } from "./prisma-errors";

type SourceRow = {
  id: string;
  ownerType: string;
  companyId: string | null;
  name: string;
  repository: string;
  status: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type VersionRow = {
  id: string;
  sourceId: string;
  tag: string;
  digest: string;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type WorkerImageCatalogDb = {
  $transaction<T>(callback: (tx: WorkerImageCatalogDb) => Promise<T>): Promise<T>;
  workerImageSource: {
    findFirst(args: { where: Record<string, unknown> }): Promise<SourceRow | null>;
    findMany(args: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<SourceRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<SourceRow>;
  };
  workerImageVersion: {
    findFirst(args: { where: Record<string, unknown> }): Promise<VersionRow | null>;
    findMany(args: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<VersionRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<VersionRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  project: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; version: number; ownerType: string; companyId: string | null } | null>;
    updateMany(args: { where: { id: string; version: number }; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
};

const defaultDependencies = { db: prisma as unknown as WorkerImageCatalogDb, createId: derivedPersistenceId };
const WORKER_IMAGE_REPOSITORY_MAX_LENGTH = 767;

export type WorkerImageCatalogScope =
  | { ownerType: "platform"; companyId: null }
  | { ownerType: "company"; companyId: string };

export type AvailableWorkerImageSource = {
  id: string;
  ownerType: "platform" | "company";
  companyId: string | null;
  name: string;
  repository: string;
  versions: Array<{ id: string; tag: string; digest: string; publishedAt: string | null }>;
};

export type WorkerImageCatalogSource = {
  id: string;
  ownerType: "platform" | "company";
  companyId: string | null;
  name: string;
  repository: string;
  status: "active" | "disabled";
  versions: Array<{
    id: string;
    tag: string;
    digest: string;
    status: "active" | "disabled";
    publishedAt: string | null;
  }>;
};

export async function createWorkerImageSource(
  input: { actorUserId: string; scope?: WorkerImageCatalogScope; name: string; repository: string; status?: "active" | "disabled"; now: Date },
  dependencies: { db: WorkerImageCatalogDb; createId?: typeof derivedPersistenceId } = defaultDependencies,
): Promise<SourceRow> {
  const actorUserId = required(input.actorUserId, "actorUserId", 64);
  const scope = normalizeCatalogScope(input.scope ?? { ownerType: "platform", companyId: null });
  const name = required(input.name, "name", 191);
  const repository = required(input.repository, "repository", WORKER_IMAGE_REPOSITORY_MAX_LENGTH);
  const now = date(input.now);
  const id = (dependencies.createId ?? derivedPersistenceId)([
    "worker-image-source",
    scope.ownerType,
    scope.companyId ?? "",
    repository,
  ]);
  md5(id, "Worker image source ID");
  return dependencies.db.$transaction(async (tx) => {
    if (await tx.workerImageSource.findFirst({ where: { ...scope, repository } })) {
      throw failure("validation_failed", "Worker 镜像来源已存在");
    }
    try {
      return await tx.workerImageSource.create({ data: { id, ...scope, name, repository, status: input.status ?? "active", createdByUserId: actorUserId, createdAt: now, updatedAt: now } });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw failure("validation_failed", "Worker 镜像来源已存在");
      }
      throw error;
    }
  });
}

export async function createWorkerImageVersion(
  input: {
    sourceId: string;
    scope?: WorkerImageCatalogScope;
    tag: string;
    digest: string;
    status?: "active" | "disabled";
    publishedAt?: Date;
    now: Date;
  },
  dependencies: { db: WorkerImageCatalogDb; createId?: typeof derivedPersistenceId } = defaultDependencies,
): Promise<VersionRow> {
  md5(input.sourceId, "Worker image source ID");
  const tag = required(input.tag, "tag", 191);
  const digest = input.digest.trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) throw failure("validation_failed", "Worker 镜像 Digest 无效");
  const now = date(input.now);
  const id = (dependencies.createId ?? derivedPersistenceId)(["worker-image-version", input.sourceId, digest]);
  md5(id, "Worker image version ID");
  return dependencies.db.$transaction(async (tx) => {
    const source = await tx.workerImageSource.findFirst({
      where: {
        id: input.sourceId,
        ...(input.scope === undefined ? {} : normalizeCatalogScope(input.scope)),
      },
    });
    if (!source) throw failure("validation_failed", "Worker 镜像来源不存在");
    if (await tx.workerImageVersion.findFirst({ where: { digest } })) throw failure("validation_failed", "Worker 镜像 Digest 已存在");
    return tx.workerImageVersion.create({ data: { id, sourceId: input.sourceId, tag, digest, status: input.status ?? "active", publishedAt: input.publishedAt ?? now, createdAt: now, updatedAt: now } });
  });
}

export async function listAvailableWorkerImages(
  input: { companyId?: string | null },
  dependencies: { db: WorkerImageCatalogDb } = defaultDependencies,
): Promise<AvailableWorkerImageSource[]> {
  const companyId = input.companyId?.trim() || null;
  return dependencies.db.$transaction(async (tx) => {
    const [sources, versions] = await Promise.all([
      tx.workerImageSource.findMany({
        where: {
          status: "active",
          OR: [
            { ownerType: "platform", companyId: null },
            ...(companyId ? [{ ownerType: "company", companyId }] : []),
          ],
        },
        orderBy: [{ ownerType: "desc" }, { name: "asc" }, { id: "asc" }],
      }),
      tx.workerImageVersion.findMany({ where: { status: "active" }, orderBy: [{ publishedAt: "desc" }, { id: "asc" }] }),
    ]);
    return sources.map((source) => ({
      id: source.id,
      ownerType: source.ownerType === "company" ? "company" as const : "platform" as const,
      companyId: source.companyId,
      name: source.name,
      repository: source.repository,
      versions: versions.filter((version) => version.sourceId === source.id).map((version) => ({ id: version.id, tag: version.tag, digest: version.digest, publishedAt: version.publishedAt?.toISOString() ?? null })),
    })).filter((source) => source.versions.length > 0);
  });
}

export async function listWorkerImageCatalog(
  input: { scope: WorkerImageCatalogScope },
  dependencies: { db: WorkerImageCatalogDb } = defaultDependencies,
): Promise<WorkerImageCatalogSource[]> {
  const scope = normalizeCatalogScope(input.scope);
  return dependencies.db.$transaction(async (tx) => {
    const [sources, versions] = await Promise.all([
      tx.workerImageSource.findMany({
        where: scope,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      tx.workerImageVersion.findMany({ orderBy: [{ publishedAt: "desc" }, { id: "asc" }] }),
    ]);
    return sources.map((source) => ({
      id: source.id,
      ownerType: source.ownerType === "company" ? "company" : "platform",
      companyId: source.companyId,
      name: source.name,
      repository: source.repository,
      status: source.status === "disabled" ? "disabled" : "active",
      versions: versions
        .filter((version) => version.sourceId === source.id)
        .map((version) => ({
          id: version.id,
          tag: version.tag,
          digest: version.digest,
          status: version.status === "disabled" ? "disabled" : "active",
          publishedAt: version.publishedAt?.toISOString() ?? null,
        })),
    }));
  });
}

export async function setWorkerImageVersionStatus(
  input: {
    versionId: string;
    status: "active" | "disabled";
    scope: WorkerImageCatalogScope;
    now: Date;
  },
  dependencies: { db: WorkerImageCatalogDb } = defaultDependencies,
): Promise<{ id: string; status: "active" | "disabled" }> {
  const versionId = input.versionId;
  md5(versionId, "Worker image version ID");
  const scope = normalizeCatalogScope(input.scope);
  const now = date(input.now);
  if (input.status !== "active" && input.status !== "disabled") throw failure("validation_failed", "Worker 镜像版本状态无效");
  return dependencies.db.$transaction(async (tx) => {
    const version = await tx.workerImageVersion.findFirst({ where: { id: versionId } });
    if (!version) throw failure("validation_failed", "Worker 镜像版本不存在");
    const source = await tx.workerImageSource.findFirst({ where: { id: version.sourceId, ...scope } });
    if (!source) throw failure("validation_failed", "Worker 镜像版本不在当前管理范围");
    const updated = await tx.workerImageVersion.updateMany({
      where: { id: versionId, sourceId: source.id },
      data: { status: input.status, updatedAt: now },
    });
    if (updated.count !== 1) throw failure("validation_failed", "Worker 镜像版本状态更新失败");
    return { id: versionId, status: input.status };
  });
}

export async function selectProjectWorkerImageVersion(
  input: { projectId: string; expectedVersion: number; workerImageVersionId: string },
  dependencies: { db: WorkerImageCatalogDb } = defaultDependencies,
): Promise<{ projectId: string; version: number; workerImageVersionId: string }> {
  const projectId = required(input.projectId, "projectId", 64);
  md5(input.workerImageVersionId, "Worker image version ID");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw failure("validation_failed", "项目版本无效");
  return dependencies.db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw failure("not_found", "项目不存在");
    const version = await tx.workerImageVersion.findFirst({ where: { id: input.workerImageVersionId, status: "active" } });
    if (!version) throw failure("validation_failed", "Worker 镜像版本不可用");
    const source = await tx.workerImageSource.findFirst({
      where: {
        id: version.sourceId,
        status: "active",
        OR: [
          { ownerType: "platform", companyId: null },
          ...(project.ownerType === "company" && project.companyId
            ? [{ ownerType: "company", companyId: project.companyId }]
            : []),
        ],
      },
    });
    if (!source) throw failure("validation_failed", "Worker 镜像来源不可用");
    const updated = await tx.project.updateMany({ where: { id: projectId, version: input.expectedVersion }, data: { workerImageVersionId: version.id, version: { increment: 1 } } });
    if (updated.count !== 1) throw failure("version_conflict", "项目已被其他操作更新");
    return { projectId, version: input.expectedVersion + 1, workerImageVersionId: version.id };
  });
}

function required(value: string, name: string, max: number) { const result = value.trim(); if (!result || result.length > max) throw failure("validation_failed", `${name} 无效`); return result; }
function normalizeCatalogScope(scope: WorkerImageCatalogScope): WorkerImageCatalogScope {
  if (scope.ownerType === "platform") {
    if (scope.companyId !== null) throw failure("validation_failed", "平台镜像作用域无效");
    return scope;
  }
  const companyId = required(scope.companyId, "companyId", 64);
  return { ownerType: "company", companyId };
}
function md5(value: string, name: string) { if (!/^[a-f0-9]{32}$/u.test(value)) throw failure("validation_failed", `${name} 必须为 32 位 MD5`); }
function date(value: Date) { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw failure("validation_failed", "时间无效"); return value; }
function failure(code: "validation_failed" | "not_found" | "version_conflict", message: string) { return Object.assign(new Error(message), { code }); }
