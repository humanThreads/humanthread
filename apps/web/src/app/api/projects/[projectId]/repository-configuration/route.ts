import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getProjectRepository,
  saveProjectRepositoryConfiguration,
} from "@humanthread/db";
import {
  projectRepositoryAuthModeSchema,
  projectRepositoryCreationModeSchema,
  projectRepositoryProviderSchema,
} from "@humanthread/shared";

import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const nullableUrl = z.string().trim().max(1024).nullable().optional();
const saveSchema = z.object({
  expectedVersion: z.number().int().positive(),
  repositoryUrl: z.string().trim().min(1).max(1024),
  allowedBranches: z.array(z.string().trim().min(1).max(191)).min(1).max(64),
  provider: projectRepositoryProviderSchema,
  creationMode: projectRepositoryCreationModeSchema,
  authMode: projectRepositoryAuthModeSchema,
  privateBaseUrl: nullableUrl,
  privateWebUrl: nullableUrl,
  privateTokenHelpUrl: nullableUrl,
}).strict();

function failure(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, code: "validation_failed", error: "项目仓库配置无效", issues: error.issues }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "项目仓库配置保存失败";
  const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
    ? String(Reflect.get(error, "code"))
    : "request_failed";
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "not_found"
      ? 404
      : code === "version_conflict"
        ? 409
        : code === "authorization_denied" || code === "private_host_not_allowed"
          ? 403
          : code === "validation_failed" || code === "provider_unsupported"
            ? 400
            : 500;
  return NextResponse.json(
    status === 500
      ? { ok: false, code: "internal_error", error: "项目仓库配置保存失败" }
      : { ok: false, code, error: message },
    { status },
  );
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor] = await Promise.all([context.params, resolveWorkbenchApiActor(request)]);
    return NextResponse.json({ ok: true, result: await getProjectRepository({ projectId, actorUserId: actor.userId }) });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor, rawBody] = await Promise.all([context.params, resolveWorkbenchApiActor(request), request.json()]);
    const body = saveSchema.parse(rawBody);
    return NextResponse.json({
      ok: true,
      result: await saveProjectRepositoryConfiguration({
        actorUserId: actor.userId,
        projectId,
        expectedVersion: body.expectedVersion,
        repositoryUrl: body.repositoryUrl,
        allowedBranches: body.allowedBranches,
        provider: body.provider,
        creationMode: body.creationMode,
        authMode: body.authMode,
        privateBaseUrl: body.privateBaseUrl ?? null,
        privateWebUrl: body.privateWebUrl ?? null,
        privateTokenHelpUrl: body.privateTokenHelpUrl ?? null,
      }),
    });
  } catch (error) {
    return failure(error);
  }
}
