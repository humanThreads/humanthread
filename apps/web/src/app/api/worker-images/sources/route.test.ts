import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@/lib/orchestration/worker-resource-scope", () => ({
  resolveWorkerProjectScope: vi.fn(async () => ({ ownerType: "company", ownerUserId: null, companyId: "company_1" })),
}));
vi.mock("@humanthread/db", () => ({ listAvailableWorkerImages: vi.fn(async () => [{ id: "a".repeat(32), ownerType: "platform", companyId: null, name: "正式 Worker", repository: "registry.example.com/worker", versions: [{ id: "b".repeat(32), tag: "20260917", digest: `sha256:${"c".repeat(64)}`, publishedAt: null }] }]) }));

describe("GET /api/worker-images/sources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("返回项目可见的平台与本公司来源和不可变版本", async () => {
    const { GET } = await import("./route");
    const { listAvailableWorkerImages } = await import("@humanthread/db");
    const { resolveWorkerProjectScope } = await import("@/lib/orchestration/worker-resource-scope");
    const response = await GET(new Request("http://localhost/api/worker-images/sources?projectId=project_1"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, sources: [expect.objectContaining({ name: "正式 Worker", versions: [expect.objectContaining({ tag: "20260917" })] })] });
    expect(resolveWorkerProjectScope).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(listAvailableWorkerImages).toHaveBeenCalledWith({ companyId: "company_1" });
  });

  it("个人项目只查询平台镜像目录", async () => {
    const { GET } = await import("./route");
    const { listAvailableWorkerImages } = await import("@humanthread/db");
    const { resolveWorkerProjectScope } = await import("@/lib/orchestration/worker-resource-scope");
    vi.mocked(resolveWorkerProjectScope).mockResolvedValueOnce({ ownerType: "personal", ownerUserId: "user_1", companyId: null });
    await GET(new Request("http://localhost/api/worker-images/sources?projectId=project_personal"));
    expect(listAvailableWorkerImages).toHaveBeenLastCalledWith({ companyId: null });
  });

  it("无权读取项目时返回 403，不泄露公司镜像目录", async () => {
    const { GET } = await import("./route");
    const { listAvailableWorkerImages } = await import("@humanthread/db");
    const { resolveWorkerProjectScope } = await import("@/lib/orchestration/worker-resource-scope");
    vi.mocked(resolveWorkerProjectScope).mockRejectedValueOnce(Object.assign(new Error("access denied"), { code: "authorization_denied" }));

    const response = await GET(new Request("http://localhost/api/worker-images/sources?projectId=project_hidden"));

    expect(response.status).toBe(403);
    expect(listAvailableWorkerImages).not.toHaveBeenCalled();
  });
});
