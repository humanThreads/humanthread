import { z } from "zod";

const namespaceSchema = z.string().trim().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u).max(63);
const storageClassSchema = z.string().trim().regex(/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/u).max(63);
const storageQuantitySchema = z.string().trim().regex(/^\d+(?:\.\d+)?(?:Ki|Mi|Gi|Ti|Pi|Ei)$/u);

export const projectWorkerDeploymentConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  kubernetes: z.object({
    namespace: namespaceSchema,
    storageClass: storageClassSchema.optional(),
    persistentStorage: storageQuantitySchema,
    minReplicas: z.number().int().min(1).max(100),
    maxReplicas: z.number().int().min(1).max(100),
  }).strict().refine((value) => value.minReplicas <= value.maxReplicas, {
    message: "最小副本数不能大于最大副本数",
    path: ["maxReplicas"],
  }),
  concurrency: z.number().int().min(1).max(128),
  sessionJournalRetentionDays: z.number().int().min(1).max(3_650).default(30),
  healthPort: z.number().int().min(1).max(65_535),
  capabilities: z.record(z.string().min(1).max(64), z.boolean()),
}).strict();

export type ProjectWorkerDeploymentConfiguration = z.infer<typeof projectWorkerDeploymentConfigurationSchema>;

export const defaultProjectWorkerDeploymentConfiguration: ProjectWorkerDeploymentConfiguration = {
  schemaVersion: 1,
  kubernetes: {
    namespace: "humanthread",
    persistentStorage: "10Gi",
    minReplicas: 1,
    maxReplicas: 3,
  },
  concurrency: 1,
  sessionJournalRetentionDays: 30,
  healthPort: 8080,
  capabilities: { workspace: true, files: true, commands: true },
};

export function resolveProjectWorkerDeploymentConfiguration(value: unknown): ProjectWorkerDeploymentConfiguration {
  const parsed = projectWorkerDeploymentConfigurationSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultProjectWorkerDeploymentConfiguration;
}
