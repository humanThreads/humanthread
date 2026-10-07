import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { copyDevelopmentTemplate } from "@/lib/templates/development-template-commands";
import { POST } from "./route";
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/templates/development-template-commands", () => ({ copyDevelopmentTemplate: vi.fn() }));
describe("POST /api/development-templates/:templateId/copy", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never); vi.mocked(copyDevelopmentTemplate).mockResolvedValue({ id: "copy_1", status: "draft" } as never); });
  it("copies with the authenticated actor", async () => {
    const response = await POST(new Request("http://localhost/api/development-templates/template_1/copy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "copy_1", spaceId: "space_1", name: "Copy" }) }), { params: Promise.resolve({ templateId: "template_1" }) });
    expect(response.status).toBe(201); expect(copyDevelopmentTemplate).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user_1", templateId: "template_1" }));
  });
});
