import { z } from "zod";

import { reasoningEffortSchema } from "./loop-engine";
import { workerBranchPatternSchema } from "./worker-branch-policy";

const md5IdSchema = z.string().regex(/^[a-f0-9]{32}$/u);

function hasStrictWorkerModelEndpointFormat(value: string): boolean {
  const authority = /^https?:\/\/([^/?#]+)(?:\/[^?#]*)?$/u.exec(value)?.[1];
  return authority !== undefined && !authority.includes("@");
}

export const workerModelEndpointSchema = z.url()
  .trim()
  .min(1)
  .max(1024)
  .refine(hasStrictWorkerModelEndpointFormat, "Worker model endpoint must be an HTTP(S) URL without credentials, query, or fragment");

export function isWorkerModelEndpoint(value: string): boolean {
  return workerModelEndpointSchema.safeParse(value).success;
}

export const workerExecutionSnapshotSchema = z.object({
  version: z.literal(1),
  workerPoolId: md5IdSchema,
  workerInstanceId: z.string().trim().min(1).max(191).optional(),
  repository: z.object({
    url: z.string().trim().min(1).max(1024),
    branch: z.string().trim().min(1).max(191),
    branchPolicy: z.object({
      allowedBranches: z.array(workerBranchPatternSchema).min(1).max(64),
    }).strict(),
  }).strict(),
  model: z.object({
    provider: z.literal("codex"),
    siteId: md5IdSchema,
    endpoint: workerModelEndpointSchema,
    apiKeyReference: md5IdSchema,
    model: z.string().trim().min(1).max(191),
    reasoningEffort: reasoningEffortSchema,
  }).strict(),
  resources: z.object({
    gpu: z.boolean(),
    unityBuild: z.boolean(),
  }).strict(),
  deliveryPolicy: z.object({
    requireGitDelivery: z.boolean(),
  }).strict(),
  grants: z.array(z.unknown()).max(256),
  logPolicy: z.object({
    redactCredentials: z.literal(true),
  }).strict(),
}).strict();

export type WorkerExecutionSnapshot = z.infer<typeof workerExecutionSnapshotSchema>;
