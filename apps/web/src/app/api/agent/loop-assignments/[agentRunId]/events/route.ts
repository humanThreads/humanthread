import { z } from "zod";
import { loopAgentEventSchema } from "../../../../../../../../../packages/shared/src/loop-engine";
import { appendLoopAssignmentEventsWithPrisma } from "../../../../../../lib/orchestration/worker-commands";
import {
  authenticateLoopAssignmentRequest,
  loopAssignmentAgentVersionSchema,
  loopAssignmentCommandSchema,
  loopAssignmentFailure,
  loopAssignmentIdSchema,
  loopAssignmentLeaseSchema,
  loopAssignmentOptions,
  loopAssignmentSuccess,
  parseLoopAssignmentBody,
} from "../../route-helpers";

const eventsSchema = z.object({
  userId: loopAssignmentIdSchema,
  deviceId: loopAssignmentIdSchema,
  workerId: loopAssignmentIdSchema,
  agentVersion: loopAssignmentAgentVersionSchema,
  leaseGeneration: loopAssignmentLeaseSchema,
  commandId: loopAssignmentCommandSchema,
  loopNodeAttemptId: loopAssignmentIdSchema,
  events: z.array(loopAgentEventSchema).min(1).max(100),
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(
  request: Request,
  context: { params: Promise<{ agentRunId: string }> },
) {
  try {
    const [{ agentRunId }, body] = await Promise.all([
      context.params,
      parseLoopAssignmentBody(request, eventsSchema),
    ]);
    const runId = loopAssignmentIdSchema.parse(agentRunId);
    const actor = await authenticateLoopAssignmentRequest(request, body);
    const result = await appendLoopAssignmentEventsWithPrisma({
      agentRunId: runId,
      workerId: body.workerId,
      deviceId: actor.deviceId ?? body.deviceId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      loopNodeAttemptId: body.loopNodeAttemptId,
      events: body.events,
      now: new Date(),
    });
    return loopAssignmentSuccess(request, result);
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
