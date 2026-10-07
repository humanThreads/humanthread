import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAutomationGrant,
  listProjectAutomationGrants,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { loopApiError } from "../../../lib/orchestration/loop-definition-contracts";

const boundedId = z.string().trim().min(1).max(96);

const createRequestSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  projectId: boundedId,
  grant: z.unknown(),
  confirmationFingerprint: z.string().trim().min(1).max(128),
}).strict();

export async function GET(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const projectId = boundedId.parse(new URL(request.url).searchParams.get("projectId"));
    const result = await listProjectAutomationGrants({
      actorUserId: actor.userId,
      projectId,
      now: new Date(),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = createRequestSchema.parse(await request.json());
    const result = await createAutomationGrant({
      actorUserId: actor.userId,
      projectId: body.projectId,
      commandId: body.commandId,
      grant: body.grant,
      confirmationFingerprint: body.confirmationFingerprint,
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
