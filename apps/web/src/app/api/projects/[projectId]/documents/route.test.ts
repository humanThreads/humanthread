import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

vi.mock("@/lib/workbench/workbench-documents", () => ({
  listProjectDocuments: vi.fn().mockResolvedValue([
    {
      id: "doc_project_1_readme",
      projectId: "project_1",
      title: "README",
      path: "README.md",
      version: 1,
      updatedAt: new Date("2026-05-19T00:00:00.000Z"),
    },
  ]),
  createWorkbenchDocument: vi.fn().mockResolvedValue({
    id: "doc_2",
    version: 1,
  }),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_owner" }),
}));

describe("project documents API", () => {
  it("returns 401 without a signed workbench session", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValueOnce(
      new Error("Workbench API authentication required"),
    );
    const response = await GET(
      new Request("http://localhost/api/projects/project_1/documents"),
      { params: Promise.resolve({ projectId: "project_1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("lists project documents for a user", async () => {
    const { listProjectDocuments } = await import(
      "@/lib/workbench/workbench-documents"
    );
    const response = await GET(
      new Request(
        "http://localhost:3000/api/projects/project_1/documents?userId=user_owner",
      ),
      {
        params: Promise.resolve({
          projectId: "project_1",
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      documents: Array<{ id: string; path: string }>;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      documents: [
        {
          id: "doc_project_1_readme",
          path: "README.md",
        },
      ],
    });
    expect(vi.mocked(listProjectDocuments)).toHaveBeenCalledWith({
      projectId: "project_1",
      userId: "user_owner",
    });
  });

  it("creates a markdown project document", async () => {
    const { createWorkbenchDocument } = await import(
      "@/lib/workbench/workbench-documents"
    );
    const response = await POST(
      new Request("http://localhost:3000/api/projects/project_1/documents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "user_owner",
          title: "部署说明",
          path: "docs/deploy.md",
          contentMarkdown: "# 部署说明",
          directoryId: "dir_1",
        }),
      }),
      {
        params: Promise.resolve({
          projectId: "project_1",
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      document: { id: string; version: number };
    };

    expect(response.status).toBe(201);
    expect(body).toEqual({
      ok: true,
      document: {
        id: "doc_2",
        version: 1,
      },
    });
    expect(vi.mocked(createWorkbenchDocument)).toHaveBeenCalledWith({
      projectId: "project_1",
      userId: "user_owner",
      title: "部署说明",
      path: "docs/deploy.md",
      contentMarkdown: "# 部署说明",
      directoryId: "dir_1",
      source: "web",
    });
  });

  it("returns 409 when the document path already exists", async () => {
    const { createWorkbenchDocument } = await import(
      "@/lib/workbench/workbench-documents"
    );
    vi.mocked(createWorkbenchDocument).mockRejectedValueOnce(
      new Error("Document path conflict"),
    );

    const response = await POST(
      new Request("http://localhost/api/projects/project_1/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Deploy", path: "deploy.md", contentMarkdown: "# Deploy" }),
      }),
      { params: Promise.resolve({ projectId: "project_1" }) },
    );

    expect(response.status).toBe(409);
  });
});
