import { describe, expect, it } from "vitest";
import {
  planDocumentBackfill,
  summarizeDocumentBackfill,
} from "../../../prisma/document-backfill-plan.mjs";

describe("document backfill planning", () => {
  it("maps legacy project documents to their project space", () => {
    const plan = planDocumentBackfill({
      projects: [{ id: "project_1", spaceId: "space:company:company_1" }],
      documents: [
        {
          id: "doc_1",
          projectId: "project_1",
          spaceId: null,
          containerKey: null,
        },
      ],
    });

    expect(plan.assignments).toEqual([
      {
        documentId: "doc_1",
        spaceId: "space:company:company_1",
        containerKey: "project:project_1",
      },
    ]);
    expect(plan.errors).toEqual([]);
  });

  it("skips complete rows and rejects missing or conflicting ownership", () => {
    const plan = planDocumentBackfill({
      projects: [
        { id: "project_1", spaceId: "space:company:company_1" },
        { id: "project_without_space", spaceId: null },
      ],
      documents: [
        {
          id: "complete",
          projectId: "project_1",
          spaceId: "space:company:company_1",
          containerKey: "project:project_1",
        },
        {
          id: "missing_space",
          projectId: "project_without_space",
          spaceId: null,
          containerKey: null,
        },
        {
          id: "conflicting",
          projectId: "project_1",
          spaceId: "space:personal:user_1",
          containerKey: "project:project_1",
        },
      ],
    });

    expect(plan.skippedDocumentIds).toEqual(["complete"]);
    expect(plan.errors).toEqual([
      {
        documentId: "missing_space",
        message: "Document project has no space",
      },
      {
        documentId: "conflicting",
        message: "Document ownership conflicts with project",
      },
    ]);
    expect(summarizeDocumentBackfill(plan)).toEqual({
      assignments: 0,
      skippedDocuments: 1,
      errors: 2,
    });
  });
});
