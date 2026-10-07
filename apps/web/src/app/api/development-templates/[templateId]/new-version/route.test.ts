import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { createDevelopmentTemplateRevisionDraft } from "@/lib/templates/development-template-commands";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/templates/development-template-commands", () => ({ createDevelopmentTemplateRevisionDraft: vi.fn() }));

describe("POST /api/development-templates/:templateId/new-version", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(createDevelopmentTemplateRevisionDraft).mockResolvedValue({ id: "template_v2", status: "draft" } as never);
  });

  it("creates an editable draft version for a published Space template", async () => {
    const response = await POST(new Request("http://localhost/api/development-templates/template_v1/new-version", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "new_version_1" }),
    }), { params: Promise.resolve({ templateId: "template_v1" }) });

    expect(response.status).toBe(201);
    expect(createDevelopmentTemplateRevisionDraft).toHaveBeenCalledWith({ actorUserId: "user_1", templateId: "template_v1", commandId: "new_version_1" });
    expect(await response.json()).toMatchObject({ ok: true, result: { id: "template_v2", status: "draft" } });
  });
});
