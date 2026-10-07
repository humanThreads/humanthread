import { describe, expect, it, vi } from "vitest";
import { GET, PATCH, PUT } from "./route";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

vi.mock("@/lib/workbench/workbench-documents", () => ({
  getWorkbenchDocument: vi.fn().mockResolvedValue({
    id: "doc_project_1_readme",
    projectId: "project_1",
    title: "README",
    path: "README.md",
    contentMarkdown: "# HumanThread",
    version: 1,
    createdAt: new Date("2026-05-19T00:00:00.000Z"),
    updatedAt: new Date("2026-05-19T00:00:00.000Z"),
  }),
  updateWorkbenchDocument: vi.fn().mockResolvedValue({
    id: "doc_project_1_readme",
    version: 2,
  }),
  moveWorkbenchDocument: vi.fn().mockResolvedValue({ id: "doc_project_1_readme" }),
  restoreWorkbenchDocument: vi.fn().mockResolvedValue({ id: "doc_project_1_readme" }),
  trashWorkbenchDocument: vi.fn().mockResolvedValue({ id: "doc_project_1_readme" }),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_owner" }),
}));

describe("document detail API", () => {
  it("returns 401 without a signed workbench session", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValueOnce(
      new Error("Workbench API authentication required"),
    );
    const response = await GET(
      new Request("http://localhost/api/documents/doc_1"),
      { params: Promise.resolve({ documentId: "doc_1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns a markdown document", async () => {
    const { getWorkbenchDocument } = await import(
      "@/lib/workbench/workbench-documents"
    );
    const response = await GET(
      new Request(
        "http://localhost:3000/api/documents/doc_project_1_readme?userId=user_owner",
      ),
      {
        params: Promise.resolve({
          documentId: "doc_project_1_readme",
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      document: { id: string; contentMarkdown: string };
    };

    expect(response.status).toBe(200);
    expect(body.document).toMatchObject({
      id: "doc_project_1_readme",
      contentMarkdown: "# HumanThread",
    });
    expect(vi.mocked(getWorkbenchDocument)).toHaveBeenCalledWith({
      documentId: "doc_project_1_readme",
      userId: "user_owner",
    });
  });

  it("updates a markdown document", async () => {
    const { updateWorkbenchDocument } = await import(
      "@/lib/workbench/workbench-documents"
    );
    const response = await PUT(
      new Request("http://localhost:3000/api/documents/doc_project_1_readme", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "user_attacker",
          expectedVersion: 1,
          title: "README",
          contentMarkdown: "# Updated",
        }),
      }),
      {
        params: Promise.resolve({
          documentId: "doc_project_1_readme",
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      document: { id: string; version: number };
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      document: {
        id: "doc_project_1_readme",
        version: 2,
      },
    });
    expect(vi.mocked(updateWorkbenchDocument)).toHaveBeenCalledWith({
      documentId: "doc_project_1_readme",
      userId: "user_owner",
      expectedVersion: 1,
      title: "README",
      contentMarkdown: "# Updated",
      source: "web",
    });
  });

  it("returns 409 for version conflicts", async () => {
    const { updateWorkbenchDocument } = await import(
      "@/lib/workbench/workbench-documents"
    );
    vi.mocked(updateWorkbenchDocument).mockRejectedValueOnce(
      new Error("Document version conflict"),
    );

    const response = await PUT(
      new Request("http://localhost:3000/api/documents/doc_project_1_readme", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "user_owner",
          expectedVersion: 1,
          title: "README",
          contentMarkdown: "# Updated",
        }),
      }),
      {
        params: Promise.resolve({
          documentId: "doc_project_1_readme",
        }),
      },
    );
    const body = (await response.json()) as { ok: boolean; error: string };

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: "Document version conflict",
    });
  });

  it("returns 409 when restore cannot reuse the original path", async () => {
    const { restoreWorkbenchDocument } = await import(
      "@/lib/workbench/workbench-documents"
    );
    vi.mocked(restoreWorkbenchDocument).mockRejectedValueOnce(
      new Error("Document restore path conflict"),
    );

    const response = await PATCH(
      new Request("http://localhost/api/documents/doc_project_1_readme", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "restore" }),
      }),
      { params: Promise.resolve({ documentId: "doc_project_1_readme" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Document restore path conflict",
    });
  });
});
