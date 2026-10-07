import { createHash } from "node:crypto";
import { assertCanReadProject, assertCanWriteProject } from "./access-control";
import { derivedPersistenceId } from "./bounded-id";
import { decryptWorkerSecret, encryptWorkerSecret } from "./worker-pools";
import { prisma } from "./prisma";

type SecretRow = {
  id: string;
  projectDigest: string;
  name: string;
  encryptedValue: string;
  valueFingerprint: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

interface SecretTx {
  projectEnvironmentSecret: {
    findUnique(input: unknown): Promise<SecretRow | null>;
    findMany(input: unknown): Promise<SecretRow[]>;
    create(input: { data: Record<string, unknown> }): Promise<SecretRow>;
    updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

interface SecretDb { $transaction<T>(callback: (tx: SecretTx) => Promise<T>): Promise<T> }

export interface ProjectEnvironmentSecretDependencies {
  db: SecretDb;
  encryptionKey: string;
  assertCanReadProject: typeof assertCanReadProject;
  assertCanWriteProject: typeof assertCanWriteProject;
  createId: (parts: readonly string[]) => string;
  now: Date;
}

const DEFAULT_DEPENDENCIES: ProjectEnvironmentSecretDependencies = {
  db: prisma as unknown as SecretDb,
  encryptionKey: process.env.HUMANTHREAD_PROJECT_ENVIRONMENT_SECRET_ENCRYPTION_KEY ?? process.env.HUMANTHREAD_WORKER_MODEL_SITE_ENCRYPTION_KEY ?? "",
  assertCanReadProject,
  assertCanWriteProject,
  createId: derivedPersistenceId,
  now: new Date(),
};

export type SecretMetadata = {
  id: string;
  projectId: string;
  name: string;
  fingerprint: string;
  status: "configured" | "revoked";
  version: number;
  createdAt: string;
  updatedAt: string;
};

function projectDigest(projectId: string): string {
  const value = projectId.trim();
  if (!value || value.length > 96) throw new Error("Project identifier is invalid");
  return createHash("md5").update(value).digest("hex");
}

function secretName(value: string): string {
  const name = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/u.test(name) || name.length > 191) throw new Error("环境变量名无效");
  return name;
}

function secretValue(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 32_768) throw new Error("凭证值无效");
  return normalized;
}

function uniqueSecretNames(values: readonly string[]): string[] {
  return [...new Set(values.map(secretName))];
}

function validNow(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("时间无效");
  return value;
}

function metadata(row: SecretRow, projectId: string): SecretMetadata {
  return {
    id: row.id,
    projectId,
    name: row.name,
    fingerprint: row.valueFingerprint,
    status: row.status === "active" ? "configured" : "revoked",
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function deps(input: Partial<ProjectEnvironmentSecretDependencies> | undefined): ProjectEnvironmentSecretDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...(input ?? {}), now: input?.now ?? new Date() };
}

export async function createProjectEnvironmentSecret(input: { projectId: string; name: string; value: string; actorUserId: string }, dependencies?: Partial<ProjectEnvironmentSecretDependencies>): Promise<SecretMetadata> {
  const resolved = deps(dependencies);
  await resolved.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const digest = projectDigest(input.projectId);
  const name = secretName(input.name);
  const value = secretValue(input.value);
  const now = validNow(resolved.now);
  const encryptedValue = encryptWorkerSecret(value, resolved.encryptionKey, "HUMANTHREAD_PROJECT_ENVIRONMENT_SECRET_ENCRYPTION_KEY");
  const row = await resolved.db.$transaction(async (tx) => {
    const existing = await tx.projectEnvironmentSecret.findUnique({ where: { projectDigest_name: { projectDigest: digest, name } } });
    if (existing && existing.status === "active") throw new Error("环境凭证已存在，请使用轮换");
    const data = {
      id: resolved.createId(["project-environment-secret", digest, name]),
      projectDigest: digest,
      name,
      encryptedValue,
      valueFingerprint: createHash("sha256").update(value).digest("hex"),
      status: "active",
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revokedAt: null,
    };
    if (existing) {
      await tx.projectEnvironmentSecret.updateMany({ where: { projectDigest: digest, name }, data });
      return { ...existing, ...data } as SecretRow;
    }
    return tx.projectEnvironmentSecret.create({ data });
  });
  return metadata(row, input.projectId);
}

export async function rotateProjectEnvironmentSecret(input: { projectId: string; name: string; value: string; actorUserId: string }, dependencies?: Partial<ProjectEnvironmentSecretDependencies>): Promise<SecretMetadata> {
  const resolved = deps(dependencies);
  await resolved.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const digest = projectDigest(input.projectId);
  const name = secretName(input.name);
  const value = secretValue(input.value);
  const now = validNow(resolved.now);
  const encryptedValue = encryptWorkerSecret(value, resolved.encryptionKey, "HUMANTHREAD_PROJECT_ENVIRONMENT_SECRET_ENCRYPTION_KEY");
  const row = await resolved.db.$transaction(async (tx) => {
    const existing = await tx.projectEnvironmentSecret.findUnique({ where: { projectDigest_name: { projectDigest: digest, name } } });
    if (!existing) throw new Error("环境凭证不存在");
    const updated = await tx.projectEnvironmentSecret.updateMany({ where: { projectDigest: digest, name, status: "active" }, data: { encryptedValue, valueFingerprint: createHash("sha256").update(value).digest("hex"), version: { increment: 1 }, updatedAt: now, revokedAt: null } });
    if (updated.count !== 1) throw new Error("环境凭证不可用");
    return { ...existing, encryptedValue, valueFingerprint: createHash("sha256").update(value).digest("hex"), version: existing.version + 1, updatedAt: now, status: "active", revokedAt: null } as SecretRow;
  });
  return metadata(row, input.projectId);
}

export async function listProjectEnvironmentSecrets(input: { projectId: string; actorUserId?: string }, dependencies?: Partial<ProjectEnvironmentSecretDependencies>): Promise<SecretMetadata[]> {
  const resolved = deps(dependencies);
  if (input.actorUserId) await resolved.assertCanReadProject({ userId: input.actorUserId, projectId: input.projectId });
  const digest = projectDigest(input.projectId);
  const rows = await resolved.db.$transaction((tx) => tx.projectEnvironmentSecret.findMany({ where: { projectDigest: digest, status: "active" }, orderBy: [{ name: "asc" }] }));
  return rows.map((row) => metadata(row, input.projectId));
}

export async function resolveProjectEnvironmentSecrets(input: { projectId: string; names: string[]; actorUserId?: string }, dependencies?: Partial<ProjectEnvironmentSecretDependencies>): Promise<Record<string, string>> {
  const resolved = deps(dependencies);
  if (input.actorUserId) await resolved.assertCanReadProject({ userId: input.actorUserId, projectId: input.projectId });
  const digest = projectDigest(input.projectId);
  const names = [...new Set(input.names.map(secretName))];
  const rows = await resolved.db.$transaction((tx) => tx.projectEnvironmentSecret.findMany({ where: { projectDigest: digest, name: { in: names }, status: "active" } }));
  const values: Record<string, string> = {};
  for (const row of rows) values[row.name] = decryptWorkerSecret(row.encryptedValue, resolved.encryptionKey, "HUMANTHREAD_PROJECT_ENVIRONMENT_SECRET_ENCRYPTION_KEY");
  return values;
}

export async function replaceProjectEnvironmentSecrets(input: {
  projectId: string;
  actorUserId: string;
  values: Record<string, string>;
  namesToRevoke?: string[];
  afterReplace?: (transaction: unknown) => Promise<void>;
}, dependencies?: Partial<ProjectEnvironmentSecretDependencies>): Promise<SecretMetadata[]> {
  const resolved = deps(dependencies);
  await resolved.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const digest = projectDigest(input.projectId);
  const values = Object.entries(input.values).map(([name, value]) => [secretName(name), secretValue(value)] as const);
  const namesToRevoke = uniqueSecretNames(input.namesToRevoke ?? []).filter((name) => !values.some(([activeName]) => activeName === name));
  const now = validNow(resolved.now);
  const rows = await resolved.db.$transaction(async (tx) => {
    const updatedRows: SecretRow[] = [];
    // Activate replacement credentials before revoking old slots so an
    // interrupted switch cannot leave the Project with no usable credential.
    for (const [name, value] of values) {
      const encryptedValue = encryptWorkerSecret(value, resolved.encryptionKey, "HUMANTHREAD_PROJECT_ENVIRONMENT_SECRET_ENCRYPTION_KEY");
      const valueFingerprint = createHash("sha256").update(value).digest("hex");
      const existing = await tx.projectEnvironmentSecret.findUnique({ where: { projectDigest_name: { projectDigest: digest, name } } });
      const data = {
        id: existing?.id ?? resolved.createId(["project-environment-secret", digest, name]),
        projectDigest: digest,
        name,
        encryptedValue,
        valueFingerprint,
        status: "active",
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        revokedAt: null,
      };
      if (existing) {
        const updated = await tx.projectEnvironmentSecret.updateMany({ where: { projectDigest: digest, name }, data });
        if (updated.count !== 1) throw new Error("环境凭证更新失败");
        updatedRows.push({ ...existing, ...data } as SecretRow);
      } else {
        updatedRows.push(await tx.projectEnvironmentSecret.create({ data }));
      }
    }
    for (const name of namesToRevoke) {
      const existing = await tx.projectEnvironmentSecret.findUnique({ where: { projectDigest_name: { projectDigest: digest, name } } });
      if (!existing || existing.status !== "active") continue;
      const updated = await tx.projectEnvironmentSecret.updateMany({
        where: { projectDigest: digest, name, status: "active" },
        data: { status: "revoked", revokedAt: now, updatedAt: now },
      });
      if (updated.count !== 1) throw new Error("环境凭证撤销失败");
      updatedRows.push({ ...existing, status: "revoked", revokedAt: now, updatedAt: now });
    }
    await input.afterReplace?.(tx);
    return updatedRows;
  });
  return rows.map((row) => metadata(row, input.projectId));
}

export async function revokeProjectEnvironmentSecrets(input: {
  projectId: string;
  actorUserId: string;
  names: string[];
}, dependencies?: Partial<ProjectEnvironmentSecretDependencies>): Promise<SecretMetadata[]> {
  return replaceProjectEnvironmentSecrets({ ...input, values: {} }, dependencies);
}
