export interface DocumentTreeBackfillInput {
  directories?: Array<{
    id: string;
    containerKey: string;
    path: string;
  }>;
  documents: Array<{
    id: string;
    spaceId: string | null;
    projectId: string | null;
    containerKey: string | null;
    path: string;
    directoryId: string | null;
    createdById: string;
    updatedById: string;
  }>;
}

export function buildDocumentDirectoryId(containerKey: string, path: string): string;
export function planDocumentTreeBackfill(input: DocumentTreeBackfillInput): {
  directories: Array<Record<string, unknown>>;
  assignments: Array<{ documentId: string; directoryId: string; sortOrder: number }>;
  skippedDocumentIds: string[];
  errors: Array<{ documentId: string; message: string }>;
};
export function summarizeDocumentTreeBackfill(plan: ReturnType<typeof planDocumentTreeBackfill>): {
  directories: number;
  assignments: number;
  skippedDocuments: number;
  errors: number;
};
