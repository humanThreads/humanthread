import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveWorkbenchApiActor: vi.fn(),
  readLoopReviewArtifact: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.resolveWorkbenchApiActor,
}));
vi.mock("@/lib/orchestration/loop-review-artifacts", () => ({
  readLoopReviewArtifact: mocks.readLoopReviewArtifact,
}));

import { GET } from "./route";

describe("Loop review Artifact route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWorkbenchApiActor.mockResolvedValue({ userId: "user_1" });
    mocks.readLoopReviewArtifact.mockResolvedValue({
      artifactId: "a".repeat(32),
      fileName: "chapter-plan.html",
      mimeType: "text/html",
      byteSize: 11,
      bytes: new TextEncoder().encode("<h1>fine</h1>"),
    });
  });

  it("serves only an authorized, non-executable inline HTML preview", async () => {
    const response = await GET(new Request("http://localhost/api/loop-artifacts/x"), {
      params: Promise.resolve({ artifactId: "a".repeat(32) }),
    });

    expect(mocks.readLoopReviewArtifact).toHaveBeenCalledWith({
      userId: "user_1",
      artifactId: "a".repeat(32),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(await response.text()).toContain("fine");
  });
});
