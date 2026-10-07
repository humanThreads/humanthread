import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { deprecateDevelopmentTemplate } from "@/lib/templates/development-template-commands";
import { POST } from "./route";
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/templates/development-template-commands", () => ({ deprecateDevelopmentTemplate: vi.fn() }));
describe("POST /api/development-templates/:templateId/deprecate", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never); vi.mocked(deprecateDevelopmentTemplate).mockResolvedValue({ id: "template_1", status: "deprecated" } as never); });
  it("deprecates exactly the selected published version", async () => {
    const response = await POST(new Request("http://localhost/api/development-templates/template_1/deprecate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "deprecate_1", expectedRevision: 2 }) }), { params: Promise.resolve({ templateId: "template_1" }) });
    expect(response.status).toBe(200); expect(deprecateDevelopmentTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: "template_1" }));
  });
});
