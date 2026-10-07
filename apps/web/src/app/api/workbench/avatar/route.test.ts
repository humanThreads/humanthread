import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { resolveWorkbenchSession } from "../../../../lib/workbench/workbench-session";
import { saveWorkbenchAvatarUpload } from "../../../../lib/workbench/workbench-avatar";
import { revalidateTag } from "next/cache";

vi.mock("../../../../lib/workbench/workbench-session", () => ({
  resolveWorkbenchSession: vi.fn(),
}));

vi.mock("../../../../lib/workbench/workbench-avatar", () => ({
  saveWorkbenchAvatarUpload: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

describe("POST /api/workbench/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated requests to the login page", async () => {
    vi.mocked(resolveWorkbenchSession).mockResolvedValue({
      loginEmail: null,
      selectedUserId: null,
      webSessionId: null,
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_dev",
      },
    });

    const formData = new FormData();
    formData.set(
      "avatar",
      new Blob(["avatar"], { type: "image/png" }),
      "avatar.png",
    );

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/avatar", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?redirectTo=%2Fsettings%2Faccount",
    );
  });

  it("stores the uploaded avatar and redirects back to account settings", async () => {
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
    vi.mocked(saveWorkbenchAvatarUpload).mockResolvedValue({
      avatarUrl: "/uploads/avatars/user_owner/avatar.png",
      avatarUpdatedAt: new Date("2026-05-22T08:00:00.000Z"),
    });

    const formData = new FormData();
    formData.set(
      "avatar",
      new Blob(["avatar"], { type: "image/png" }),
      "avatar.png",
    );

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/avatar", {
        method: "POST",
        body: formData,
        headers: {
          cookie: "ht_workbench_session=signed",
        },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/settings/account?avatar=updated",
    );
    expect(saveWorkbenchAvatarUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_owner",
        file: expect.objectContaining({
          name: "avatar.png",
          type: "image/png",
        }),
      }),
    );
    expect(revalidateTag).toHaveBeenCalledWith(
      "workbench:account:user_owner",
      "max",
    );
  });

  it("redirects back with a stable error code when the upload is rejected", async () => {
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
    vi.mocked(saveWorkbenchAvatarUpload).mockRejectedValue(
      new Error("Unsupported avatar file type"),
    );

    const formData = new FormData();
    formData.set(
      "avatar",
      new Blob(["avatar"], { type: "application/pdf" }),
      "avatar.pdf",
    );

    const response = await POST(
      new Request("http://localhost:3000/api/workbench/avatar", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/settings/account?avatarError=unsupported-file-type",
    );
  });

  it("prefers forwarded host headers when building redirects behind ingress", async () => {
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
    vi.mocked(saveWorkbenchAvatarUpload).mockResolvedValue({
      avatarUrl: "/uploads/avatars/user_owner/avatar.png",
      avatarUpdatedAt: new Date("2026-05-22T08:00:00.000Z"),
    });

    const formData = new FormData();
    formData.set(
      "avatar",
      new Blob(["avatar"], { type: "image/png" }),
      "avatar.png",
    );

    const response = await POST(
      new Request("http://0.0.0.0:3000/api/workbench/avatar", {
        method: "POST",
        body: formData,
        headers: {
          cookie: "ht_workbench_session=signed",
          "x-forwarded-host": "app.example.com",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/settings/account?avatar=updated",
    );
  });
});
