import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@humanthread/db", () => ({
  assertCanReadProject: vi.fn(async () => undefined),
  listWorkerPools: vi.fn(async () => [{ id: "a".repeat(32), displayName: "ht-agnet", status: "active" }]),
  revealWorkerPoolToken: vi.fn(async () => ({ bootstrapToken: "htwp_test_token" })),
  prisma: { user: { findUnique: vi.fn(async () => ({ id: "user_1", status: "active", passwordHash: "hash" })) }, project: { findUnique: vi.fn(async () => ({ shortCode: "HT", workerPoolId: "a".repeat(32), workerImageVersionId: "c".repeat(32), workerImageVersion: { tag: "20260916-a", digest: `sha256:${"b".repeat(64)}`, status: "active", source: { repository: "registry.example.com/worker", status: "active" } }, workerImageRepository: "legacy.example.com/worker", workerImageTag: "legacy", workerImageDigest: `sha256:${"d".repeat(64)}`, environmentConfigurationVersion: 7, workerDeploymentConfiguration: { schemaVersion: 1, kubernetes: { namespace: "saved-ns", persistentStorage: "30Gi", minReplicas: 2, maxReplicas: 5 }, concurrency: 4, healthPort: 9090, capabilities: { workspace: true, commands: true } }, environmentConfiguration: { schemaVersion: 1, entries: [], workerRuntime: { profile: "custom", mountPath: "/workspace", taskSubpath: "/tasks", variables: [] } } })) }, workerPool: { findFirst: vi.fn(async () => ({ displayName: "ht-agnet" })) } },
}));
vi.mock("@/lib/workbench/workbench-auth", () => ({ verifyPasswordHash: vi.fn(() => true) }));
vi.mock("@/lib/workbench/workbench-site-settings", () => ({
  getWorkbenchSiteSettings: vi.fn(async () => ({
    siteBaseUrl: "http://localhost:3000",
    mcpUrl: "http://localhost:3000/api/mcp",
    userTasks: { enabled: false },
  })),
}));
vi.mock("../../../../../lib/orchestration/worker-resource-scope", () => ({
  resolveWorkerProjectScope: vi.fn(async () => ({ ownerType: "personal", ownerUserId: "user_1", companyId: null })),
  resolveWorkerProjectManagementScope: vi.fn(async () => ({ scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" }, companyRole: "admin" })),
}));

describe("POST /api/projects/:projectId/worker-deployment-commands", () => {
  it("returns deploy, update and uninstall commands without starting a runtime", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-deployment-commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project_1", projectShortCode: "HT", poolId: "a".repeat(32), runtime: "docker",
        configVersion: 1, concurrency: 1,
        cpu: "1", memory: "1Gi", gpu: 0, ephemeralStorage: "5Gi", persistentStorage: "5Gi", minReplicas: 1, maxReplicas: 1,
        reauthenticationPassword: "current-password",
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.commands).toHaveLength(3);
    expect(body.result.commands[0].operation).toBe("deploy");
    expect(body.result.commands[0].command).toContain("htwp_test_token");
  });

  it("生成部署命令时使用公开平台地址而非容器监听地址", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("https://0.0.0.0:3000/api/projects/project_1/worker-deployment-commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project_1", projectShortCode: "HT", poolId: "a".repeat(32), runtime: "kubernetes", namespace: "etl",
        configVersion: 1, concurrency: 1,
        cpu: "1", memory: "1Gi", gpu: 0, ephemeralStorage: "5Gi", persistentStorage: "5Gi", minReplicas: 1, maxReplicas: 1,
        reauthenticationPassword: "current-password",
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.commands[0].command).toContain('- name: HT_PLATFORM_URL\n              value: "http://localhost:3000"');
    expect(body.result.commands[0].command).not.toContain("0.0.0.0:3000");
  });

  it("只使用项目已保存的部署配置，不接受前端覆盖 PVC、HPA 和并发", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost:3000/api/projects/project_1/worker-deployment-commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project_1", projectShortCode: "HT", poolId: "a".repeat(32), runtime: "kubernetes",
        namespace: "client-ns", configVersion: 99, concurrency: 99,
        cpu: "1", memory: "1Gi", gpu: 0, ephemeralStorage: "5Gi", persistentStorage: "99Gi", minReplicas: 9, maxReplicas: 9,
        reauthenticationPassword: "current-password",
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.configVersion).toBe(7);
    expect(body.result.commands[0].command).toContain("namespace: saved-ns");
    expect(body.result.commands[0].command).toContain("storage: 30Gi");
    expect(body.result.commands[0].command).toContain("minReplicas: 2");
    expect(body.result.commands[0].command).toContain("maxReplicas: 5");
    expect(body.result.commands[0].command).toContain('HT_MAX_CONCURRENT_RUNS: "4"');
    expect(body.result.commands[0].command).not.toContain("client-ns");
    expect(body.result.commands[0].command).not.toContain("storage: 99Gi");
  });

  it("优先使用项目选中的镜像目录版本，而不是旧的手工镜像字段", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-deployment-commands", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_1", poolId: "a".repeat(32), runtime: "docker", reauthenticationPassword: "current-password" }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.commands[0].command).toContain("registry.example.com/worker@sha256:" + "b".repeat(64));
    expect(body.result.commands[0].command).not.toContain("legacy.example.com/worker");
  });

  it("拒绝已停用的项目镜像目录版本", async () => {
    const { prisma } = await import("@humanthread/db");
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      shortCode: "HT", workerPoolId: "a".repeat(32), workerImageVersionId: "c".repeat(32),
      workerImageVersion: { tag: "20260916-a", digest: `sha256:${"b".repeat(64)}`, status: "disabled", source: { repository: "registry.example.com/worker", status: "active" } },
      workerImageRepository: null, workerImageTag: null, workerImageDigest: null, environmentConfigurationVersion: 7,
      workerDeploymentConfiguration: null, environmentConfiguration: null,
    } as never);
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-deployment-commands", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_1", poolId: "a".repeat(32), runtime: "docker", reauthenticationPassword: "current-password" }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(400);
  });

  it("rejects a configuration for another project", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-deployment-commands", {
      method: "POST", body: JSON.stringify({ projectId: "project_2" }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(400);
  });

  it("以公司管理员角色读取项目 Pool 注册凭据", async () => {
    const { revealWorkerPoolToken } = await import("@humanthread/db");
    const { resolveWorkerProjectManagementScope } = await import("../../../../../lib/orchestration/worker-resource-scope");
    vi.mocked(revealWorkerPoolToken).mockClear();
    vi.mocked(resolveWorkerProjectManagementScope).mockClear();
    const { POST } = await import("./route");

    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-deployment-commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project_1", projectShortCode: "HT", poolId: "a".repeat(32), runtime: "docker",
        configVersion: 1, concurrency: 1,
        cpu: "1", memory: "1Gi", gpu: 0, ephemeralStorage: "5Gi", persistentStorage: "5Gi", minReplicas: 1, maxReplicas: 1,
        reauthenticationPassword: "current-password",
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(200);
    expect(resolveWorkerProjectManagementScope).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(revealWorkerPoolToken).toHaveBeenCalledWith(expect.objectContaining({
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
      companyRole: "admin",
    }));
  });

  it("在没有公司 Worker 资源管理权限时返回明确错误", async () => {
    const { resolveWorkerProjectManagementScope } = await import("../../../../../lib/orchestration/worker-resource-scope");
    vi.mocked(resolveWorkerProjectManagementScope).mockRejectedValueOnce(Object.assign(new Error("Company Worker resource management is required"), { code: "authorization_denied" }));
    const { POST } = await import("./route");

    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-deployment-commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project_1", projectShortCode: "HT", poolId: "a".repeat(32), runtime: "docker",
        configVersion: 1, concurrency: 1,
        cpu: "1", memory: "1Gi", gpu: 0, ephemeralStorage: "5Gi", persistentStorage: "5Gi", minReplicas: 1, maxReplicas: 1,
        reauthenticationPassword: "current-password",
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "authorization_denied", error: "没有管理项目 Worker Pool 的权限" });
  });
});
