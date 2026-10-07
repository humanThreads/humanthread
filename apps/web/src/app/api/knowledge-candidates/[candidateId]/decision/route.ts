import { z } from "zod";
import { NextResponse } from "next/server";

import {
  assertCanWriteProject,
  decideKnowledgeCandidate,
  readKnowledgeCandidateAccess,
} from "@humanthread/db";
import { loopApiError } from "../../../../../lib/orchestration/loop-definition-contracts";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const requestSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  decision: z.enum(["publish", "reject", "supersede"]),
  reason: z.string().trim().max(4_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision !== "publish" && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Knowledge review reason is required",
    });
  }
});

type Context = { params: Promise<{ candidateId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const body = requestSchema.parse(await request.json());
    const [{ candidateId }, actor] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
    ]);
    const access = await readKnowledgeCandidateAccess({ candidateId });
    if (!access) throw Object.assign(new Error("Knowledge candidate not found"), { code: "not_found" });
    await assertCanWriteProject({ userId: actor.userId, projectId: access.projectId });
    const result = await decideKnowledgeCandidate({
      candidateId: access.id,
      actorUserId: actor.userId,
      commandId: body.commandId,
      decision: body.decision,
      ...(body.reason ? { reason: body.reason } : {}),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const response = loopApiError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
