import { NextResponse } from "next/server";
import { z } from "zod";
import { createProjectEnvironmentSecret, getProjectRepository, listProjectEnvironmentSecrets, rotateProjectEnvironmentSecret } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "../../../../../lib/workbench/workbench-api-session";

const secretInput = z.object({ name: z.string().trim().min(1).max(191), value: z.string().min(1).max(32_768) }).strict();

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "项目环境凭证操作失败";
  const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
    ? String(Reflect.get(error, "code"))
    : "request_failed";
  const status = message === "Workbench API authentication required"
    ? 401
    : code === "repository_credential_managed"
      ? 409
      : /access denied|not authorized|unauthorized|权限/iu.test(message)
        ? 403
        : 400;
  return NextResponse.json({ ok: false, ...(code === "request_failed" ? {} : { code }), error: message }, { status });
}

async function assertLegacyGitSecretMutationAllowed(projectId: string, actorUserId: string, name: string): Promise<void> {
  if (!name.trim().toUpperCase().startsWith("HT_GIT_")) return;
  const repository = await getProjectRepository({ projectId, actorUserId });
  if (repository.configuration) {
    throw Object.assign(new Error("项目仓库凭证由项目仓库向导托管，请在该向导中轮换。"), { code: "repository_credential_managed" });
  }
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId } = await context.params;
    return NextResponse.json({ ok: true, result: await listProjectEnvironmentSecrets({ projectId, actorUserId: actor.userId }) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId } = await context.params;
    const body = secretInput.parse(await request.json());
    await assertLegacyGitSecretMutationAllowed(projectId, actor.userId, body.name);
    return NextResponse.json({ ok: true, result: await createProjectEnvironmentSecret({ projectId, ...body, actorUserId: actor.userId }) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { projectId } = await context.params;
    const body = secretInput.parse(await request.json());
    await assertLegacyGitSecretMutationAllowed(projectId, actor.userId, body.name);
    return NextResponse.json({ ok: true, result: await rotateProjectEnvironmentSecret({ projectId, ...body, actorUserId: actor.userId }) });
  } catch (error) {
    return errorResponse(error);
  }
}
