import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { publishDevelopmentTemplate } from "@/lib/templates/development-template-commands";
import { POST } from "./route";
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/templates/development-template-commands", () => ({ publishDevelopmentTemplate: vi.fn() }));
describe("POST /api/development-templates/:templateId/publish", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never); vi.mocked(publishDevelopmentTemplate).mockResolvedValue({ id: "template_1", status: "published" } as never); });
  it("publishes a selected draft revision", async () => {
    const response = await POST(new Request("http://localhost/api/development-templates/template_1/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "publish_1", expectedRevision: 2 }) }), { params: Promise.resolve({ templateId: "template_1" }) });
    expect(response.status).toBe(200); expect(publishDevelopmentTemplate).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));
  });
});
