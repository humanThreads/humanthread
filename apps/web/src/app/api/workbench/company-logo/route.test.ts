import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveWorkbenchCompanyLogoUpload } from "../../../../lib/workbench/workbench-company-logo";
import { resolveWorkbenchSession } from "../../../../lib/workbench/workbench-session";
import { POST } from "./route";

vi.mock("../../../../lib/workbench/workbench-session", () => ({
  resolveWorkbenchSession: vi.fn(),
}));

vi.mock("../../../../lib/workbench/workbench-company-logo", () => ({
  saveWorkbenchCompanyLogoUpload: vi.fn(),
}));

describe("POST /api/workbench/company-logo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the uploaded company logo and redirects back to the company page", async () => {
    vi.mocked(resolveWorkbenchSession).mockResolvedValue({
      loginEmail: "alice@example.com",
      selectedUserId: null,
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_dev",
      },
    });
    vi.mocked(saveWorkbenchCompanyLogoUpload).mockResolvedValue({
      logoUrl: "/uploads/company-logo/company_1/logo.png",
    });

    const formData = new FormData();
    formData.set("companyId", "company_1");
    formData.set("logo", new Blob(["logo"], { type: "image/png" }), "logo.png");

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/company-logo", {
        method: "POST",
        body: formData,
        headers: {
          cookie: "ht_workbench_session=signed%3Dvalue",
        },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/companies/company_1?logo=updated",
    );
    expect(resolveWorkbenchSession).toHaveBeenCalledWith({
      getCookieValue: expect.any(Function),
    });
    expect(saveWorkbenchCompanyLogoUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_owner",
        companyId: "company_1",
        file: expect.objectContaining({
          name: "logo.png",
          type: "image/png",
        }),
      }),
    );
  });

  it("prefers forwarded host headers when redirecting behind ingress", async () => {
    vi.mocked(resolveWorkbenchSession).mockResolvedValue({
      loginEmail: "alice@example.com",
      selectedUserId: null,
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_dev",
      },
    });
    vi.mocked(saveWorkbenchCompanyLogoUpload).mockResolvedValue({
      logoUrl: "/uploads/company-logo/company_1/logo.png",
    });

    const formData = new FormData();
    formData.set("companyId", "company_1");
    formData.set("logo", new Blob(["logo"], { type: "image/png" }), "logo.png");

    const response = await POST(
      new Request("http://0.0.0.0:3000/api/workbench/company-logo", {
        method: "POST",
        body: formData,
        headers: {
          cookie: "ht_workbench_session=signed",
          "x-forwarded-host": "example.com",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://example.com/companies/company_1?logo=updated",
    );
  });
});
