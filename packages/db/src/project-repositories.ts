import { createHash } from "node:crypto";
import {
  normalizeGitCredentialEnvironment,
  normalizeProjectRepositoryUrl,
  normalizePrivateRepositoryBaseUrl,
  projectRepositoryAuthModeSchema,
  projectRepositoryConfigurationSchema,
  projectRepositoryProviderSchema,
  repositoryVerificationJobSchema,
  repositoryCredentialSecretNames,
  repositoryHost,
  type ProjectRepositoryAuthMode,
  type ProjectRepositoryConfiguration,
  type ProjectRepositoryProvider,
  type RepositoryVerificationResult,
} from "@humanthread/shared";

import { assertCanReadProject, assertCanWriteProject } from "./access-control";
import { isWorkerBranchPattern } from "@humanthread/shared";
import {
  listProjectEnvironmentSecrets,
  replaceProjectEnvironmentSecrets,
  type ProjectEnvironmentSecretDependencies,
  type SecretMetadata,
} from "./project-environment-secrets";

type ProjectRepositoryRow = {
  id: string;
  version: number;
  workerRepositoryUrl: string | null;
  workerBranchPolicy: unknown;
  repositoryConfiguration: unknown;
};

interface ProjectRepositoryTx {
  project: {
    findUnique(input: unknown): Promise<ProjectRepositoryRow | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  projectEnvironmentSecret: {
    findUnique(input: unknown): Promise<Record<string, unknown> | null>;
    findMany(input: unknown): Promise<Array<Record<string, unknown>>>;
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  outboxMessage: {
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
}

interface ProjectRepositoryDb {
  $transaction<T>(callback: (tx: ProjectRepositoryTx) => Promise<T>): Promise<T>;
}

export interface ProjectRepositoryDependencies {
  db: ProjectRepositoryDb;
  encryptionKey: string;
  assertCanReadProject: typeof assertCanReadProject;
  assertCanWriteProject: typeof assertCanWriteProject;
  createId: (parts: readonly string[]) => string;
  now: Date;
  privateHostAllowlist: string[];
}

const DEFAULT_DEPENDENCIES: ProjectRepositoryDependencies = {
  db: {
    $transaction: async (callback) => callback(await import("./prisma").then(({ prisma }) => prisma as unknown as ProjectRepositoryTx)),
  },
  encryptionKey: process.env.HUMANTHREAD_PROJECT_ENVIRONMENT_SECRET_ENCRYPTION_KEY ?? process.env.HUMANTHREAD_WORKER_MODEL_SITE_ENCRYPTION_KEY ?? "",
  assertCanReadProject,
  assertCanWriteProject,
  createId: (parts) => createHash("md5").update(parts.join("\0")).digest("hex"),
  now: new Date(),
  privateHostAllowlist: parsePrivateHostAllowlist(process.env.HUMANTHREAD_PRIVATE_GIT_HOST_ALLOWLIST),
};

function projectRepositoryError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function resolvedDependencies(input?: Partial<ProjectRepositoryDependencies>): ProjectRepositoryDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...(input ?? {}), now: input?.now ?? new Date() };
}

function secretDependencies(resolved: ProjectRepositoryDependencies): Partial<ProjectEnvironmentSecretDependencies> {
  return {
    db: resolved.db as unknown as ProjectEnvironmentSecretDependencies["db"],
    encryptionKey: resolved.encryptionKey,
    assertCanReadProject: resolved.assertCanReadProject,
    assertCanWriteProject: resolved.assertCanWriteProject,
    createId: resolved.createId,
    now: resolved.now,
  };
}

function parsePrivateHostAllowlist(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

function parseBranchPolicy(value: unknown): { allowedBranches: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw projectRepositoryError("validation_failed", "Git 分支策略无效");
  const branches = Reflect.get(value, "allowedBranches");
  if (!Array.isArray(branches)) throw projectRepositoryError("validation_failed", "Git 分支策略无效");
  const allowedBranches = [...new Set(branches.map((branch) => typeof branch === "string" ? branch.trim() : "").filter(Boolean))];
  if (allowedBranches.length === 0 || allowedBranches.length > 64 || allowedBranches.some((branch) => !isWorkerBranchPattern(branch))) {
    throw projectRepositoryError("validation_failed", "Git 分支策略无效");
  }
  return { allowedBranches };
}

function parseConfiguration(value: unknown): ProjectRepositoryConfiguration | null {
  if (value === null || value === undefined) return null;
  const parsed = projectRepositoryConfigurationSchema.safeParse(value);
  if (!parsed.success) throw projectRepositoryError("configuration_required", "项目仓库配置无效");
  return parsed.data;
}

function assertProviderConfiguration(input: {
  provider: ProjectRepositoryProvider;
  authMode: ProjectRepositoryAuthMode;
  privateBaseUrl: string | null;
  repositoryUrl: string;
  privateHostAllowlist?: string[];
}): { repositoryUrl: string; privateBaseUrl: string | null } {
  const repositoryUrl = normalizeProjectRepositoryUrl(input.repositoryUrl);
  if (input.provider === "github" && input.authMode === "account_password") {
    throw projectRepositoryError("provider_unsupported", "GitHub 不支持账户密码，请使用 Fine-grained personal access token");
  }
  const privateBaseUrl = input.provider === "private"
    ? normalizePrivateRepositoryBaseUrl(input.privateBaseUrl ?? "")
    : null;
  if (input.provider === "private") {
    const host = repositoryHost(repositoryUrl);
    const baseHost = repositoryHost(`${privateBaseUrl}/placeholder`);
    const allowlist = input.privateHostAllowlist ?? [];
    if (host !== baseHost || !allowlist.includes(host)) {
      throw projectRepositoryError("private_host_not_allowed", "私仓地址未加入出站白名单");
    }
  }
  return { repositoryUrl, privateBaseUrl };
}

function pendingVerification(): RepositoryVerificationResult {
  return { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false };
}

function versionConflict(): Error & { code: string } {
  return projectRepositoryError("version_conflict", "项目已被其他操作更新");
}

export async function getProjectRepository(input: { projectId: string; actorUserId: string }, dependencies?: Partial<ProjectRepositoryDependencies>) {
  const resolved = resolvedDependencies(dependencies);
  await resolved.assertCanReadProject({ userId: input.actorUserId, projectId: input.projectId });
  const project = await resolved.db.$transaction((tx) => tx.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, version: true, workerRepositoryUrl: true, workerBranchPolicy: true, repositoryConfiguration: true },
  }));
  if (!project) throw projectRepositoryError("not_found", "项目不存在");
  const credentials = await listProjectEnvironmentSecrets({ projectId: input.projectId }, secretDependencies(resolved));
  return {
    projectId: project.id,
    version: project.version,
    repositoryUrl: project.workerRepositoryUrl,
    branchPolicy: project.workerBranchPolicy ? parseBranchPolicy(project.workerBranchPolicy) : null,
    configuration: parseConfiguration(project.repositoryConfiguration),
    credentials,
  };
}

export async function saveProjectRepositoryConfiguration(input: {
  actorUserId: string;
  projectId: string;
  expectedVersion: number;
  repositoryUrl: string;
  allowedBranches: string[];
  provider: ProjectRepositoryProvider;
  creationMode: "new" | "existing";
  authMode: ProjectRepositoryAuthMode;
  privateBaseUrl?: string | null;
  privateWebUrl?: string | null;
  privateTokenHelpUrl?: string | null;
}, dependencies?: Partial<ProjectRepositoryDependencies>): Promise<{ projectId: string; version: number }> {
  const resolved = resolvedDependencies(dependencies);
  await resolved.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw projectRepositoryError("validation_failed", "项目版本无效");
  const provider = projectRepositoryProviderSchema.parse(input.provider);
  const authMode = projectRepositoryAuthModeSchema.parse(input.authMode);
  const branchPolicy = parseBranchPolicy({ allowedBranches: input.allowedBranches });
  const repository = assertProviderConfiguration({
    provider,
    authMode,
    privateBaseUrl: input.privateBaseUrl ?? null,
    repositoryUrl: input.repositoryUrl,
    privateHostAllowlist: resolved.privateHostAllowlist,
  });
  const configuration = projectRepositoryConfigurationSchema.parse({
    schemaVersion: 1,
    provider,
    creationMode: input.creationMode,
    privateBaseUrl: repository.privateBaseUrl,
    privateWebUrl: input.privateWebUrl?.trim() || null,
    privateTokenHelpUrl: input.privateTokenHelpUrl?.trim() || null,
    authMode,
    verification: pendingVerification(),
  });
  const updated = await resolved.db.$transaction((tx) => tx.project.updateMany({
    where: { id: input.projectId, version: input.expectedVersion },
    data: {
      workerRepositoryUrl: repository.repositoryUrl,
      workerBranchPolicy: branchPolicy,
      repositoryConfiguration: configuration,
      version: { increment: 1 },
    },
  }));
  if (updated.count !== 1) throw versionConflict();
  return { projectId: input.projectId, version: input.expectedVersion + 1 };
}

export async function saveProjectRepositoryCredentials(input: {
  actorUserId: string;
  projectId: string;
  authMode: ProjectRepositoryAuthMode;
  username?: string;
  secret: string;
}, dependencies?: Partial<ProjectRepositoryDependencies>): Promise<{ credentialNames: string[] }> {
  const resolved = resolvedDependencies(dependencies);
  await resolved.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const project = await resolved.db.$transaction((tx) => tx.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, version: true, workerRepositoryUrl: true, workerBranchPolicy: true, repositoryConfiguration: true },
  }));
  if (!project) throw projectRepositoryError("not_found", "项目不存在");
  const configuration = parseConfiguration(project.repositoryConfiguration);
  if (!configuration) throw projectRepositoryError("configuration_required", "请先保存项目仓库配置");
  if (configuration.authMode !== input.authMode) throw projectRepositoryError("validation_failed", "认证方式与项目仓库配置不一致");
  const credentials = normalizeGitCredentialEnvironment({
    provider: configuration.provider,
    authMode: input.authMode,
    username: input.username ?? "",
    secret: input.secret,
  });
  const secretNames = repositoryCredentialSecretNames(input.authMode);
  const values = {
    HT_GIT_USERNAME: credentials.HT_GIT_USERNAME,
    [input.authMode === "project_token" ? "HT_GIT_TOKEN" : "HT_GIT_PASSWORD"]: credentials.HT_GIT_SECRET,
  };
  const allCredentialNames = ["HT_GIT_USERNAME", "HT_GIT_TOKEN", "HT_GIT_PASSWORD"];
  await replaceProjectEnvironmentSecrets({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    values,
    namesToRevoke: allCredentialNames.filter((name) => !secretNames.includes(name)),
    afterReplace: async (transaction) => {
      const tx = transaction as ProjectRepositoryTx;
      const updated = await tx.project.updateMany({
        where: { id: input.projectId, version: project.version },
        data: {
          repositoryConfiguration: { ...configuration, verification: pendingVerification() },
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw versionConflict();
    },
  }, secretDependencies(resolved));
  return { credentialNames: [...secretNames].sort() };
}

export async function enqueueProjectRepositoryVerification(input: {
  actorUserId: string;
  projectId: string;
  expectedDefaultBranch?: string;
}, dependencies?: Partial<ProjectRepositoryDependencies>): Promise<{
  projectId: string;
  version: number;
  status: "pending_verification";
}> {
  const resolved = resolvedDependencies(dependencies);
  await resolved.assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const project = await resolved.db.$transaction((tx) => tx.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, version: true, workerRepositoryUrl: true, workerBranchPolicy: true, repositoryConfiguration: true },
  }));
  if (!project) throw projectRepositoryError("not_found", "项目不存在");
  if (!project.workerRepositoryUrl) throw projectRepositoryError("configuration_required", "项目 Git 仓库尚未配置");
  const configuration = parseConfiguration(project.repositoryConfiguration);
  if (!configuration) throw projectRepositoryError("configuration_required", "请先保存项目仓库配置");
  const nextVersion = project.version + 1;
  const job = repositoryVerificationJobSchema.parse({
    projectId: input.projectId,
    expectedVersion: nextVersion,
    ...(input.expectedDefaultBranch ? { expectedDefaultBranch: input.expectedDefaultBranch } : {}),
  });
  const now = resolved.now;
  await resolved.db.$transaction(async (tx) => {
    const updated = await tx.project.updateMany({
      where: { id: input.projectId, version: project.version },
      data: {
        repositoryConfiguration: { ...configuration, verification: pendingVerification() },
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw versionConflict();
    await tx.outboxMessage.create({
      data: {
        id: `outbox:repository-verification:${resolved.createId(["repository-verification", input.projectId, String(nextVersion)])}`,
        topic: "repository.verification.requested",
        aggregateType: "project",
        aggregateId: input.projectId,
        payload: job,
        availableAt: now,
      },
    });
  });
  return { projectId: input.projectId, version: nextVersion, status: "pending_verification" };
}

export async function getProjectRepositoryVerificationTarget(input: {
  projectId: string;
  expectedVersion: number;
}, dependencies?: Partial<ProjectRepositoryDependencies>): Promise<{
  projectId: string;
  version: number;
  repositoryUrl: string;
  configuration: ProjectRepositoryConfiguration;
} | null> {
  const resolved = resolvedDependencies(dependencies);
  const project = await resolved.db.$transaction((tx) => tx.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, version: true, workerRepositoryUrl: true, workerBranchPolicy: true, repositoryConfiguration: true },
  }));
  if (
    !project
    || project.version !== input.expectedVersion
    || !project.workerRepositoryUrl
    || project.repositoryConfiguration === null
    || project.repositoryConfiguration === undefined
  ) return null;
  const configuration = parseConfiguration(project.repositoryConfiguration);
  if (!configuration) return null;
  return {
    projectId: project.id,
    version: project.version,
    repositoryUrl: project.workerRepositoryUrl,
    configuration,
  };
}

export async function saveProjectRepositoryVerification(input: {
  projectId: string;
  expectedVersion?: number;
  verification: RepositoryVerificationResult;
}, dependencies?: Partial<ProjectRepositoryDependencies>): Promise<{ projectId: string; version: number }> {
  const resolved = resolvedDependencies(dependencies);
  const project = await resolved.db.$transaction((tx) => tx.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, version: true, workerRepositoryUrl: true, workerBranchPolicy: true, repositoryConfiguration: true },
  }));
  if (!project) throw projectRepositoryError("not_found", "项目不存在");
  const configuration = parseConfiguration(project.repositoryConfiguration);
  if (!configuration) throw projectRepositoryError("configuration_required", "请先保存项目仓库配置");
  const expectedVersion = input.expectedVersion ?? project.version;
  const updated = await resolved.db.$transaction((tx) => tx.project.updateMany({
    where: { id: input.projectId, version: expectedVersion },
    data: {
      repositoryConfiguration: { ...configuration, verification: input.verification },
      version: { increment: 1 },
    },
  }));
  if (updated.count !== 1) throw versionConflict();
  return { projectId: input.projectId, version: expectedVersion + 1 };
}

export async function assertProjectRepositoryReady(input: { projectId: string }, dependencies?: Partial<ProjectRepositoryDependencies>): Promise<{
  legacy: boolean;
  repositoryUrl: string;
  branchPolicy: { allowedBranches: string[] };
  secretNames: string[];
}> {
  const resolved = resolvedDependencies(dependencies);
  const project = await resolved.db.$transaction((tx) => tx.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, version: true, workerRepositoryUrl: true, workerBranchPolicy: true, repositoryConfiguration: true },
  }));
  if (!project?.workerRepositoryUrl) throw projectRepositoryError("configuration_required", "项目 Git 仓库尚未配置");
  const branchPolicy = parseBranchPolicy(project.workerBranchPolicy);
  const configuration = parseConfiguration(project.repositoryConfiguration);
  if (!configuration) {
    return { legacy: true, repositoryUrl: project.workerRepositoryUrl, branchPolicy, secretNames: [] };
  }
  if (configuration.verification.status !== "passed") {
    throw projectRepositoryError("repository_credential_unverified", "项目仓库凭证尚未通过校验");
  }
  const requiredNames = repositoryCredentialSecretNames(configuration.authMode);
  const credentials = await listProjectEnvironmentSecrets({ projectId: input.projectId }, secretDependencies(resolved));
  const configured = new Set(credentials.filter((credential) => credential.status === "configured").map((credential) => credential.name));
  if (!requiredNames.every((name) => configured.has(name))) {
    throw projectRepositoryError("repository_credential_unverified", "项目仓库凭证不完整或已撤销");
  }
  return {
    legacy: false,
    repositoryUrl: project.workerRepositoryUrl,
    branchPolicy,
    secretNames: [...requiredNames].sort(),
  };
}
