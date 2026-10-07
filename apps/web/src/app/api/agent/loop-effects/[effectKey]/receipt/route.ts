import { z } from "zod";
import {
  createPrismaLoopEffectDependencies,
  recordLoopEffectReceipt,
} from "../../../../../../lib/orchestration/loop-effect-commands";
import {
  authenticateLoopAssignmentRequest,
  loopAssignmentCommandSchema,
  loopAssignmentFailure,
  loopAssignmentIdSchema,
  loopAssignmentLeaseSchema,
  loopAssignmentOptions,
  loopAssignmentSuccess,
  parseLoopAssignmentBody,
} from "../../../loop-assignments/route-helpers";

const receiptSchema = z.object({
  userId: loopAssignmentIdSchema,
  deviceId: loopAssignmentIdSchema,
  workerId: loopAssignmentIdSchema,
  agentRunId: loopAssignmentIdSchema,
  leaseGeneration: loopAssignmentLeaseSchema,
  commandId: loopAssignmentCommandSchema,
  loopRunId: loopAssignmentIdSchema,
  nodeRunId: loopAssignmentIdSchema,
  attemptId: z.string().trim().min(1).max(128).nullable().optional(),
  operationType: z.string().trim().min(1).max(96),
  requestFingerprint: z.string().trim().min(1).max(128),
  status: z.enum(["succeeded", "failed", "reconciliation_required"]),
  providerReceipt: z.unknown().optional(),
  resultFingerprint: z.string().trim().min(1).max(128).optional(),
  networkTarget: z.string().trim().min(1).max(191).nullable().optional(),
  claimToken: z.string().trim().min(1).max(128).optional(),
}).strict();

export const OPTIONS = loopAssignmentOptions;

export async function POST(
  request: Request,
  context: { params: Promise<{ effectKey: string }> },
) {
  try {
    const [{ effectKey }, body] = await Promise.all([
      context.params,
      parseLoopAssignmentBody(request, receiptSchema),
    ]);
    const parsedEffectKey = z.string().trim().min(1).max(191).parse(effectKey);
    const actor = await authenticateLoopAssignmentRequest(request, body);
    const result = await recordLoopEffectReceipt({
      effectKey: parsedEffectKey,
      deviceId: actor.deviceId ?? body.deviceId,
      workerId: body.workerId,
      agentRunId: body.agentRunId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      loopRunId: body.loopRunId,
      nodeRunId: body.nodeRunId,
      operationType: body.operationType,
      requestFingerprint: body.requestFingerprint,
      status: body.status,
      ...(body.attemptId === undefined ? {} : { attemptId: body.attemptId }),
      ...(body.providerReceipt === undefined ? {} : { providerReceipt: body.providerReceipt }),
      ...(body.resultFingerprint === undefined ? {} : { resultFingerprint: body.resultFingerprint }),
      ...(body.networkTarget === undefined ? {} : { networkTarget: body.networkTarget }),
      ...(body.claimToken === undefined ? {} : { claimToken: body.claimToken }),
      now: new Date(),
    }, createPrismaLoopEffectDependencies());
    return loopAssignmentSuccess(request, result);
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
