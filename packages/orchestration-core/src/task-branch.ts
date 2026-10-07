const SHORT_ID_PATTERN = /^[A-Z][A-Z0-9]{1,31}\d+$/u;

export function deriveTaskBranch(input: { createdAt: Date; shortId: string }): string {
  if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime())) {
    throw new Error("Task creation date is invalid");
  }
  if (!SHORT_ID_PATTERN.test(input.shortId)) {
    throw new Error("Task short ID is invalid");
  }
  return `${input.createdAt.getUTCFullYear()}-${input.shortId}`;
}
