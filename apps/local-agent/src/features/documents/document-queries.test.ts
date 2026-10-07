import { createWorkbenchContextIdentity, WorkbenchApiError } from "@humanthread/workbench-client";
import { describe, expect, it } from "vitest";

import {
  documentDetailQueryKey,
  documentRevisionsQueryKey,
  documentTreeQueryKey,
  preserveDocumentConflict,
} from "./document-queries";

describe("desktop Document queries", () => {
  it("isolates tree, detail and revision caches by deployment, session and Space", () => {
    const context = createWorkbenchContextIdentity({
      deploymentUrl: "https://ht.example.com",
      sessionId: "session_1",
      spaceKey: "company:company_1",
    });

    expect(documentTreeQueryKey(context).slice(0, 4)).toEqual([
      "https://ht.example.com", "session_1", "company:company_1", "documents",
    ]);
    expect(documentDetailQueryKey(context, "doc_1").slice(-2)).toEqual(["detail", "doc_1"]);
    expect(documentRevisionsQueryKey(context, "doc_1").slice(-2)).toEqual(["revisions", "doc_1"]);
  });

  it("preserves the local draft and exposes currentVersion on HTTP 409", () => {
    const error = new WorkbenchApiError({
      kind: "conflict",
      code: "version_conflict",
      message: "Document version conflict",
      status: 409,
      retryable: false,
      cause: { body: { currentVersion: 9 } },
    });

    expect(preserveDocumentConflict(error, "mine")).toEqual({
      preserveDraft: true,
      localDraft: "mine",
      currentVersion: 9,
    });
  });
});
