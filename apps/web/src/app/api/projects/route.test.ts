import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchProject } from "@/lib/workbench/workbench-project-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/workbench/workbench-project-commands", () => ({ createWorkbenchProject: vi.fn() }));

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_session",
      authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("creates a project with the signed session actor", async () => {
    vi.mocked(createWorkbenchProject).mockResolvedValue({ projectId: "project_new", version: 1 });
    const request = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "forged",
        spaceId: "space_company",
        name: "文档平台",
        objective: "统一知识交付",
        managerUserId: "user_manager",
        startAt: "2026-07-23T00:00:00.000Z",
        targetAt: "2026-08-23T00:00:00.000Z",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(createWorkbenchProject).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_session",
      spaceId: "space_company",
      name: "文档平台",
      managerUserId: "user_manager",
      startAt: new Date("2026-07-23T00:00:00.000Z"),
    }));
  });

  it("passes the exact development template selection to the command", async () => {
    vi.mocked(createWorkbenchProject).mockResolvedValue({ projectId: "project_new", version: 1 });
    const response = await POST(new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spaceId: "space_company",
        name: "Atlas",
        objective: "Ship Atlas",
        managerUserId: "user_manager",
        developmentTemplateKey: "branch-development",
        developmentTemplateVersion: 1,
        developmentTemplateConfig: {
          productionBranch: "main",
          stagingBranch: "staging",
          releaseAgentProfileId: "profile_release",
        },
      }),
    }));

    expect(response.status).toBe(201);
    expect(createWorkbenchProject).toHaveBeenCalledWith(expect.objectContaining({
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 1,
      developmentTemplateConfig: {
        productionBranch: "main",
        stagingBranch: "staging",
        releaseAgentProfileId: "profile_release",
      },
    }));
  });

  it("returns field issues for an invalid request", async () => {
    const response = await POST(new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: "", name: "" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("returns 401 when the request has no authenticated actor", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await POST(new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spaceId: "space_company",
        name: "文档平台",
        objective: "统一知识交付",
        managerUserId: "user_manager",
      }),
    }));

    expect(response.status).toBe(401);
    expect(createWorkbenchProject).not.toHaveBeenCalled();
  });

  it("does not expose unexpected persistence errors", async () => {
    vi.mocked(createWorkbenchProject).mockRejectedValue(new Error("database connection string leaked"));

    const response = await POST(new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spaceId: "space_company",
        name: "文档平台",
        objective: "统一知识交付",
        managerUserId: "user_manager",
      }),
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, code: "internal_error", error: "Project creation failed" });
  });
});
