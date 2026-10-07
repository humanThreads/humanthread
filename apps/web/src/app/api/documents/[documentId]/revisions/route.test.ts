import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

vi.mock("@/lib/workbench/workbench-documents", () => ({
  listWorkbenchDocumentRevisions: vi.fn().mockResolvedValue([
    {
      id: "doc_project_1_readme:v1",
      documentId: "doc_project_1_readme",
      version: 1,
      contentMarkdown: "# Version 1",
      source: "system",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      createdById: "user_owner",
    },
  ]),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_owner" }),
}));

describe("document revisions API", () => {
  it("returns 401 without a signed workbench session", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValueOnce(
      new Error("Workbench API authentication required"),
    );
    const response = await GET(
      new Request("http://localhost/api/documents/doc_1/revisions"),
      { params: Promise.resolve({ documentId: "doc_1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns document revisions", async () => {
    const { listWorkbenchDocumentRevisions } = await import(
      "@/lib/workbench/workbench-documents"
    );
    const response = await GET(
      new Request(
        "http://localhost:3000/api/documents/doc_project_1_readme/revisions?userId=user_owner",
      ),
      {
        params: Promise.resolve({
          documentId: "doc_project_1_readme",
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      revisions: Array<{ id: string; version: number; contentMarkdown: string }>;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      revisions: [
        {
          id: "doc_project_1_readme:v1",
          version: 1,
          contentMarkdown: "# Version 1",
        },
      ],
    });
    expect(vi.mocked(listWorkbenchDocumentRevisions)).toHaveBeenCalledWith({
      documentId: "doc_project_1_readme",
      userId: "user_owner",
    });
  });
});
