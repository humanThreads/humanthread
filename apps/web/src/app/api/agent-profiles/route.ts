import { NextResponse } from "next/server";
import { z } from "zod";
import { createSpaceAgentProfile } from "@/lib/orchestration/agent-profile-commands";
import { agentProfileApiError } from "@/lib/orchestration/agent-profile-http";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

const createAgentProfileSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  spaceId: z.string().trim().min(1).max(96),
  name: z.string().trim().min(1).max(191),
  provider: z.enum(["codex", "claude"]),
  model: z.string().trim().max(191).nullable().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const [actor, body] = await Promise.all([
      resolveWorkbenchApiActor(request),
      request.json(),
    ]);
    const input = createAgentProfileSchema.parse(body);
    const { model, ...profileInput } = input;
    const result = await createSpaceAgentProfile({
      actorUserId: actor.userId,
      ...profileInput,
      ...(model === undefined ? {} : { model }),
    });
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    return agentProfileApiError(error);
  }
}
