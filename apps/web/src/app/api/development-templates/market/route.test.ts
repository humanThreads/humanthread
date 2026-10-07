import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPublicDevelopmentTemplates, listStarredDevelopmentTemplateIds } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@humanthread/db", () => ({
  listPublicDevelopmentTemplates: vi.fn(),
  listStarredDevelopmentTemplateIds: vi.fn(),
}));

describe("GET /api/development-templates/market", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(listPublicDevelopmentTemplates).mockResolvedValue([{ id: "template_1", name: "研发交付" }] as never);
    vi.mocked(listStarredDevelopmentTemplateIds).mockResolvedValue(["template_1"]);
  });

  it("returns market templates and the current user's stars", async () => {
    const response = await GET(new Request("http://localhost/api/development-templates/market?sort=stars"));
    expect(response.status).toBe(200);
    expect(listPublicDevelopmentTemplates).toHaveBeenCalledWith({ sort: "stars", actorUserId: "user_1" });
    expect(listStarredDevelopmentTemplateIds).toHaveBeenCalledWith({ templateIds: ["template_1"], userId: "user_1" });
    await expect(response.json()).resolves.toEqual({ ok: true, result: { templates: [{ id: "template_1", name: "研发交付" }], starredTemplateIds: ["template_1"] } });
  });

  it("maps authentication failures to 401", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValueOnce(new Error("Workbench API authentication required"));
    const response = await GET(new Request("http://localhost/api/development-templates/market"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "authentication_required" });
  });
});
