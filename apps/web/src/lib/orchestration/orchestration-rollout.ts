export interface OrchestrationRollout {
  shadowClassification: boolean;
  enforceFailureDecision: boolean;
  enforceMobileSourceIntervention: boolean;
}

interface FailureDecisionLike {
  disposition: string;
  code?: string;
}

export function getOrchestrationRollout(
  env: Record<string, string | undefined> = process.env,
): OrchestrationRollout {
  const enabled = (value: string | undefined) => value?.trim().toLowerCase() === "true";
  return {
    shadowClassification: enabled(env.HUMANTHREAD_LOOP_FAILURE_SHADOW),
    enforceFailureDecision: enabled(env.HUMANTHREAD_LOOP_FAILURE_ENFORCED),
    enforceMobileSourceIntervention: enabled(env.HUMANTHREAD_LOOP_MOBILE_SOURCE_INTERVENTION),
  };
}

export function selectRolledOutFailureDecision<
  TLegacy extends FailureDecisionLike,
  TClassified extends FailureDecisionLike,
>(input: {
  legacyDecision: TLegacy;
  classifiedDecision: TClassified;
  rollout: OrchestrationRollout;
}): {
  appliedDecision: TLegacy | TClassified;
  proposedDecision: TClassified | null;
  shadow: boolean;
} {
  const mobileSource = input.classifiedDecision.code === "MOBILE_SOURCE_UNAVAILABLE";
  const enforced = mobileSource
    ? input.rollout.enforceMobileSourceIntervention
    : input.rollout.enforceFailureDecision;
  return {
    appliedDecision: enforced ? input.classifiedDecision : input.legacyDecision,
    proposedDecision: input.rollout.shadowClassification || enforced ? input.classifiedDecision : null,
    shadow: input.rollout.shadowClassification && !enforced,
  };
}

export function recordLoopFailureDecision(input: {
  loopRunId: string;
  loopNodeRunId: string;
  attemptId: string;
  interactionId?: string | null;
  commandId?: string | null;
  failureFingerprint: string;
  category: string;
  code: string;
  proposedDisposition: string;
  appliedDisposition: string;
  duplicateSuppressed: boolean;
  log?: (event: string, metadata: Record<string, unknown>) => void;
}): void {
  (input.log ?? console.info)("loop_failure_decision", {
    loopRunId: input.loopRunId,
    loopNodeRunId: input.loopNodeRunId,
    attemptId: input.attemptId,
    ...(input.interactionId ? { interactionId: input.interactionId } : {}),
    ...(input.commandId ? { commandId: input.commandId } : {}),
    failureFingerprint: input.failureFingerprint,
    category: input.category,
    code: input.code,
    proposedDisposition: input.proposedDisposition,
    appliedDisposition: input.appliedDisposition,
    duplicateSuppressed: input.duplicateSuppressed,
  });
}
