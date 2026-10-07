import { createHash } from "node:crypto";
import { z } from "zod";
import { validateWorkerRuntimeVariables, workerRuntimeEnvironmentSchema, type WorkerRuntimeEnvironment } from "../orchestration/worker-runtime-environment";

const executionTargetSchema = z.enum(["local_agent", "worker"]);
const sourceTypeSchema = z.enum(["humanthread", "nacos", "project_file", "process"]);
const statusSchema = z.enum(["configured", "missing", "unverified"]);

export const projectEnvironmentConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(z.object({
    id: z.string().regex(/^[a-f0-9]{32}$/u, "环境配置标识必须是 32 位小写 MD5"),
    name: z.string().trim().min(1).max(191).regex(/^[A-Z][A-Z0-9_]*$/u, "环境变量名必须是大写字母、数字或下划线"),
    purpose: z.string().trim().min(1).max(191),
    executionTargets: z.array(executionTargetSchema).min(1).max(2).refine((targets) => new Set(targets).size === targets.length, "执行端不能重复"),
    sourceType: sourceTypeSchema,
    reference: z.string().trim().min(1).max(1024),
    sourceConfig: z.object({
      projectPath: z.string().trim().min(1).max(1024).optional(),
      namespace: z.string().trim().min(1).max(128).optional(),
      group: z.string().trim().min(1).max(128).optional(),
      dataId: z.string().trim().min(1).max(256).optional(),
    }).strict().optional(),
    status: statusSchema,
    revision: z.number().int().positive(),
  }).strict()).max(200),
  workerRuntime: workerRuntimeEnvironmentSchema.optional(),
}).strict();

export const projectEnvironmentConfigurationInputSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(z.object({
    id: z.string().regex(/^[a-f0-9]{32}$/u).optional(),
    name: z.string().trim().min(1).max(191).regex(/^[A-Z][A-Z0-9_]*$/u),
    purpose: z.string().trim().min(1).max(191),
    executionTargets: z.array(executionTargetSchema).min(1).max(2).refine((targets) => new Set(targets).size === targets.length),
    sourceType: sourceTypeSchema,
    reference: z.string().trim().min(1).max(1024),
    sourceConfig: z.object({
      projectPath: z.string().trim().min(1).max(1024).optional(),
      namespace: z.string().trim().min(1).max(128).optional(),
      group: z.string().trim().min(1).max(128).optional(),
      dataId: z.string().trim().min(1).max(256).optional(),
    }).strict().optional(),
    status: statusSchema,
    revision: z.number().int().positive().default(1),
  }).strict()).max(200),
  workerRuntime: workerRuntimeEnvironmentSchema.optional(),
}).strict();

const sensitivePropertyNames = new Set([
  "value", "secret", "password", "token", "cookie", "dsn", "apikey", "api_key", "credential", "privatekey", "private_key",
]);

function containsSensitiveProperty(value: unknown, path: string[] = []): boolean {
  if (!value || typeof value !== "object") return false;
  if (path[0] === "workerRuntime") return false;
  if (Array.isArray(value)) return value.some((nested) => containsSensitiveProperty(nested, path));
  return Object.entries(value).some(([key, nested]) => sensitivePropertyNames.has(key.toLowerCase()) || containsSensitiveProperty(nested, [...path, key]));
}

/**
 * 环境配置只持久化凭证元数据与来源引用；实际凭证只由后续来源适配器读取。
 */
export function sanitizeProjectEnvironmentConfiguration(value: unknown) {
  if (containsSensitiveProperty(value)) {
    throw new Error("项目环境配置不得包含明文凭证；请仅保存变量名、来源和状态");
  }
  return projectEnvironmentConfigurationSchema.parse(value);
}

export function normalizeProjectEnvironmentConfiguration(value: unknown): ProjectEnvironmentConfiguration {
  if (containsSensitiveProperty(value)) {
    throw new Error("项目环境配置不得包含明文凭证；请仅保存变量名、来源和状态");
  }
  const parsed = projectEnvironmentConfigurationInputSchema.parse(value);
  const normalized = projectEnvironmentConfigurationSchema.parse({
    ...parsed,
    entries: parsed.entries.map((entry) => ({
      ...entry,
      id: entry.id ?? createHash("md5").update(`${entry.name}\u0000${entry.reference}`).digest("hex"),
    })),
  });
  if (normalized.workerRuntime) validateWorkerRuntimeVariables(normalized.workerRuntime);
  normalized.entries.forEach((entry) => {
    if (entry.sourceConfig?.projectPath) validateProjectRelativePath(entry.sourceConfig.projectPath);
    if (entry.sourceType === "nacos" || entry.sourceConfig?.namespace || entry.sourceConfig?.group || entry.sourceConfig?.dataId) {
      validateNacosSourceScope(entry.sourceConfig ?? {});
    }
  });
  return normalized;
}

export function validateProjectRelativePath(value: string): string {
  const path = value.trim();
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path)) {
    throw new Error("项目配置文件必须使用项目相对路径");
  }
  const segments = path.split(/[\\/]+/u);
  if (segments.includes("..") || segments.includes(".")) throw new Error("项目配置文件路径不安全");
  return path;
}

export function validateNacosSourceScope(scope: { namespace?: string | undefined; group?: string | undefined; dataId?: string | undefined }) {
  if (scope.namespace && (!/^[A-Za-z0-9._-]+$/u.test(scope.namespace) || scope.namespace.includes("/"))) {
    throw new Error("Nacos namespace 超出允许范围");
  }
  if (scope.group && !/^[A-Za-z0-9._-]+$/u.test(scope.group)) throw new Error("Nacos group 超出允许范围");
  if (scope.dataId && (!/^[A-Za-z0-9._-]+$/u.test(scope.dataId) || scope.dataId.includes(".."))) {
    throw new Error("Nacos dataId 超出允许范围");
  }
  return scope;
}

type EnvironmentSource = Record<string, string | undefined>;
type EnvironmentResolution = {
  values: Record<string, string>;
  resolved: Record<string, { sourceType: ProjectEnvironmentConfigurationEntry["sourceType"]; fingerprint: string }>;
  conflicts: Array<{ name: string; sources: string[]; requiresConfirmation: true }>;
  diagnostics: Array<{ name: string; status: "resolved" | "conflict"; sourceType?: string; fingerprint?: string }>;
};

export const PROJECT_ENVIRONMENT_SOURCE_PRIORITY: ProjectEnvironmentConfigurationEntry["sourceType"][] = ["project_file", "humanthread", "nacos", "process"];

export function resolveProjectEnvironmentSources(input: {
  configuration: ProjectEnvironmentConfiguration;
  projectFile?: EnvironmentSource;
  humanthread?: EnvironmentSource;
  nacos?: EnvironmentSource;
  processEnv?: EnvironmentSource;
  confirmConflicts?: string[];
}): EnvironmentResolution {
  const values: Record<string, string> = {};
  const resolved: EnvironmentResolution["resolved"] = {};
  const conflicts: EnvironmentResolution["conflicts"] = [];
  const diagnostics: EnvironmentResolution["diagnostics"] = [];
  const sources: Record<ProjectEnvironmentConfigurationEntry["sourceType"], EnvironmentSource> = {
    project_file: input.projectFile ?? {},
    humanthread: input.humanthread ?? {},
    nacos: input.nacos ?? {},
    process: input.processEnv ?? {},
  };
  const confirmed = new Set(input.confirmConflicts ?? []);
  for (const entry of input.configuration.entries) {
    const candidates = PROJECT_ENVIRONMENT_SOURCE_PRIORITY.flatMap((sourceType) => {
      const value = sources[sourceType][entry.name];
      return typeof value === "string" ? [{ sourceType, value }] : [];
    });
    if (candidates.length === 0) {
      diagnostics.push({ name: entry.name, status: "conflict" });
      continue;
    }
    const distinct = new Set(candidates.map((candidate) => candidate.value));
    if (distinct.size > 1 && !confirmed.has(entry.name)) {
      conflicts.push({ name: entry.name, sources: candidates.map((candidate) => candidate.sourceType), requiresConfirmation: true });
      diagnostics.push({ name: entry.name, status: "conflict" });
      continue;
    }
    const selected = candidates[0]!;
    values[entry.name] = selected.value;
    resolved[entry.name] = { sourceType: selected.sourceType, fingerprint: createHash("sha256").update(selected.value).digest("hex") };
    diagnostics.push({ name: entry.name, status: "resolved", sourceType: selected.sourceType, fingerprint: resolved[entry.name]!.fingerprint });
  }
  return { values, resolved, conflicts, diagnostics };
}

export type ProjectEnvironmentConfiguration = z.infer<typeof projectEnvironmentConfigurationSchema>;
export type ProjectEnvironmentConfigurationEntry = ProjectEnvironmentConfiguration["entries"][number];
export type ProjectWorkerRuntimeEnvironment = WorkerRuntimeEnvironment;
