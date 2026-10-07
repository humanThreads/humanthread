import { beforeEach, describe, expect, it, vi } from "vitest";
import { toggleDevelopmentTemplateMarketStar } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@humanthread/db", () => ({ toggleDevelopmentTemplateMarketStar: vi.fn() }));

describe("POST /api/development-templates/:templateId/star", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(toggleDevelopmentTemplateMarketStar).mockResolvedValue({ starred: true, starCount: 4 });
  });

  it("toggles the current user's star", async () => {
    const response = await POST(new Request("http://localhost/api/development-templates/template_1/star", { method: "POST" }), { params: Promise.resolve({ templateId: "template_1" }) });
    expect(response.status).toBe(200);
    expect(toggleDevelopmentTemplateMarketStar).toHaveBeenCalledWith({ templateId: "template_1", userId: "user_1" });
    await expect(response.json()).resolves.toEqual({ ok: true, result: { starred: true, starCount: 4 } });
  });
});
