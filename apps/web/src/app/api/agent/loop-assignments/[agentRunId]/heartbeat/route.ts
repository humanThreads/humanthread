import { z } from "zod";
import { agentWorkerCapabilitySnapshotSchema, localAgentBuildVersionSchema } from "../../../../../../../../../packages/shared/src/index";
import { heartbeatLoopAssignmentWithPrisma } from "../../../../../../lib/orchestration/worker-commands";
import {
  authenticateLoopAssignmentRequest,
  LOOP_ASSIGNMENT_LEASE_MS,
  loopAssignmentCommandSchema,
  loopAssignmentFailure,
  loopAssignmentIdSchema,
  loopAssignmentLeaseSchema,
  loopAssignmentOptions,
  loopAssignmentSuccess,
  parseLoopAssignmentBody,
} from "../../route-helpers";

const heartbeatSchema = z.object({
  userId: loopAssignmentIdSchema,
  deviceId: loopAssignmentIdSchema,
  workerId: loopAssignmentIdSchema,
  leaseGeneration: loopAssignmentLeaseSchema,
  commandId: loopAssignmentCommandSchema,
  capabilitySnapshot: agentWorkerCapabilitySnapshotSchema,
  agentVersion: localAgentBuildVersionSchema.optional(),
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(
  request: Request,
  context: { params: Promise<{ agentRunId: string }> },
) {
  try {
    const [{ agentRunId }, body] = await Promise.all([
      context.params,
      parseLoopAssignmentBody(request, heartbeatSchema),
    ]);
    const runId = loopAssignmentIdSchema.parse(agentRunId);
    await authenticateLoopAssignmentRequest(request, body);
    const result = await heartbeatLoopAssignmentWithPrisma({
      agentRunId: runId,
      workerId: body.workerId,
      deviceId: body.deviceId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      capabilitySnapshot: body.capabilitySnapshot,
      ...(body.agentVersion === undefined ? {} : { agentVersion: body.agentVersion }),
      now: new Date(),
      leaseDurationMs: LOOP_ASSIGNMENT_LEASE_MS,
    });
    return loopAssignmentSuccess(request, result);
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
