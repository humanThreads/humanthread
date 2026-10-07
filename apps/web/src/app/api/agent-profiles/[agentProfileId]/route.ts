import { NextResponse } from "next/server";
import { z } from "zod";
import { setSpaceAgentProfileStatus } from "@/lib/orchestration/agent-profile-commands";
import { agentProfileApiError } from "@/lib/orchestration/agent-profile-http";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

type Context = { params: Promise<{ agentProfileId: string }> };

const updateAgentProfileSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  status: z.enum(["active", "disabled"]),
}).strict();

export async function PATCH(request: Request, context: Context) {
  try {
    const [{ agentProfileId }, actor, body] = await Promise.all([
      context.params,
      resolveWorkbenchApiActor(request),
      request.json(),
    ]);
    const input = updateAgentProfileSchema.parse(body);
    const result = await setSpaceAgentProfileStatus({
      actorUserId: actor.userId,
      agentProfileId,
      ...input,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return agentProfileApiError(error);
  }
}
