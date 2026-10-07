import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "@prisma/client";
import { createAgentRunRecord } from "./agent-orchestration";
import { createPrismaRuntime, type PrismaRuntime } from "./prisma-runtime";

const PRISMA_LOG_LEVELS = ["warn", "error"] as const;
const MARIADB_POOL_DEFAULTS = {
  allowPublicKeyRetrieval: "true",
  connectionLimit: "10",
  minimumIdle: "1",
  connectTimeout: "3000",
  acquireTimeout: "10000",
  initializationTimeout: "10000",
  idleTimeout: "300",
} as const;
const currentFileDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRootEnvPath = resolve(currentFileDirectory, "../../../.env");
const prismaModelsByName = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model] as const),
);

const agentRunIdentityExtension = Prisma.defineExtension({
  name: "agent-run-identity",
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        assertNoNestedAgentRunCreation(model, operation, args);
        return query(args);
      },
    },
    agentRun: {
      create({ args, query }) {
        return createAgentRunRecord({
          data: args.data,
          persist: (data) => query({ ...args, data }),
        });
      },
      createMany({ args, query }) {
        return createAgentRunRecord({
          data: args.data,
          persist: () => query(args),
        });
      },
      upsert({ args, query }) {
        return createAgentRunRecord({
          data: args.create,
          persist: (create) => query({ ...args, create }),
        });
      },
    },
  },
});

function assertNoNestedAgentRunCreation(modelName: string, operation: string, args: unknown): void {
  if (modelName === "AgentRun" || !isRecord(args)) return;

  if (operation === "upsert") {
    inspectModelWrite(modelName, args.create);
    inspectModelWrite(modelName, args.update);
    return;
  }
  if (
    operation === "create"
    || operation === "createMany"
    || operation === "createManyAndReturn"
    || operation === "update"
    || operation === "updateMany"
    || operation === "updateManyAndReturn"
  ) {
    inspectModelWrite(modelName, args.data);
  }
}

function inspectModelWrite(modelName: string, value: unknown): void {
  for (const record of records(value)) {
    const model = prismaModelsByName.get(modelName);
    if (!model) return;
    for (const field of model.fields) {
      if (field.kind !== "object" || !hasOwn(record, field.name)) continue;
      const relationWrite = record[field.name];
      if (field.type === "AgentRun" && containsCreateDirective(relationWrite)) {
        throw nestedAgentRunCreationError();
      }
      inspectRelationWrite(field.type, relationWrite);
    }
  }
}

function inspectRelationWrite(targetModel: string, value: unknown): void {
  for (const write of records(value)) {
    inspectModelWrite(targetModel, write.create);
    for (const createMany of records(write.createMany)) inspectModelWrite(targetModel, createMany.data);
    for (const connectOrCreate of records(write.connectOrCreate)) {
      inspectModelWrite(targetModel, connectOrCreate.create);
    }
    for (const upsert of records(write.upsert)) {
      inspectModelWrite(targetModel, upsert.create);
      inspectModelWrite(targetModel, upsert.update);
    }
    for (const update of records(write.update)) {
      inspectModelWrite(targetModel, hasOwn(update, "data") ? update.data : update);
    }
    for (const updateMany of records(write.updateMany)) inspectModelWrite(targetModel, updateMany.data);
  }
}

function containsCreateDirective(value: unknown): boolean {
  return records(value).some((record) => (
    hasOwn(record, "create")
    || hasOwn(record, "createMany")
    || hasOwn(record, "connectOrCreate")
    || hasOwn(record, "upsert")
  ));
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function nestedAgentRunCreationError(): Error & { code: "invalid_agent_run_identity" } {
  return Object.assign(
    new Error("Nested AgentRun creation is prohibited; use createAgentRunRecord"),
    { code: "invalid_agent_run_identity" as const },
  );
}

loadDotenv({
  path: workspaceRootEnvPath,
  override: false,
});

const globalForPrisma = globalThis as typeof globalThis & {
  prismaRuntime?: PrismaRuntime<PrismaClient>;
};

export function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize Prisma runtime access.");
  }

  return databaseUrl;
}

export function createPrismaClientOptions(
  databaseUrl: string,
): Prisma.PrismaClientOptions {
  const normalizedDatabaseUrl = databaseUrl.trim();

  if (!normalizedDatabaseUrl) {
    throw new Error("DATABASE_URL is required to initialize Prisma runtime access.");
  }

  return {
    adapter: new PrismaMariaDb(createMariaDbConnectionString(normalizedDatabaseUrl)),
    log: [...PRISMA_LOG_LEVELS],
  };
}

export function createMariaDbConnectionString(databaseUrl: string): string {
  const normalizedDatabaseUrl = databaseUrl.trim();

  if (!normalizedDatabaseUrl) {
    throw new Error("DATABASE_URL is required to initialize Prisma runtime access.");
  }

  const configuredUrl = new URL(normalizedDatabaseUrl);
  for (const [name, value] of Object.entries(MARIADB_POOL_DEFAULTS)) {
    if (!configuredUrl.searchParams.has(name)) {
      configuredUrl.searchParams.set(name, value);
    }
  }

  return configuredUrl.toString();
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient(createPrismaClientOptions(databaseUrl)).$extends(
    agentRunIdentityExtension,
  ) as PrismaClient;
}

function getPrismaRuntime(): PrismaRuntime<PrismaClient> {
  if (!globalForPrisma.prismaRuntime) {
    globalForPrisma.prismaRuntime = createPrismaRuntime({
      createClient: () => createPrismaClient(resolveDatabaseUrl()),
    });
  }

  return globalForPrisma.prismaRuntime;
}

export function getPrismaClient(): PrismaClient {
  return getPrismaRuntime().getClient();
}

export function recoverPrismaClient(failedClient?: PrismaClient): Promise<PrismaClient> {
  return getPrismaRuntime().recoverClient(failedClient);
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
}) as PrismaClient;
