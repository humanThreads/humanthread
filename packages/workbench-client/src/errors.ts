export type WorkbenchApiErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "offline"
  | "server"
  | "unknown";

export interface WorkbenchApiErrorOptions {
  kind: WorkbenchApiErrorKind;
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  cause?: unknown;
}

export class WorkbenchApiError extends Error {
  readonly kind: WorkbenchApiErrorKind;
  readonly code: string;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(options: WorkbenchApiErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "WorkbenchApiError";
    this.kind = options.kind;
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

interface HttpErrorLike {
  status: number;
  body?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpErrorLike(value: unknown): value is HttpErrorLike {
  return isRecord(value) && typeof value.status === "number";
}

function kindForStatus(status: number): WorkbenchApiErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unknown";
}

export function normalizeWorkbenchApiError(input: unknown): WorkbenchApiError {
  if (input instanceof WorkbenchApiError) {
    return input;
  }

  if (isHttpErrorLike(input)) {
    const body = isRecord(input.body) ? input.body : {};
    const kind = kindForStatus(input.status);
    const code = typeof body.code === "string" ? body.code : `http_${input.status}`;
    const message =
      typeof body.error === "string" ? body.error : `Workbench request failed (${input.status})`;
    return new WorkbenchApiError({
      kind,
      code,
      message,
      status: input.status,
      retryable: kind === "rate_limited" || kind === "server",
      cause: input,
    });
  }

  if (input instanceof TypeError) {
    return new WorkbenchApiError({
      kind: "offline",
      code: "network_error",
      message: input.message,
      retryable: true,
      cause: input,
    });
  }

  return new WorkbenchApiError({
    kind: "unknown",
    code: "unknown_error",
    message: input instanceof Error ? input.message : "Unknown workbench error",
    retryable: false,
    cause: input,
  });
}
