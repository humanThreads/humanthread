import { z } from "zod";

const workerPoolIdSchema = z.string().regex(/^[a-f0-9]{32}$/u);
const workerPoolDisplayNameSchema = z.string().trim().min(1).max(191);
const workerPoolHealthSchema = z.enum(["idle", "running", "degraded", "offline", "revoked"]);
const workerResourceOwnerTypeSchema = z.enum(["personal", "company"]);
const workerPoolRuntimeSchema = z.enum(["docker", "kubernetes"]);

export const workerPoolInstanceStatusSchema = z.object({
  instanceId: z.string().trim().min(1).max(191),
  health: workerPoolHealthSchema,
  requestedConcurrency: z.number().int().positive().max(128),
  currentRuns: z.number().int().nonnegative().max(16_384),
  lastSeenAt: z.iso.datetime().nullable(),
}).strict();

export const workerPoolStatusSchema = z.object({
  id: workerPoolIdSchema,
  ownerType: workerResourceOwnerTypeSchema,
  ownerUserId: z.string().trim().min(1).max(64).nullable(),
  companyId: z.string().trim().min(1).max(64).nullable(),
  displayName: workerPoolDisplayNameSchema,
  status: z.enum(["active", "revoked"]),
  maxConcurrentRuns: z.number().int().positive().max(128),
  health: workerPoolHealthSchema,
  capacity: z.number().int().nonnegative().max(16_384),
  currentRuns: z.number().int().nonnegative().max(16_384),
  runtime: workerPoolRuntimeSchema,
  taskGroupName: z.string().trim().min(1).max(191).nullable(),
  aliveInstanceCount: z.number().int().nonnegative().max(16_384),
  instances: z.array(workerPoolInstanceStatusSchema),
  configuration: z.record(z.string(), z.unknown()),
  tokenVersion: z.number().int().positive(),
  lastSeenAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export type WorkerPoolStatus = z.infer<typeof workerPoolStatusSchema>;
export type WorkerPoolInstanceStatus = z.infer<typeof workerPoolInstanceStatusSchema>;

export const workerPoolRegistrationSchema = z.object({
  instanceId: z.string().trim().min(1).max(191),
  poolName: workerPoolDisplayNameSchema.optional(),
  runtime: workerPoolRuntimeSchema.default("docker"),
  taskGroupName: workerPoolDisplayNameSchema.optional(),
  capabilities: z.record(z.string(), z.unknown()),
  requestedConcurrency: z.number().int().positive().max(128),
}).strict();

export type WorkerPoolRegistration = z.infer<typeof workerPoolRegistrationSchema>;
