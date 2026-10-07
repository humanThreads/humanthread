export class UserTaskCommandError extends Error {
  readonly code: "validation_failed" | "not_found" | "authorization_denied";

  constructor(
    code: "validation_failed" | "not_found" | "authorization_denied",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "UserTaskCommandError";
    this.code = code;
  }
}

export class TaskAcceptanceEvidenceError extends Error {
  readonly code = "task_acceptance_evidence_required";
  readonly command = "accept";

  constructor(
    readonly currentStatus: string,
    readonly missingChecks: string[],
    readonly blockingChecks: string[],
  ) {
    super("task_acceptance_evidence_required: required acceptance evidence has not passed");
    this.name = "TaskAcceptanceEvidenceError";
  }
}
