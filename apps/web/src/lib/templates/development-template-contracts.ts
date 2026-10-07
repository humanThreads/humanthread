import { z } from "zod";
import { developmentTemplateIndustrySchema, loopGroupPresetSchema, loopGroupSelectionSchema } from "@humanthread/shared";

const boundedId = z.string().trim().min(1).max(96);
const commandId = z.string().trim().min(1).max(128);
const jsonObject = z.record(z.string(), z.unknown());
const loopGroupConfig = z.object({
  presets: z.array(loopGroupPresetSchema).min(1).max(32),
  defaultSelection: loopGroupSelectionSchema,
}).strict();

export const developmentTemplateListQuerySchema = z.object({ spaceId: boundedId, projectId: boundedId.optional() }).strict();
export const developmentTemplateMarketQuerySchema = z.object({ sort: z.enum(["published", "stars"]).default("published") }).strict();
export const createDevelopmentTemplateRequestSchema = z.object({
  commandId, spaceId: boundedId, name: z.string().trim().min(1).max(191),
}).strict();
export const updateDevelopmentTemplateRequestSchema = z.object({
  commandId, expectedRevision: z.number().int().positive(), name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(20_000).nullable().optional(),
  projectConfigSchema: jsonObject.optional(), taskFieldSchema: jsonObject.optional(),
  developmentLoopVersionId: boundedId.nullable().optional(), releaseLoopVersionId: boundedId.nullable().optional(),
  triggerPolicy: jsonObject.optional(), executionPolicy: jsonObject.optional(),
  industryTags: z.array(developmentTemplateIndustrySchema).max(32).optional(),
  loopGroupConfig: loopGroupConfig.nullable().optional(),
}).strict();
export const copyDevelopmentTemplateRequestSchema = z.object({
  commandId, spaceId: boundedId, name: z.string().trim().min(1).max(191),
}).strict();
export const publishDevelopmentTemplateRequestSchema = z.object({
  commandId, expectedRevision: z.number().int().positive(),
}).strict();
export const deprecateDevelopmentTemplateRequestSchema = publishDevelopmentTemplateRequestSchema;
export const marketVisibilityRequestSchema = z.object({
  commandId, expectedRevision: z.number().int().positive(), isPublic: z.boolean(), industryTags: z.array(developmentTemplateIndustrySchema).max(32),
}).strict();
export const deleteDevelopmentTemplateRequestSchema = publishDevelopmentTemplateRequestSchema;
export const compareDevelopmentTemplateQuerySchema = z.object({
  spaceId: boundedId, fromVersion: z.coerce.number().int().positive(), toVersion: z.coerce.number().int().positive(),
}).strict();

export function developmentTemplateApiError(error: unknown): {
  status: number;
  body: { ok: false; code: string; error: string; issues?: Array<{ path: string[]; message: string }>; currentRevision?: number };
} {
  if (error instanceof z.ZodError) return {
    status: 400,
    body: { ok: false, code: "validation_failed", error: "Invalid development template request", issues: error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })) },
  };
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message = error instanceof Error ? error.message : "";
  const status = message === "Workbench API authentication required" ? 401
    : code === "authorization_denied" || message.toLowerCase().includes("access denied") ? 403
      : code === "not_found" ? 404 : code === "version_conflict" ? 409
        : code === "validation_failed" || error instanceof SyntaxError ? 400 : 500;
  if (status === 500) return { status, body: { ok: false, code: "internal_error", error: "Development template request failed" } };
  const currentRevision = typeof record.currentRevision === "number" && Number.isInteger(record.currentRevision)
    ? record.currentRevision : undefined;
  const issues = fieldIssues(record.issues);
  return { status, body: {
    ok: false,
    code: code || (status === 401 ? "authentication_required" : status === 403 ? "authorization_denied" : "validation_failed"),
    error: message || "Development template request failed",
    ...(issues === undefined ? {} : { issues }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  } };
}

function fieldIssues(value: unknown): Array<{ path: string[]; message: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: Array<{ path: string[]; message: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.path) || !record.path.every((part): part is string => typeof part === "string") || typeof record.message !== "string") continue;
    result.push({ path: record.path, message: record.message });
  }
  return result;
}
