export function evaluateApprovalRequirement(input: { requestedAction: { type: string }; effectivePolicy: { autoApprove: string[] } }) {
  return input.effectivePolicy.autoApprove.includes(input.requestedAction.type)
    ? { required: false as const }
    : { required: true as const, type: input.requestedAction.type };
}
