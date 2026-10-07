import { z } from "zod";
import { localRouteDecisionSchema, loopNodeResultSchema } from "../../../../../../../../../packages/shared/src/loop-engine";
import { completeLoopAssignmentWithPrisma } from "../../../../../../lib/orchestration/worker-commands";
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

const resultIdentitySchema = z.object({
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
}).strict();

const resultSchema = z.union([
  resultIdentitySchema.extend({ result: loopNodeResultSchema }).strict(),
  resultIdentitySchema.extend({ result: loopNodeResultSchema, routeDecision: localRouteDecisionSchema }).strict(),
]);

const offlineStageResultSchema = z.object({
  status: z.literal("continue"),
  record: z.object({
    provisionalStepId: loopAssignmentIdSchema,
    routeDecision: localRouteDecisionSchema,
    grant: z.record(z.string(), z.unknown()),
    checkpoint: z.record(z.string(), z.unknown()),
  }).passthrough(),
  stageResult: loopNodeResultSchema,
}).passthrough();

const ingressSchema = z.union([
  resultSchema,
  resultIdentitySchema.extend({ offlineStageResult: offlineStageResultSchema }).strict(),
]);

export const OPTIONS = loopAssignmentOptions;

export async function POST(
  request: Request,
  context: { params: Promise<{ agentRunId: string }> },
) {
  try {
    const [{ agentRunId }, body] = await Promise.all([
      context.params,
      parseLoopAssignmentBody(request, ingressSchema),
    ]);
    const runId = loopAssignmentIdSchema.parse(agentRunId);
    const actor = await authenticateLoopAssignmentRequest(request, body);
    const offline = "offlineStageResult" in body ? body.offlineStageResult : null;
    const routeDecision = offline?.record.routeDecision ?? ("routeDecision" in body ? body.routeDecision : undefined);
    const stageResult = offline?.stageResult ?? ("result" in body ? body.result : undefined);
    if (!stageResult || (offline !== null && !routeDecision)) {
      return loopAssignmentSuccess(request, { accepted: false, suffixRejected: true });
    }
    const result = await completeLoopAssignmentWithPrisma({
      agentRunId: runId,
      workerId: body.workerId,
      deviceId: actor.deviceId ?? body.deviceId,
      leaseGeneration: body.leaseGeneration,
      commandId: body.commandId,
      loopRunId: body.loopRunId,
      loopNodeRunId: body.loopNodeRunId,
      loopNodeAttemptId: body.loopNodeAttemptId,
      attemptNo: body.attemptNo,
      result: stageResult,
      ...(routeDecision === undefined ? {} : { routeDecision }),
      now: new Date(),
    });
    return loopAssignmentSuccess(request, result);
  } catch (error) {
    return loopAssignmentFailure(request, error);
  }
}
