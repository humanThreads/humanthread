import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(async () => ({ userId: "user_1" })),
}));
vi.mock("@humanthread/db", () => ({
  assertCanReadProject: vi.fn(async () => undefined),
  assertCanWriteProject: vi.fn(async () => undefined),
  createOrReuseWorkerValidationChallenge: vi.fn(),
  readWorkerValidationChallenge: vi.fn(),
  prisma: {
    project: { findUnique: vi.fn() },
    workerPoolSession: { findFirst: vi.fn() },
  },
}));

const context = { params: Promise.resolve({ projectId: "project_1" }) };

describe("/api/projects/:projectId/worker-validation", () => {
  beforeEach(async () => {
    const { prisma } = await import("@humanthread/db");
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      workerPoolId: "a".repeat(32),
      environmentConfigurationVersion: 7,
    } as never);
    vi.mocked(prisma.workerPoolSession.findFirst).mockResolvedValue({
      id: "b".repeat(32),
      instanceId: "worker-1",
      capabilities: { workspace: true, humanthreadEnvironmentConfigurationVersion: 7 },
      lastSeenAt: new Date(),
    } as never);
    const { createOrReuseWorkerValidationChallenge, readWorkerValidationChallenge } = await import("@humanthread/db");
    vi.mocked(createOrReuseWorkerValidationChallenge).mockResolvedValue({ id: "c".repeat(32), status: "pending" } as never);
    vi.mocked(readWorkerValidationChallenge).mockResolvedValue({ id: "c".repeat(32), status: "pending" } as never);
  });

  it("start 从项目绑定 Pool 的真实活跃会话返回逐项报告", async () => {
    const { prisma } = await import("@humanthread/db");
    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-validation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", poolId: "a".repeat(32) }),
    }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      report: {
        status: "pending",
        environmentConfigurationVersion: 7,
        checks: [
          { key: "registration", status: "passed" },
          { key: "heartbeat", status: "passed" },
          { key: "capabilities", status: "passed" },
          { key: "configuration_version", status: "passed" },
          { key: "claim", status: "pending" },
        ],
      },
    });
    expect(prisma.workerPoolSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workerPoolId: "a".repeat(32), status: "active" }),
    }));
    const { createOrReuseWorkerValidationChallenge } = await import("@humanthread/db");
    expect(createOrReuseWorkerValidationChallenge).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1", poolId: "a".repeat(32), sessionId: expect.any(String), environmentConfigurationVersion: 7,
    }));
  });

  it("拒绝未授权 Pool，不创建校验 Assignment", async () => {
    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-validation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", poolId: "b".repeat(32) }),
    }), context);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "authorization_denied" });
  });

  it("没有真实活跃会话时明确返回注册、心跳、能力和配置版本失败", async () => {
    const { prisma } = await import("@humanthread/db");
    vi.mocked(prisma.workerPoolSession.findFirst).mockResolvedValueOnce(null as never);
    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-validation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", poolId: "a".repeat(32) }),
    }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      report: {
        status: "failed",
        checks: [
          { key: "registration", status: "failed" },
          { key: "heartbeat", status: "failed" },
          { key: "capabilities", status: "failed" },
          { key: "configuration_version", status: "stale_configuration" },
          { key: "claim", status: "executor_not_configured" },
        ],
      },
    });
  });

  it("Worker 确认同一 challenge 后复用记录并报告 claim 通过", async () => {
    const { createOrReuseWorkerValidationChallenge, readWorkerValidationChallenge } = await import("@humanthread/db");
    vi.mocked(createOrReuseWorkerValidationChallenge).mockResolvedValueOnce({ id: "c".repeat(32), status: "completed" } as never);
    vi.mocked(readWorkerValidationChallenge).mockResolvedValueOnce({ id: "c".repeat(32), status: "completed" } as never);

    const response = await POST(new Request("http://localhost/api/projects/project_1/worker-validation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", poolId: "a".repeat(32) }),
    }), context);

    const body = await response.json();
    expect(body).toMatchObject({ ok: true, report: { status: "passed" } });
    expect(body.report.checks).toContainEqual(expect.objectContaining({ key: "claim", status: "passed" }));
  });

  it("发起校验要求项目写权限", async () => {
    const { assertCanWriteProject } = await import("@humanthread/db");
    await POST(new Request("http://localhost/api/projects/project_1/worker-validation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", poolId: "a".repeat(32) }),
    }), context);
    expect(assertCanWriteProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
  });
});
