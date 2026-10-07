import {
  WorkbenchApiError,
  workbenchQueryKey,
  type WorkbenchContextIdentity,
} from "@humanthread/workbench-client";

export function documentTreeQueryKey(context: WorkbenchContextIdentity) {
  return workbenchQueryKey(context, "documents", { view: "tree" });
}

export function documentDetailQueryKey(
  context: WorkbenchContextIdentity,
  documentId: string,
) {
  return [...workbenchQueryKey(context, "documents"), "detail", documentId];
}

export function documentRevisionsQueryKey(
  context: WorkbenchContextIdentity,
  documentId: string,
) {
  return [...workbenchQueryKey(context, "documents"), "revisions", documentId];
}

function currentVersionFromCause(error: WorkbenchApiError): number | undefined {
  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("body" in cause)) return undefined;
  const body = cause.body;
  if (!body || typeof body !== "object" || !("currentVersion" in body)) return undefined;
  return typeof body.currentVersion === "number" ? body.currentVersion : undefined;
}

export function preserveDocumentConflict(error: unknown, localDraft: string) {
  if (!(error instanceof WorkbenchApiError) || error.kind !== "conflict") return null;
  return {
    preserveDraft: true as const,
    localDraft,
    currentVersion: currentVersionFromCause(error),
  };
}
