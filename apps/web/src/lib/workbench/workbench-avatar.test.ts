import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWorkbenchAvatarSrc,
  resolveWorkbenchAvatarExtension,
  resolveWorkbenchAvatarPublicRoot,
} from "./workbench-avatar";

describe("workbench avatar helpers", () => {
  it("appends the avatar update timestamp for cache busting", () => {
    const avatarUpdatedAt = new Date("2026-05-22T08:00:00.000Z");

    expect(
      buildWorkbenchAvatarSrc(
        "/uploads/avatars/user_owner/avatar.png",
        avatarUpdatedAt,
      ),
    ).toBe(
      `/uploads/avatars/user_owner/avatar.png?v=${avatarUpdatedAt.getTime()}`,
    );
  });

  it("resolves the public root from the repository root", () => {
    expect(resolveWorkbenchAvatarPublicRoot("/repo")).toBe(
      join("/repo", "apps", "web", "public"),
    );
  });

  it("resolves the public root from the web app root", () => {
    expect(resolveWorkbenchAvatarPublicRoot(join("/repo", "apps", "web"))).toBe(
      join("/repo", "apps", "web", "public"),
    );
  });

  it("normalizes supported avatar extensions", () => {
    expect(
      resolveWorkbenchAvatarExtension({
        mimeType: "image/jpeg",
        fileName: "portrait.JPG",
      }),
    ).toBe("jpg");
    expect(
      resolveWorkbenchAvatarExtension({
        mimeType: "image/webp",
        fileName: "portrait.webp",
      }),
    ).toBe("webp");
  });

  it("rejects unsupported avatar file types", () => {
    expect(
      resolveWorkbenchAvatarExtension({
        mimeType: "application/pdf",
        fileName: "avatar.pdf",
      }),
    ).toBeNull();
  });
});
