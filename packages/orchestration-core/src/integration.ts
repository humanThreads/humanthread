export function requestMergeApproval(input: { taskId: string; branchName: string; headCommit: string; baseCommit: string; checksPassed: boolean; cleanDiff: boolean }) {
  if (!input.checksPassed || !input.cleanDiff) throw Object.assign(new Error("Integration evidence is incomplete"), { code: "validation_failed" });
  return { required: true as const, type: "merge" as const, fingerprint: `${input.branchName}:${input.headCommit}:${input.baseCommit}`, taskId: input.taskId };
}

export function validateMergeGrant(input: { fingerprint: string; grant: { actionFingerprint: string; expiresAt: Date }; now: Date }) {
  return input.grant.actionFingerprint === input.fingerprint && input.grant.expiresAt > input.now;
}
