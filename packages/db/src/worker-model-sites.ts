import { isWorkerModelEndpoint } from "@humanthread/shared";
import { derivedPersistenceId } from "./bounded-id";
import { decryptWorkerSecret, encryptWorkerSecret } from "./worker-pools";
import { prisma } from "./prisma";
import {
  canManageWorkerResources,
  normalizeWorkerResourceScope,
  workerResourceScopeWhere,
  type CompanyResourceRole,
  type WorkerResourceScope,
} from "./worker-resource-tenancy";

type WorkerModelSiteRow = {
  id: string;
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
  name: string;
  provider: string;
  endpoint: string;
  models: unknown;
  apiKeyEncrypted: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

interface WorkerModelSiteTx {
  workerModelSite: {
    findUnique(args: unknown): Promise<WorkerModelSiteRow | null>;
    findFirst(args: unknown): Promise<WorkerModelSiteRow | null>;
    findMany(args: unknown): Promise<WorkerModelSiteRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<WorkerModelSiteRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

interface WorkerModelSiteDb {
  $transaction<T>(callback: (tx: WorkerModelSiteTx) => Promise<T>): Promise<T>;
}

export interface WorkerModelSiteDependencies {
  db: WorkerModelSiteDb;
  encryptionKey: string;
  createId: (parts: readonly string[]) => string;
}

const DEFAULT_DEPENDENCIES: WorkerModelSiteDependencies = {
  db: prisma as unknown as WorkerModelSiteDb,
  encryptionKey: process.env.HUMANTHREAD_WORKER_MODEL_SITE_ENCRYPTION_KEY ?? "",
  createId: derivedPersistenceId,
};

export interface WorkerModelSite {
  id: string;
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
  name: string;
  provider: "codex";
  endpoint: string;
  models: WorkerModelEntry[];
  apiKeyReference: string;
  status: "active";
  createdAt: string;
  updatedAt: string;
}

export interface WorkerModelEntry {
  name: string;
  label: string;
}

const MAX_SITE_MODELS = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

export function normalizeWorkerModelEntries(value: unknown): WorkerModelEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw configurationRequired("Worker model site catalogue must be an array");
  if (value.length > MAX_SITE_MODELS) throw configurationRequired("Worker model site catalogue is too large");
  const seen = new Set<string>();
  return value.map((candidate) => {
    const entry = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : null;
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const label = typeof entry?.label === "string" ? entry.label.trim() : "";
    if (!name || name.length > 512 || CONTROL_CHARACTERS.test(name)) {
      throw configurationRequired("Worker model entry name is invalid");
    }
    if (!label || label.length > 256 || CONTROL_CHARACTERS.test(label)) {
      throw configurationRequired("Worker model entry label is invalid");
    }
    if (seen.has(name)) throw configurationRequired("Worker model entry name is duplicate");
    seen.add(name);
    return { name, label };
  });
}

export interface WorkerModelSiteSecret {
  id: string;
  endpoint: string;
  apiKeyReference: string;
  apiKey: string;
}

export async function listWorkerModelSites(input: {
  actorUserId?: string;
  scope?: WorkerResourceScope;
}, dependencies: WorkerModelSiteDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerModelSite[]> {
  const scope = resolveScope(input);
  const rows = await dependencies.db.$transaction((tx) => tx.workerModelSite.findMany({
    where: { ...workerResourceScopeWhere(scope), provider: "codex", status: "active" },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  }));
  return rows.map(serialize);
}

export async function createWorkerModelSite(input: {
  actorUserId: string;
  scope?: WorkerResourceScope;
  companyRole?: CompanyResourceRole | null;
  name: string;
  endpoint: string;
  apiKey: string;
  models?: unknown;
  now: Date;
}, dependencies: WorkerModelSiteDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerModelSite> {
  const actorUserId = required(input.actorUserId, "actorUserId", 64);
  const scope = resolveScope(input);
  assertCanManageScope(scope, input.companyRole);
  const name = required(input.name, "name", 191);
  const endpoint = validEndpoint(input.endpoint);
  const apiKey = required(input.apiKey, "apiKey", 4096);
  const now = validDate(input.now);
  const id = dependencies.createId(["worker-model-site", scope.ownerType, scope.ownerUserId ?? scope.companyId ?? "", name]);
  if (!/^[a-f0-9]{32}$/u.test(id)) throw configurationRequired("Worker model site ID must be an MD5 identifier");
  let apiKeyEncrypted: string;
  try {
    apiKeyEncrypted = encryptWorkerSecret(apiKey, dependencies.encryptionKey, "HUMANTHREAD_WORKER_MODEL_SITE_ENCRYPTION_KEY");
  } catch (error) {
    throw configurationRequired(error instanceof Error ? error.message : "Worker model site encryption is unavailable");
  }
  return dependencies.db.$transaction(async (tx) => {
    const existing = await tx.workerModelSite.findUnique({
      where: modelSiteNameWhere(scope, name),
    });
    if (existing) throw Object.assign(new Error("Worker model site name is already in use"), { code: "worker_model_site_conflict" });
    const row = await tx.workerModelSite.create({
      data: {
        id,
        ...scope,
        name,
        provider: "codex",
        endpoint,
        models: normalizeWorkerModelEntries(input.models),
        apiKeyEncrypted,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    });
    return serialize(row);
  });
}

export async function resolveWorkerModelSiteSecret(input: {
  actorUserId?: string;
  scope?: WorkerResourceScope;
  siteId: string;
}, dependencies: WorkerModelSiteDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerModelSiteSecret> {
  const scope = resolveScope(input);
  const siteId = required(input.siteId, "siteId", 32);
  if (!/^[a-f0-9]{32}$/u.test(siteId)) throw configurationRequired("Worker model site is invalid");
  const row = await dependencies.db.$transaction((tx) => tx.workerModelSite.findFirst({
    where: {
      id: siteId,
      ...workerResourceScopeWhere(scope),
      provider: "codex",
      status: "active",
    },
  }));
  if (!row) throw configurationRequired("Worker model site is unavailable");
  try {
    return {
      id: row.id,
      endpoint: validEndpoint(row.endpoint),
      apiKeyReference: row.id,
      apiKey: decryptWorkerSecret(
        row.apiKeyEncrypted,
        dependencies.encryptionKey,
        "HUMANTHREAD_WORKER_MODEL_SITE_ENCRYPTION_KEY",
      ),
    };
  } catch (error) {
    throw configurationRequired(error instanceof Error ? error.message : "Worker model site decryption is unavailable");
  }
}

/**
 * Replaces a site's model catalogue. Deliberately narrow: it must not touch the
 * endpoint or the encrypted API key, so editing the catalogue can never
 * accidentally rotate a credential or redirect provider traffic.
 */
export async function updateWorkerModelSiteModels(input: {
  actorUserId: string;
  scope?: WorkerResourceScope;
  companyRole?: CompanyResourceRole | null;
  siteId: string;
  models: unknown;
  now: Date;
}, dependencies: WorkerModelSiteDependencies = DEFAULT_DEPENDENCIES): Promise<WorkerModelSite> {
  required(input.actorUserId, "actorUserId", 64);
  const scope = resolveScope(input);
  assertCanManageScope(scope, input.companyRole);
  const siteId = required(input.siteId, "siteId", 32);
  if (!/^[a-f0-9]{32}$/u.test(siteId)) throw configurationRequired("Worker model site is invalid");
  // Validate before opening the transaction so an invalid catalogue cannot
  // partially apply.
  const models = normalizeWorkerModelEntries(input.models);
  const now = validDate(input.now);

  return dependencies.db.$transaction(async (tx) => {
    const site = await tx.workerModelSite.findFirst({
      where: { id: siteId, ...workerResourceScopeWhere(scope), provider: "codex", status: "active" },
    });
    if (!site) throw configurationRequired("Worker model site is unavailable");
    const updated = await tx.workerModelSite.updateMany({
      where: { id: site.id, ...workerResourceScopeWhere(scope), provider: "codex", status: "active" },
      data: { models, updatedAt: now },
    });
    if (updated.count !== 1) throw configurationRequired("Worker model site is unavailable");
    return serialize({ ...site, models, updatedAt: now });
  });
}

export async function revokeWorkerModelSite(input: {
  actorUserId: string;
  scope?: WorkerResourceScope;
  companyRole?: CompanyResourceRole | null;
  siteId: string;
  now: Date;
}, dependencies: WorkerModelSiteDependencies = DEFAULT_DEPENDENCIES): Promise<void> {
  required(input.actorUserId, "actorUserId", 64);
  const scope = resolveScope(input);
  assertCanManageScope(scope, input.companyRole);
  const siteId = required(input.siteId, "siteId", 32);
  if (!/^[a-f0-9]{32}$/u.test(siteId)) throw configurationRequired("Worker model site is invalid");
  const now = validDate(input.now);

  await dependencies.db.$transaction(async (tx) => {
    const site = await tx.workerModelSite.findFirst({
      where: { id: siteId, ...workerResourceScopeWhere(scope), provider: "codex", status: "active" },
    });
    if (!site) throw configurationRequired("Worker model site is unavailable");
    const updated = await tx.workerModelSite.updateMany({
      where: { id: site.id, ...workerResourceScopeWhere(scope), provider: "codex", status: "active" },
      data: { status: "revoked", updatedAt: now },
    });
    if (updated.count !== 1) throw configurationRequired("Worker model site is unavailable");
  });
}

function serialize(row: WorkerModelSiteRow): WorkerModelSite {
  if (row.provider !== "codex" || row.status !== "active") throw configurationRequired("Worker model site is unavailable");
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerUserId: row.ownerUserId,
    companyId: row.companyId,
    name: row.name,
    provider: "codex",
    endpoint: row.endpoint,
    models: normalizeWorkerModelEntries(row.models),
    apiKeyReference: row.id,
    status: "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveScope(input: { actorUserId?: string; scope?: WorkerResourceScope }): WorkerResourceScope {
  const scope = input.scope === undefined
    ? { ownerType: "personal" as const, ownerUserId: required(input.actorUserId ?? "", "actorUserId", 64), companyId: null }
    : normalizeWorkerResourceScope(input.scope);
  if (scope.ownerType === "personal" && input.actorUserId !== undefined
    && scope.ownerUserId !== required(input.actorUserId, "actorUserId", 64)) {
    throw configurationRequired("Personal Worker resources belong to the current user");
  }
  return scope;
}

function assertCanManageScope(scope: WorkerResourceScope, role: CompanyResourceRole | null | undefined): void {
  const allowed = role === undefined
    ? canManageWorkerResources({ ownerType: scope.ownerType })
    : canManageWorkerResources({ ownerType: scope.ownerType, role });
  if (!allowed) throw configurationRequired("Worker model site management is not authorized");
}

function modelSiteNameWhere(scope: WorkerResourceScope, name: string): Record<string, unknown> {
  return scope.ownerType === "personal"
    ? { ownerUserId_name: { ownerUserId: scope.ownerUserId, name } }
    : { companyId_name: { companyId: scope.companyId, name } };
}

function required(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw configurationRequired(`${field} is required`);
  return normalized;
}

function validEndpoint(value: string): string {
  const normalized = required(value, "endpoint", 1024);
  try {
    const url = new URL(normalized);
    if (!isWorkerModelEndpoint(normalized)) throw new Error();
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw configurationRequired("Worker model site endpoint is invalid");
  }
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw configurationRequired("Worker model site time is invalid");
  return value;
}

function configurationRequired(message: string): Error & { code: "configuration_required" } {
  return Object.assign(new Error(message), { code: "configuration_required" as const });
}
