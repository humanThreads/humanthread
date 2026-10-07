import { NextResponse } from "next/server";
import { upsertProjectWorkerResourceCommand } from "@/lib/orchestration/loop-definition-commands";
import { loopApiError, projectWorkerResourceRequestSchema } from "@/lib/orchestration/loop-definition-contracts";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

type Context = { params: Promise<{ projectId: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const [{ projectId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = projectWorkerResourceRequestSchema.parse(await request.json());
    const result = await upsertProjectWorkerResourceCommand({
      actorUserId: actor.userId,
      projectId,
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
      workerPoolId: body.workerPoolId,
      workerRepositoryUrl: body.workerRepositoryUrl,
      workerBranchPolicy: body.workerBranchPolicy,
      ...(body.workerImageRepository && body.workerImageTag && body.workerImageDigest ? {
        workerImageRepository: body.workerImageRepository,
        workerImageTag: body.workerImageTag,
        workerImageDigest: body.workerImageDigest,
        workerImageResolvedAt: new Date(),
      } : {}),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
