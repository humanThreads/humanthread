import { NextResponse } from "next/server";
import { assertCanReadProject, prisma, revealWorkerPoolToken } from "@humanthread/db";
import { z } from "zod";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { verifyPasswordHash } from "@/lib/workbench/workbench-auth";
import { getWorkbenchSiteSettings } from "@/lib/workbench/workbench-site-settings";
import { resolveWorkerProjectManagementScope } from "../../../../../lib/orchestration/worker-resource-scope";
import { generateWorkerDeploymentCommands, workerDeploymentConfigurationSchema } from "../../../../../lib/orchestration/worker-deployment-commands";
import { workerRuntimeEnvironmentSchema } from "../../../../../lib/orchestration/worker-runtime-environment";
import { resolveProjectWorkerDeploymentConfiguration } from "../../../../../lib/orchestration/project-worker-deployment-configuration";

const requestSchema = z.object({
  projectId: z.string().trim().min(1).max(96),
  poolId: z.string().regex(/^[a-f0-9]{32}$/u),
  runtime: z.enum(["docker", "kubernetes"]),
  reauthenticationPassword: z.string().trim().min(1).max(1_024),
}).passthrough();

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor, raw] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
      request.json(),
    ]);
    const parsedRequest = requestSchema.parse(raw);
    if (parsedRequest.projectId !== projectId) {
      return NextResponse.json({ ok: false, code: "validation_failed", error: "项目配置与路径不一致" }, { status: 400 });
    }
    await assertCanReadProject({ userId: actor.userId, projectId });
    const [project, managed, user] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { shortCode: true, workerPoolId: true, workerImageVersionId: true, workerImageVersion: { select: { tag: true, digest: true, status: true, source: { select: { repository: true, status: true } } } }, workerImageRepository: true, workerImageTag: true, workerImageDigest: true, workerDeploymentConfiguration: true, environmentConfiguration: true, environmentConfigurationVersion: true } }),
      resolveWorkerProjectManagementScope({ userId: actor.userId, projectId }),
      prisma.user.findUnique({ where: { id: actor.userId }, select: { status: true, passwordHash: true } }),
    ]);
    if (!project?.workerPoolId) throw new Error("项目尚未绑定 Worker Pool");
    if (project.workerPoolId !== parsedRequest.poolId) throw new Error("请求的 Worker Pool 与项目绑定不一致");
    const selectedVersion = project.workerImageVersionId ? project.workerImageVersion : null;
    if (project.workerImageVersionId && (!selectedVersion || selectedVersion.status !== "active" || selectedVersion.source.status !== "active")) {
      throw Object.assign(new Error("项目选择的 Worker 镜像版本不可用"), { code: "validation_failed" });
    }
    const savedImage = selectedVersion
      ? `${selectedVersion.source.repository}@${selectedVersion.digest}`
      : project.workerImageRepository && project.workerImageTag && project.workerImageDigest
        ? `${project.workerImageRepository}@${project.workerImageDigest}`
        : null;
    if (!savedImage) throw new Error("项目尚未配置 Worker 镜像，请先保存镜像版本");
    const { siteBaseUrl } = await getWorkbenchSiteSettings();
    const deploymentConfiguration = resolveProjectWorkerDeploymentConfiguration(project.workerDeploymentConfiguration);
    const runtimeEnvironment = workerRuntimeEnvironmentSchema.safeParse(
      project.environmentConfiguration && typeof project.environmentConfiguration === "object" && !Array.isArray(project.environmentConfiguration)
        ? (project.environmentConfiguration as { workerRuntime?: unknown }).workerRuntime
        : undefined,
    );
    const configuration = workerDeploymentConfigurationSchema.parse({
      projectId,
      projectShortCode: project.shortCode ?? "PROJECT",
      poolId: project.workerPoolId,
      runtime: parsedRequest.runtime,
      namespace: deploymentConfiguration.kubernetes.namespace,
      ...(deploymentConfiguration.kubernetes.storageClass ? { storageClass: deploymentConfiguration.kubernetes.storageClass } : {}),
      image: savedImage,
      imageTag: selectedVersion?.tag ?? project.workerImageTag ?? undefined,
      configVersion: project.environmentConfigurationVersion ?? 1,
      concurrency: deploymentConfiguration.concurrency,
      cpu: "1",
      memory: "1Gi",
      gpu: 0,
      ephemeralStorage: "5Gi",
      persistentStorage: deploymentConfiguration.kubernetes.persistentStorage,
      minReplicas: deploymentConfiguration.kubernetes.minReplicas,
      maxReplicas: deploymentConfiguration.kubernetes.maxReplicas,
      capabilities: deploymentConfiguration.capabilities,
      healthPort: deploymentConfiguration.healthPort,
      runtimeEnvironment: runtimeEnvironment.success ? runtimeEnvironment.data : undefined,
      platformUrl: siteBaseUrl,
    });
    if (!user || user.status !== "active" || !user.passwordHash || !verifyPasswordHash({ password: parsedRequest.reauthenticationPassword, passwordHash: user.passwordHash })) {
      return NextResponse.json({ ok: false, code: "reauthentication_required", error: "生成部署命令需要重新验证当前密码" }, { status: 401 });
    }
    const pool = await prisma.workerPool.findFirst({ where: { id: project.workerPoolId, status: "active" }, select: { displayName: true } });
    if (!pool) throw new Error("项目 Worker Pool 不可用");
    const { bootstrapToken } = await revealWorkerPoolToken({
      poolId: project.workerPoolId,
      actorUserId: actor.userId,
      scope: managed.scope,
      ...(managed.companyRole === undefined ? {} : { companyRole: managed.companyRole }),
      reauthenticated: true,
      now: new Date(),
    });
    return NextResponse.json({ ok: true, result: generateWorkerDeploymentCommands({ ...configuration, poolName: pool.displayName, poolToken: bootstrapToken }) });
  } catch (error) {
    if (error instanceof Error && error.message === "Workbench API authentication required") {
      return NextResponse.json({ ok: false, code: "authentication_required", error: error.message }, { status: 401 });
    }
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    if (code === "authorization_denied" || code === "worker_pool_unauthorized") {
      return NextResponse.json({ ok: false, code, error: "没有管理项目 Worker Pool 的权限" }, { status: 403 });
    }
    if (code === "worker_pool_configuration_required") {
      return NextResponse.json({ ok: false, code, error: "Worker Pool 注册凭据不可用，请联系管理员重新配置" }, { status: 400 });
    }
    if (code === "validation_failed") {
      return NextResponse.json({ ok: false, code, error: "项目 Worker 镜像配置无效或已停用" }, { status: 400 });
    }
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ ok: false, code: "validation_failed", error: "Worker 部署配置无效" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, code: "request_failed", error: "Worker 部署命令生成失败" }, { status: 500 });
  }
}
