export interface DocumentBackfillInput {
  projects: Array<{ id: string; spaceId: string | null }>;
  documents: Array<{
    id: string;
    projectId: string | null;
    spaceId: string | null;
    containerKey: string | null;
  }>;
}

export interface DocumentBackfillPlan {
  assignments: Array<{
    documentId: string;
    spaceId: string;
    containerKey: string;
  }>;
  skippedDocumentIds: string[];
  errors: Array<{ documentId: string; message: string }>;
}

export function planDocumentBackfill(input: DocumentBackfillInput): DocumentBackfillPlan;
export function summarizeDocumentBackfill(plan: DocumentBackfillPlan): {
  assignments: number;
  skippedDocuments: number;
  errors: number;
};
