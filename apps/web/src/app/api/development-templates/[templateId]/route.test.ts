import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { updateDevelopmentTemplateDraft } from "@/lib/templates/development-template-commands";
import { PATCH } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/templates/development-template-commands", () => ({ updateDevelopmentTemplateDraft: vi.fn() }));

describe("PATCH /api/development-templates/:templateId", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never); vi.mocked(updateDevelopmentTemplateDraft).mockResolvedValue({ id: "template_1", revision: 3 } as never); });
  it("forwards a strict draft update with CAS", async () => {
    const response = await PATCH(new Request("http://localhost/api/development-templates/template_1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "update_1", expectedRevision: 2, name: "Delivery" }) }), { params: Promise.resolve({ templateId: "template_1" }) });
    expect(response.status).toBe(200);
    expect(updateDevelopmentTemplateDraft).toHaveBeenCalledWith(expect.objectContaining({ templateId: "template_1", actorUserId: "user_1", expectedRevision: 2 }));
  });
});
