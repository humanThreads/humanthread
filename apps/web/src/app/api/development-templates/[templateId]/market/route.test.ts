import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { setDevelopmentTemplateMarketVisibility } from "@/lib/templates/development-template-commands";
import { PATCH } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/templates/development-template-commands", () => ({ setDevelopmentTemplateMarketVisibility: vi.fn() }));

describe("PATCH /api/development-templates/:templateId/market", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(setDevelopmentTemplateMarketVisibility).mockResolvedValue({ id: "template_1", isPublic: true } as never);
  });

  it("updates visibility and industry tags with revision control", async () => {
    const response = await PATCH(new Request("http://localhost/api/development-templates/template_1/market", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "market_1", expectedRevision: 2, isPublic: true, industryTags: ["信息技术", "金融业"] }),
    }), { params: Promise.resolve({ templateId: "template_1" }) });
    expect(response.status).toBe(200);
    expect(setDevelopmentTemplateMarketVisibility).toHaveBeenCalledWith({ actorUserId: "user_1", templateId: "template_1", commandId: "market_1", expectedRevision: 2, isPublic: true, industryTags: ["信息技术", "金融业"] });
  });

  it("rejects an unknown industry tag before calling the command", async () => {
    const response = await PATCH(new Request("http://localhost/api/development-templates/template_1/market", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "market_1", expectedRevision: 2, isPublic: true, industryTags: ["不存在的行业"] }),
    }), { params: Promise.resolve({ templateId: "template_1" }) });
    expect(response.status).toBe(400);
    expect(setDevelopmentTemplateMarketVisibility).not.toHaveBeenCalled();
  });
});
