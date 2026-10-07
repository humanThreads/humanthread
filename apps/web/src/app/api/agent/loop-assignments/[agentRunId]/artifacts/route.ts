import { z } from "zod";
import { uploadLoopAssignmentArtifactWithPrisma } from "../../../../../../lib/orchestration/worker-commands";
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

const uploadSchema = z.object({
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
  relativePath: z.string().trim().min(1).max(512),
  content: z.string().min(1).max(4 * 1024 * 1024),
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(
  request: Request,
  context: { params: Promise<{ agentRunId: string }> },
) {
  try {
    const [{ agentRunId }, body] = await Promise.all([
      context.params,
      parseLoopAssignmentBody(request, uploadSchema),
    ]);
    await authenticateLoopAssignmentRequest(request, body);
    const result = await uploadLoopAssignmentArtifactWithPrisma({
      ...body,
      agentRunId: loopAssignmentIdSchema.parse(agentRunId),
      now: new Date(),
    });
    return loopAssignmentSuccess(request, result);
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
