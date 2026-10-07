import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertCanReadProject, getKnowledgeArchitectureVersion, knowledgeProjectDigest } from "@humanthread/db";

import { GET } from "./route";

vi.mock("@humanthread/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@humanthread/db")>()),
  assertCanReadProject: vi.fn(),
  getKnowledgeArchitectureVersion: vi.fn(),
  knowledgeProjectDigest: vi.fn(() => "a".repeat(32)),
}));
vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(async () => ({ userId: "user_1" })),
}));
const readBundleObject = vi.fn();
vi.mock("@/lib/knowledge/architecture-bundle-storage", () => ({
  readArchitectureBundleObject: (...args: unknown[]) => readBundleObject(...args),
}));

const context = { params: Promise.resolve({ projectId: "project_1", viewId: "view_1", bundlePath: ["index.htm"] }) };

describe("GET architecture bundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertCanReadProject).mockResolvedValue({ projectId: "project_1" } as never);
    vi.mocked(getKnowledgeArchitectureVersion).mockResolvedValue({
      id: "view_version_1",
      viewId: "view_1",
      version: 1,
      manifest: { entryNodeKeys: ["web"] } as never,
      contentDigest: "d".repeat(32),
      bundleObjectKey: "architecture/release/index.htm",
      status: "published",
      publishedAt: new Date("2026-09-20T00:00:00.000Z"),
    } as never);
    readBundleObject.mockResolvedValue("<!doctype html><html><body><script>parent.postMessage({type:'humanthread:architecture:ready',nonce:'n'},'*')</script></body></html>");
  });

  it("serves a validated self-contained bundle with a locked-down CSP and no same-origin", async () => {
    const response = await GET(new Request("http://localhost/api"), context);
    expect(response.status).toBe(200);
    expect(assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(knowledgeProjectDigest).toHaveBeenCalledWith("project_1");
    expect(getKnowledgeArchitectureVersion).toHaveBeenCalledWith({ projectDigest: "a".repeat(32), viewId: "view_1" });
    expect(readBundleObject).toHaveBeenCalledWith("architecture/release/index.htm");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("connect-src");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("returns 404 for an unauthorized project without reading the bundle", async () => {
    vi.mocked(assertCanReadProject).mockRejectedValue(Object.assign(new Error("denied"), { code: "project_access_denied" }));
    const response = await GET(new Request("http://localhost/api"), context);
    expect(response.status).toBe(403);
    expect(readBundleObject).not.toHaveBeenCalled();
  });

  it("rejects an unvalidated bundle so the page can fall back to standard rendering", async () => {
    readBundleObject.mockResolvedValue('<script src="https://evil.example/x.js"></script>');
    const response = await GET(new Request("http://localhost/api"), context);
    expect(response.status).toBe(422);
  });
});
