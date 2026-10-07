import { z } from "zod";
import {
  createPrismaLoopEffectDependencies,
  prepareLoopEffect,
} from "../../../../../lib/orchestration/loop-effect-commands";
import {
  authenticateLoopAssignmentRequest,
  loopAssignmentCommandSchema,
  loopAssignmentFailure,
  loopAssignmentIdSchema,
  loopAssignmentLeaseSchema,
  loopAssignmentOptions,
  loopAssignmentSuccess,
  parseLoopAssignmentBody,
} from "../../loop-assignments/route-helpers";

const prepareEffectSchema = z.object({
  userId: loopAssignmentIdSchema,
  deviceId: loopAssignmentIdSchema,
  workerId: loopAssignmentIdSchema,
  agentRunId: loopAssignmentIdSchema,
  leaseGeneration: loopAssignmentLeaseSchema,
  commandId: loopAssignmentCommandSchema,
  id: z.string().trim().min(1).max(128),
  loopRunId: loopAssignmentIdSchema,
  nodeRunId: loopAssignmentIdSchema,
  attemptId: z.string().trim().min(1).max(128).nullable().optional(),
  operationType: z.string().trim().min(1).max(96),
  requestFingerprint: z.string().trim().min(1).max(128),
  providerIdempotencyKey: z.string().trim().min(1).max(191).nullable().optional(),
  request: z.unknown(),
  networkTarget: z.string().trim().min(1).max(191).nullable().optional(),
  claimToken: z.string().trim().min(1).max(128).optional(),
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(request: Request) {
  try {
    const body = await parseLoopAssignmentBody(request, prepareEffectSchema);
    const actor = await authenticateLoopAssignmentRequest(request, body);
    const result = await prepareLoopEffect({
      deviceId: actor.deviceId ?? body.deviceId,
      workerId: body.workerId,
      agentRunId: body.agentRunId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      id: body.id,
      loopRunId: body.loopRunId,
      nodeRunId: body.nodeRunId,
      operationType: body.operationType,
      requestFingerprint: body.requestFingerprint,
      request: body.request,
      ...(body.attemptId === undefined ? {} : { attemptId: body.attemptId }),
      ...(body.providerIdempotencyKey === undefined ? {} : { providerIdempotencyKey: body.providerIdempotencyKey }),
      ...(body.networkTarget === undefined ? {} : { networkTarget: body.networkTarget }),
      ...(body.claimToken === undefined ? {} : { claimToken: body.claimToken }),
      now: new Date(),
    }, createPrismaLoopEffectDependencies());
    return loopAssignmentSuccess(request, result);
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
