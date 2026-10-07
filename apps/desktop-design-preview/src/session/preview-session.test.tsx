import { desktopBootstrapResponseSchema } from "@humanthread/workbench-client";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewSessionProvider, usePreviewSession } from "./preview-session";

function SessionProbe() {
  const session = usePreviewSession();
  return <span>{session.status}</span>;
}

describe("PreviewSessionProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts signed out without restoring credentials from browser storage", async () => {
    localStorage.setItem("humanthread.desktop-preview.identity.v1", JSON.stringify({
      installationId: "desktop-design-preview-test",
      deviceId: "preview-test",
      deviceName: "Design Preview",
      platform: "macos",
    }));

    render(
      <PreviewSessionProvider storage={localStorage}>
        <SessionProbe />
      </PreviewSessionProvider>,
    );

    expect(await screen.findByText("signed_out")).toBeInTheDocument();
    expect(Object.keys(localStorage)).not.toContain("humanthread.desktop-preview.access-token");
    expect(desktopBootstrapResponseSchema).toBeDefined();
  });

  it("keeps login credentials out of storage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      data: {
        accessToken: "access",
        accessExpiresAt: "2099-01-01T00:00:00.000Z",
        refreshToken: "refresh",
        sessionId: "session",
        user: {
          id: "user-1",
          email: "person@example.com",
          name: "测试用户",
          avatarUrl: null,
        },
        device: {
          id: "preview-device",
          status: "authorized",
          deviceToken: "device-token",
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    render(
      <PreviewSessionProvider fetch={fetchMock} storage={localStorage}>
        <SessionProbe />
      </PreviewSessionProvider>,
    );

    expect(JSON.stringify(localStorage)).not.toMatch(/person@example.com|access|refresh|device-token/u);
  });
});
