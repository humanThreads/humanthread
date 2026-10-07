import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { initializeWorkbenchProjectDevelopmentMode, upgradeWorkbenchProjectDevelopmentMode, updateWorkbenchProject, updateWorkbenchProjectEnvironmentConfiguration, updateWorkbenchProjectLoopGroupConfig, updateWorkbenchProjectWorkerDeploymentConfiguration, updateWorkbenchProjectWorkerImageVersion, updateWorkbenchProjectWorkerPool } from "@/lib/workbench/workbench-project-commands";

const updateProjectSchema = z.object({
  shortCode: z.string().trim().min(2).max(12),
  expectedVersion: z.number().int().positive(),
});
const initializeDevelopmentModeSchema = z.object({
  developmentTemplateKey: z.string().trim().min(1).max(96),
  developmentTemplateVersion: z.number().int().positive(),
  developmentTemplateConfig: z.unknown(),
  expectedVersion: z.number().int().positive(),
});
const developmentTemplateUpgradeSchema = z.object({
  expectedVersion: z.number().int().positive(),
  developmentTemplateUpgrade: z.object({
    key: z.string().trim().min(1).max(96),
    version: z.number().int().positive(),
    config: z.record(z.string(), z.unknown()),
  }).strict(),
}).strict();
const environmentConfigurationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  environmentConfiguration: z.unknown(),
}).strict();
const loopGroupConfigurationSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().positive(),
  loopGroupConfig: z.unknown(),
}).strict();
const workerPoolSchema = z.object({ expectedVersion: z.number().int().positive(), workerPoolId: z.string().regex(/^[a-f0-9]{32}$/u) }).strict();
const workerDeploymentConfigurationSchema = z.object({ expectedVersion: z.number().int().positive(), workerDeploymentConfiguration: z.unknown() }).strict();
const workerImageVersionSchema = z.object({ expectedVersion: z.number().int().positive(), workerImageVersionId: z.string().regex(/^[a-f0-9]{32}$/u) }).strict();

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, code: "validation_failed", error: "Invalid Project update request", issues: error.issues }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Project update failed";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const issues = error && typeof error === "object" && "issues" in error && Array.isArray(error.issues) ? error.issues : undefined;
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "authorization_denied" || message.toLowerCase().includes("access denied")
      ? 403
      : code === "not_found"
        ? 404
        : code === "version_conflict"
          ? 409
          : code === "validation_failed"
            ? 400
            : 500;
  if (status === 500) {
    return NextResponse.json({ ok: false, code: "internal_error", error: "Project update failed" }, { status });
  }
  return NextResponse.json({ ok: false, code: code || "request_failed", error: message, ...(issues?.length ? { issues } : {}) }, { status });
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const actor = await resolveWorkbenchApiActor(request);
    const rawBody = await request.json();
    if (rawBody && typeof rawBody === "object" && "environmentConfiguration" in rawBody) {
      const body = environmentConfigurationSchema.parse(rawBody);
      const result = await updateWorkbenchProjectEnvironmentConfiguration({ userId: actor.userId, projectId, expectedVersion: body.expectedVersion, configuration: body.environmentConfiguration });
      return NextResponse.json({ ok: true, result });
    }
    if (rawBody && typeof rawBody === "object" && "workerDeploymentConfiguration" in rawBody) {
      const body = workerDeploymentConfigurationSchema.parse(rawBody);
      const result = await updateWorkbenchProjectWorkerDeploymentConfiguration({ userId: actor.userId, projectId, expectedVersion: body.expectedVersion, configuration: body.workerDeploymentConfiguration });
      return NextResponse.json({ ok: true, result });
    }
    if (rawBody && typeof rawBody === "object" && "workerImageVersionId" in rawBody) {
      const body = workerImageVersionSchema.parse(rawBody);
      const result = await updateWorkbenchProjectWorkerImageVersion({ userId: actor.userId, projectId, expectedVersion: body.expectedVersion, workerImageVersionId: body.workerImageVersionId });
      return NextResponse.json({ ok: true, result });
    }
    if (rawBody && typeof rawBody === "object" && "loopGroupConfig" in rawBody) {
      const body = loopGroupConfigurationSchema.parse(rawBody);
      const result = await updateWorkbenchProjectLoopGroupConfig({ userId: actor.userId, projectId, expectedVersion: body.expectedVersion, configuration: body.loopGroupConfig });
      return NextResponse.json({ ok: true, result });
    }
    if (rawBody && typeof rawBody === "object" && "repositoryConfiguration" in rawBody) {
      return NextResponse.json({
        ok: false,
        code: "repository_configuration_moved",
        error: "仓库配置已迁移到项目仓库向导，请使用 repository-configuration API。",
      }, { status: 410 });
    }
    if (rawBody && typeof rawBody === "object" && "workerPoolId" in rawBody) {
      const body = workerPoolSchema.parse(rawBody);
      const result = await updateWorkbenchProjectWorkerPool({ userId: actor.userId, projectId, ...body });
      return NextResponse.json({ ok: true, result });
    }
    if (rawBody && typeof rawBody === "object" && "developmentTemplateUpgrade" in rawBody) {
      const body = developmentTemplateUpgradeSchema.parse(rawBody);
      const result = await upgradeWorkbenchProjectDevelopmentMode({
        userId: actor.userId,
        projectId,
        expectedVersion: body.expectedVersion,
        developmentTemplateKey: body.developmentTemplateUpgrade.key,
        developmentTemplateVersion: body.developmentTemplateUpgrade.version,
        developmentTemplateConfig: body.developmentTemplateUpgrade.config,
      });
      return NextResponse.json({ ok: true, result });
    }
    if (rawBody && typeof rawBody === "object" && [
      "developmentTemplateKey",
      "developmentTemplateVersion",
      "developmentTemplateConfig",
    ].some((key) => key in rawBody)) {
      const body = initializeDevelopmentModeSchema.parse(rawBody);
      const result = await initializeWorkbenchProjectDevelopmentMode({ userId: actor.userId, projectId, ...body });
      return NextResponse.json({ ok: true, result });
    }
    const body = updateProjectSchema.parse(rawBody);
    const result = await updateWorkbenchProject({ userId: actor.userId, projectId, shortCode: body.shortCode, expectedVersion: body.expectedVersion });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
