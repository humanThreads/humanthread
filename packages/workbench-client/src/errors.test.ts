import { describe, expect, it } from "vitest";

import { normalizeWorkbenchApiError } from "./errors";

describe("normalizeWorkbenchApiError", () => {
  it("maps authorization denial to a forbidden workbench error", () => {
    expect(
      normalizeWorkbenchApiError({
        status: 403,
        body: { code: "authorization_denied", error: "Access denied" },
      }),
    ).toMatchObject({
      name: "WorkbenchApiError",
      kind: "forbidden",
      code: "authorization_denied",
      message: "Access denied",
      status: 403,
      retryable: false,
    });
  });

  it("marks network failures as retryable offline errors", () => {
    expect(normalizeWorkbenchApiError(new TypeError("Failed to fetch"))).toMatchObject({
      kind: "offline",
      code: "network_error",
      retryable: true,
    });
  });
});
