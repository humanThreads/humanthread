import { beforeEach, describe, expect, it, vi } from "vitest";
import { compareDevelopmentTemplateVersions } from "@/lib/templates/development-template-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET } from "./route";
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@/lib/templates/development-template-commands", () => ({ compareDevelopmentTemplateVersions: vi.fn() }));
describe("GET /api/development-templates/:templateId/compare", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never); vi.mocked(compareDevelopmentTemplateVersions).mockResolvedValue({ changedConfigKeys: ["stagingBranch"], loopVersions: { from: ["a", "b"], to: ["c", "d"] } } as never); });
  it("compares two versions within an authorized Space", async () => {
    const response = await GET(new Request("http://localhost/api/development-templates/template_copy_v1/compare?spaceId=space_1&fromVersion=1&toVersion=2"), { params: Promise.resolve({ templateId: "template_copy_v1" }) });
    expect(response.status).toBe(200); expect(compareDevelopmentTemplateVersions).toHaveBeenCalledWith({ actorUserId: "user_1", templateId: "template_copy_v1", spaceId: "space_1", fromVersion: 1, toVersion: 2 });
  });
});
