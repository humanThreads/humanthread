import { z } from "zod";
import { readLocalWorkerAssignmentSequenceWithPrisma } from "../../../../../../lib/orchestration/worker-commands";
import {
  authenticateLoopAssignmentRequest,
  loopAssignmentFailure,
  loopAssignmentIdSchema,
  loopAssignmentLeaseSchema,
  loopAssignmentOptions,
  loopAssignmentSuccess,
  parseLoopAssignmentBody,
} from "../../route-helpers";

const schema = z.object({
  userId: loopAssignmentIdSchema,
  deviceId: loopAssignmentIdSchema,
  workerId: loopAssignmentIdSchema,
  leaseGeneration: loopAssignmentLeaseSchema,
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(request: Request, context: { params: Promise<{ agentRunId: string }> }) {
  try {
    const [{ agentRunId }, body] = await Promise.all([context.params, parseLoopAssignmentBody(request, schema)]);
    const actor = await authenticateLoopAssignmentRequest(request, body);
    const result = await readLocalWorkerAssignmentSequenceWithPrisma({
      agentRunId: loopAssignmentIdSchema.parse(agentRunId),
      workerId: body.workerId,
      leaseGeneration: body.leaseGeneration,
      now: new Date(),
    });
    return loopAssignmentSuccess(request, result);
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
