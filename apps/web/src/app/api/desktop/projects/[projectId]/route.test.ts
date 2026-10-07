import { desktopProjectDetailResponseSchema } from "@humanthread/workbench-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readDesktopProjectDetail } from "@/lib/desktop/desktop-read-models";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopProjectDetail: vi.fn() }));

describe("desktop Project detail route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a runtime-validated detail with desktop CORS", async () => {
    const detail = {
      project: {
        id: "project_1", name: "Atlas", spaceLabel: "Acme", objective: null, owner: null,
        status: "draft", health: "healthy", progress: { completed: 0, total: 0, percent: 0 },
        taskCounts: { open: 0, overdue: 0, blocked: 0 }, nextMilestone: null,
        updatedAt: "2026-07-27T08:00:00.000Z", description: null, startAt: null, targetAt: null,
        visibility: "company", capabilities: { edit: false, manageMembers: false, changeLifecycle: false, manageRoadmap: false, nativeWorkspace: false },
      },
      health: { objectiveState: "missing", currentStageName: null, nextAction: "补充项目目标", blockers: 0, overdueTasks: 0 },
      resources: { documents: 0, members: 0, activities: 0, automationState: "未自动化" },
      taskSummary: { total: 0, open: 0, overdue: 0, blocked: 0, completed: 0 },
      roadmap: [], tasks: [], documents: [], risks: [], agents: [],
      workspace: {
        bindingId: "workspace_binding_1",
        status: "ready",
        pathFingerprint: "hmac-sha256:abc123",
        configurationVersion: 2,
        lastValidatedAt: "2026-07-31T08:00:00.000Z",
      },
    };
    vi.mocked(readDesktopProjectDetail).mockResolvedValue({ detail } as never);
    const request = new Request("http://localhost:3000/api/desktop/projects/project_1?space=personal", {
      headers: { origin: "http://localhost:1420" },
    });

    const response = await GET(request, { params: Promise.resolve({ projectId: "project_1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(desktopProjectDetailResponseSchema.parse(await response.json()).data.detail.project.id)
      .toBe("project_1");
  });

  it("returns 404 without leaking a Project from another Space", async () => {
    vi.mocked(readDesktopProjectDetail).mockRejectedValue(new Error("Project not found"));
    const response = await GET(
      new Request("http://localhost:3000/api/desktop/projects/project_other?space=personal"),
      { params: Promise.resolve({ projectId: "project_other" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "project_not_found" });
  });
});
