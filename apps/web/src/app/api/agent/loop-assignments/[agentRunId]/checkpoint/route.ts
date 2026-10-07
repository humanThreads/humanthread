import { z } from "zod";
import { saveLoopAssignmentCheckpointWithPrisma } from "../../../../../../lib/orchestration/worker-commands";
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

const checkpointSchema = z.object({
  userId: loopAssignmentIdSchema,
  deviceId: loopAssignmentIdSchema,
  workerId: loopAssignmentIdSchema,
  agentVersion: loopAssignmentAgentVersionSchema,
  leaseGeneration: loopAssignmentLeaseSchema,
  commandId: loopAssignmentCommandSchema,
  loopRunId: loopAssignmentIdSchema,
  loopNodeRunId: loopAssignmentIdSchema,
  loopNodeAttemptId: loopAssignmentIdSchema,
  attemptNo: z.number().int().positive(),
  checkpoint: z.unknown(),
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(
  request: Request,
  context: { params: Promise<{ agentRunId: string }> },
) {
  try {
    const [{ agentRunId }, body] = await Promise.all([
      context.params,
      parseLoopAssignmentBody(request, checkpointSchema),
    ]);
    const runId = loopAssignmentIdSchema.parse(agentRunId);
    const actor = await authenticateLoopAssignmentRequest(request, body);
    const result = await saveLoopAssignmentCheckpointWithPrisma({
      agentRunId: runId,
      workerId: body.workerId,
      deviceId: actor.deviceId ?? body.deviceId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      loopRunId: body.loopRunId,
      loopNodeRunId: body.loopNodeRunId,
      loopNodeAttemptId: body.loopNodeAttemptId,
      attemptNo: body.attemptNo,
      checkpoint: body.checkpoint,
      now: new Date(),
    });
    return loopAssignmentSuccess(request, result);
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
