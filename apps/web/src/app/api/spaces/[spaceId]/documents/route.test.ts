import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

vi.mock("@/lib/workbench/workbench-documents", () => ({
  listSpaceDocuments: vi.fn().mockResolvedValue([{ id: "doc_root", path: "notes.md" }]),
  createWorkbenchSpaceDocument: vi.fn().mockResolvedValue({ id: "doc_root", version: 1 }),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_1" }),
}));

describe("space documents API", () => {
  it("returns 401 without a signed workbench session", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValueOnce(
      new Error("Workbench API authentication required"),
    );
    const response = await GET(
      new Request("http://localhost/api/spaces/space/documents"),
      { params: Promise.resolve({ spaceId: "space:personal:user_1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("lists root documents in a space", async () => {
    const response = await GET(
      new Request("http://localhost/api/spaces/space%3Apersonal%3Auser_1/documents?userId=user_1"),
      { params: Promise.resolve({ spaceId: "space:personal:user_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("creates a root document through space authorization", async () => {
    const { createWorkbenchSpaceDocument } = await import(
      "@/lib/workbench/workbench-documents"
    );
    const response = await POST(
      new Request("http://localhost/api/spaces/space%3Acompany%3Acompany_1/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user_attacker",
          title: "Policy",
          path: "policy.md",
          contentMarkdown: "# Policy",
        }),
      }),
      { params: Promise.resolve({ spaceId: "space:company:company_1" }) },
    );

    expect(response.status).toBe(201);
    expect(createWorkbenchSpaceDocument).toHaveBeenCalledWith({
      userId: "user_1",
      spaceId: "space:company:company_1",
      title: "Policy",
      path: "policy.md",
      contentMarkdown: "# Policy",
      source: "web",
    });
  });

  it("returns 409 when the document path already exists", async () => {
    const { createWorkbenchSpaceDocument } = await import(
      "@/lib/workbench/workbench-documents"
    );
    vi.mocked(createWorkbenchSpaceDocument).mockRejectedValueOnce(
      new Error("Document path conflict"),
    );

    const response = await POST(
      new Request("http://localhost/api/spaces/space_1/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Policy", path: "policy.md", contentMarkdown: "# Policy" }),
      }),
      { params: Promise.resolve({ spaceId: "space_1" }) },
    );

    expect(response.status).toBe(409);
  });
});
