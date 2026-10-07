import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeAutomationGrant } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { loopApiError } from "../../../../../lib/orchestration/loop-definition-contracts";

type Context = { params: Promise<{ grantId: string }> };

const revokeRequestSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(96),
}).strict();

export async function POST(request: Request, context: Context) {
  try {
    const [{ grantId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const body = revokeRequestSchema.parse(await request.json());
    const result = await revokeAutomationGrant({
      actorUserId: actor.userId,
      projectId: body.projectId,
      grantId,
      commandId: body.commandId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
