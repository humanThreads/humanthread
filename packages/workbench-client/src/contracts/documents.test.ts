import { describe, expect, it } from "vitest";

import {
  desktopDocumentConflictResponseSchema,
  desktopDocumentDetailResponseSchema,
  desktopDocumentRevisionsResponseSchema,
  desktopDocumentTreeResponseSchema,
  desktopDocumentUpdateRequestSchema,
} from "./documents";

const updatedAt = "2026-07-27T08:00:00.000Z";

describe("desktop Document contracts", () => {
  it("accepts a serialized tree without exposing internal Space identifiers", () => {
    const result = desktopDocumentTreeResponseSchema.parse({
      ok: true,
      data: {
        groups: [{
          key: "project:project_1",
          label: "Atlas",
          projectId: "project_1",
          canWrite: true,
          directories: [{
            id: "directory_1",
            parentId: null,
            name: "设计",
            path: "设计",
            sortOrder: 0,
          }],
          documents: [{
            id: "doc_1",
            directoryId: "directory_1",
            title: "架构说明",
            path: "设计/architecture.md",
            sortOrder: 0,
            route: "/documents/doc_1",
          }],
        }],
        trash: [],
      },
    });

    expect(result.data.groups[0]?.documents[0]?.route).toBe("/documents/doc_1");
    expect(() => desktopDocumentTreeResponseSchema.parse({
      ok: true,
      data: {
        groups: [{
          ...result.data.groups[0],
          spaceId: "space:company:company_1",
        }],
        trash: [],
      },
    })).toThrow();
  });

  it("validates document content, capabilities and ISO dates", () => {
    const result = desktopDocumentDetailResponseSchema.parse({
      ok: true,
      data: {
        detail: {
          id: "doc_1",
          projectId: "project_1",
          title: "架构说明",
          path: "architecture.md",
          contentMarkdown: "# HumanThread",
          version: 8,
          createdAt: updatedAt,
          updatedAt,
          capabilities: { edit: true },
        },
      },
    });

    expect(result.data.detail.version).toBe(8);
    expect(() => desktopDocumentDetailResponseSchema.parse({
      ok: true,
      data: { detail: { ...result.data.detail, spaceId: "space_1" } },
    })).toThrow();
  });

  it("keeps historical Markdown in every revision", () => {
    const result = desktopDocumentRevisionsResponseSchema.parse({
      ok: true,
      data: {
        revisions: [{
          id: "doc_1:v7",
          documentId: "doc_1",
          version: 7,
          contentMarkdown: "历史版本正文",
          source: "desktop",
          createdAt: updatedAt,
          createdById: "user_1",
        }],
      },
    });

    expect(result.data.revisions[0]?.contentMarkdown).toBe("历史版本正文");
  });

  it("requires optimistic version and a bounded idempotent command ID", () => {
    expect(desktopDocumentUpdateRequestSchema.parse({
      commandId: "desktop:document:1",
      expectedVersion: 8,
      title: "架构说明",
      contentMarkdown: "# Updated",
    })).toMatchObject({ expectedVersion: 8 });

    expect(() => desktopDocumentUpdateRequestSchema.parse({
      expectedVersion: 8,
      title: "架构说明",
      contentMarkdown: "# Updated",
    })).toThrow();
  });

  it("requires the current server version in a conflict response", () => {
    expect(desktopDocumentConflictResponseSchema.parse({
      ok: false,
      code: "version_conflict",
      error: "Document version conflict",
      currentVersion: 9,
    }).currentVersion).toBe(9);
  });
});
