import { describe, expect, it } from "vitest";
import {
  buildDocumentDirectoryId,
  planDocumentTreeBackfill,
  summarizeDocumentTreeBackfill,
} from "../../../prisma/document-tree-backfill-plan.mjs";

describe("document tree backfill planning", () => {
  it("creates shared nested directories and assigns legacy documents", () => {
    const plan = planDocumentTreeBackfill({
      documents: [
        {
          id: "doc_1",
          spaceId: "space:company:company_1",
          projectId: "project_1",
          containerKey: "project:project_1",
          path: "guides/setup/install.md",
          directoryId: null,
          createdById: "user_1",
          updatedById: "user_1",
        },
        {
          id: "doc_2",
          spaceId: "space:company:company_1",
          projectId: "project_1",
          containerKey: "project:project_1",
          path: "guides/setup/config.md",
          directoryId: null,
          createdById: "user_2",
          updatedById: "user_2",
        },
      ],
    });

    const guidesId = buildDocumentDirectoryId("project:project_1", "guides");
    const setupId = buildDocumentDirectoryId(
      "project:project_1",
      "guides/setup",
    );

    expect(plan.directories).toEqual([
      expect.objectContaining({
        id: guidesId,
        parentId: null,
        name: "guides",
        path: "guides",
      }),
      expect.objectContaining({
        id: setupId,
        parentId: guidesId,
        name: "setup",
        path: "guides/setup",
      }),
    ]);
    expect(plan.assignments).toEqual([
      { documentId: "doc_2", directoryId: setupId, sortOrder: 0 },
      { documentId: "doc_1", directoryId: setupId, sortOrder: 1 },
    ]);
    expect(plan.errors).toEqual([]);
  });

  it("keeps root documents unassigned and skips complete rows", () => {
    const directoryId = buildDocumentDirectoryId(
      "space:space:personal:user_1",
      "notes",
    );
    const plan = planDocumentTreeBackfill({
      documents: [
        {
          id: "root",
          spaceId: "space:personal:user_1",
          projectId: null,
          containerKey: "space:space:personal:user_1",
          path: "README.md",
          directoryId: null,
          createdById: "user_1",
          updatedById: "user_1",
        },
        {
          id: "complete",
          spaceId: "space:personal:user_1",
          projectId: null,
          containerKey: "space:space:personal:user_1",
          path: "notes/today.md",
          directoryId,
          createdById: "user_1",
          updatedById: "user_1",
        },
      ],
    });

    expect(plan.assignments).toEqual([]);
    expect(plan.skippedDocumentIds).toEqual(["root", "complete"]);
    expect(summarizeDocumentTreeBackfill(plan)).toEqual({
      directories: 1,
      assignments: 0,
      skippedDocuments: 2,
      errors: 0,
    });
  });

  it("treats a document assigned to an existing random-id directory as migrated", () => {
    const plan = planDocumentTreeBackfill({
      directories: [
        { id: "dir_random_stock", containerKey: "space:company_1", path: "Stock" },
        { id: "dir_random_spider", containerKey: "space:company_1", path: "Stock/spider" },
      ],
      documents: [{
        id: "doc_existing",
        spaceId: "space_1",
        projectId: null,
        containerKey: "space:company_1",
        path: "Stock/spider/plan.md",
        directoryId: "dir_random_spider",
        createdById: "user_1",
        updatedById: "user_1",
      }],
    });

    expect(plan.directories).toEqual([]);
    expect(plan.assignments).toEqual([]);
    expect(plan.skippedDocumentIds).toEqual(["doc_existing"]);
    expect(plan.errors).toEqual([]);
  });

  it("rejects documents without a complete ownership container", () => {
    const plan = planDocumentTreeBackfill({
      documents: [
        {
          id: "invalid",
          spaceId: null,
          projectId: null,
          containerKey: null,
          path: "notes/today.md",
          directoryId: null,
          createdById: "user_1",
          updatedById: "user_1",
        },
      ],
    });

    expect(plan.errors).toEqual([
      { documentId: "invalid", message: "Document ownership is incomplete" },
    ]);
  });
});
