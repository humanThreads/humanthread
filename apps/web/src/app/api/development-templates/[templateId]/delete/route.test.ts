import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { deleteDevelopmentTemplate } from "@/lib/templates/development-template-commands";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/templates/development-template-commands", () => ({ deleteDevelopmentTemplate: vi.fn() }));

describe("POST /api/development-templates/:templateId/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(deleteDevelopmentTemplate).mockResolvedValue({ id: "template_1", status: "deprecated", isPublic: false } as never);
  });

  it("soft deletes a template with an explicit command and revision", async () => {
    const response = await POST(new Request("http://localhost/api/development-templates/template_1/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "delete_1", expectedRevision: 3 }),
    }), { params: Promise.resolve({ templateId: "template_1" }) });
    expect(response.status).toBe(200);
    expect(deleteDevelopmentTemplate).toHaveBeenCalledWith({ actorUserId: "user_1", templateId: "template_1", commandId: "delete_1", expectedRevision: 3 });
  });
});
