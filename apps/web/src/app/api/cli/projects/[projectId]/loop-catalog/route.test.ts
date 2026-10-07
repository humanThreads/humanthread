import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProjectLoopCatalogV2 } from "../../../../../../lib/orchestration/project-loop-catalog";
import { resolveDesktopApiActor } from "../../../../../../lib/workbench/workbench-api-session";
import { GET } from "./route";

vi.mock("../../../../../../lib/workbench/workbench-api-session", () => ({ resolveDesktopApiActor: vi.fn() }));
vi.mock("../../../../../../lib/orchestration/project-loop-catalog", () => ({
  readProjectLoopCatalogV2: vi.fn(),
}));

const context = { params: Promise.resolve({ projectId: "project_1" }) };

describe("GET /api/cli/projects/:projectId/loop-catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDesktopApiActor).mockResolvedValue({ userId: "user_1", sessionId: "desktop_session_1" });
    vi.mocked(readProjectLoopCatalogV2).mockResolvedValue({
      contractVersion: 2,
      projectId: "project_1",
      catalogVersion: `sha256:${"c".repeat(64)}`,
      projectBindings: [],
      publishedLoops: [],
    });
  });

  it("derives the catalog identity from the logged-in desktop session", async () => {
    const response = await GET(new Request(
      "http://localhost/api/cli/projects/project_1/loop-catalog",
      { headers: { authorization: "Bearer v1.access.signature" } },
    ), context);

    expect(response.status).toBe(200);
    expect(resolveDesktopApiActor).toHaveBeenCalledWith("v1.access.signature");
    expect(readProjectLoopCatalogV2).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
  });

  it("does not accept a caller-supplied user identity", async () => {
    const response = await GET(new Request(
      "http://localhost/api/cli/projects/project_1/loop-catalog?userId=other_user",
      { headers: { authorization: "Bearer v1.access.signature" } },
    ), context);

    expect(response.status).toBe(200);
    expect(readProjectLoopCatalogV2).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect((await response.json()).result.contractVersion).toBe(2);
  });

  it("requires a logged-in CLI session", async () => {
    const response = await GET(new Request("http://localhost/api/cli/projects/project_1/loop-catalog"), context);
    expect(response.status).toBe(401);
    expect(resolveDesktopApiActor).not.toHaveBeenCalled();
  });

  it("reports a missing project as a client error", async () => {
    vi.mocked(readProjectLoopCatalogV2).mockRejectedValue(new Error("Project not found"));

    const response = await GET(new Request(
      "http://localhost/api/cli/projects/missing_project/loop-catalog",
      { headers: { authorization: "Bearer v1.access.signature" } },
    ), { params: Promise.resolve({ projectId: "missing_project" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      code: "not_found",
      error: "Project not found",
    });
  });
});
