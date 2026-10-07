import { z } from "zod";
import { buildLocalAgentWorkerId } from "@humanthread/shared";
import { deactivateAgentWorker, prisma } from "@humanthread/db";

import {
  authenticateLoopAssignmentRequest,
  loopAssignmentFailure,
  loopAssignmentIdSchema,
  loopAssignmentOptions,
  loopAssignmentSuccess,
  parseLoopAssignmentBody,
} from "../route-helpers";

const workerStateSchema = z.object({
  userId: loopAssignmentIdSchema,
  deviceId: loopAssignmentIdSchema,
  workerId: loopAssignmentIdSchema,
  enabled: z.literal(false),
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(request: Request) {
  try {
    const body = await parseLoopAssignmentBody(request, workerStateSchema);
    const actor = await authenticateLoopAssignmentRequest(request, body);
    if (body.workerId !== buildLocalAgentWorkerId(body.deviceId)) {
      throw Object.assign(new Error("Worker does not belong to the authenticated device"), { code: "stale_lease" });
    }
    const result = await prisma.$transaction((tx) => deactivateAgentWorker({
      tx,
      workerId: body.workerId,
      deviceId: body.deviceId,
      now: new Date(),
    }));
    return loopAssignmentSuccess(request, {
      workerId: body.workerId,
      status: "offline",
      invalidated: result.invalidated,
      actorUserId: actor.userId,
    });
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
