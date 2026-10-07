import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertCanReadProject } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

import { GET } from "./route";

vi.mock("@humanthread/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@humanthread/db")>()),
  assertCanReadProject: vi.fn(),
  knowledgeProjectDigest: vi.fn(() => "a".repeat(32)),
}));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ projectId: "project_1" }) };

describe("GET knowledge search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(assertCanReadProject).mockResolvedValue({ projectId: "project_1" } as never);
    process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_URL = "http://indexer.local";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } })));
  });

  it("authorizes before forwarding only the project digest", async () => {
    const response = await GET(new Request("http://localhost/api/projects/project_1/knowledge/search?q=发布"), context);
    expect(response.status).toBe(200);
    expect(assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(String(fetchCall[0])).toBe("http://indexer.local/v1/search");
    expect(fetchCall[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ projectDigest: "a".repeat(32), query: "发布", limit: 10 }),
    });
  });

  it("rejects unauthorized access without calling the indexer", async () => {
    vi.mocked(assertCanReadProject).mockRejectedValue(Object.assign(new Error("denied"), { code: "project_access_denied" }));
    const response = await GET(new Request("http://localhost/api/projects/project_1/knowledge/search?q=x"), context);
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 503 when the indexer is unavailable", async () => {
    delete process.env.HUMANTHREAD_KNOWLEDGE_INDEXER_URL;
    const response = await GET(new Request("http://localhost/api/projects/project_1/knowledge/search?q=x"), context);
    expect(response.status).toBe(503);
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));
    const response = await GET(new Request("http://localhost/api/projects/project_1/knowledge/search?q=x"), context);
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
