import { beforeEach, describe, expect, it, vi } from "vitest";

import { markDesktopNotificationRead } from "@/lib/desktop/desktop-notification-models";
import { OPTIONS, POST } from "./route";

vi.mock("@/lib/desktop/desktop-notification-models", () => ({
  markDesktopNotificationRead: vi.fn(),
}));

const params = { params: Promise.resolve({ notificationId: "event:event_1" }) };

function request(body: unknown) {
  return new Request(
    "http://localhost:3000/api/desktop/notifications/event%3Aevent_1/read?space=personal",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:1420",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("desktop notification read route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a strict read result with desktop CORS", async () => {
    vi.mocked(markDesktopNotificationRead).mockResolvedValue({
      notificationId: "event:event_1",
      isUnread: false,
    });
    const input = { commandId: "desktop:notification:read:1" };
    const postRequest = request(input);

    const response = await POST(postRequest, params);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin"))
      .toBe("http://localhost:1420");
    expect(await response.json()).toEqual({
      ok: true,
      result: { notificationId: "event:event_1", isUnread: false },
    });
    expect(markDesktopNotificationRead).toHaveBeenCalledWith(
      postRequest,
      "event:event_1",
      input,
    );

    const preflight = await OPTIONS(request(input));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods"))
      .toBe("POST, OPTIONS");
  });

  it("rejects a blank command ID before calling the service", async () => {
    const response = await POST(request({ commandId: "  " }), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_failed" });
    expect(markDesktopNotificationRead).not.toHaveBeenCalled();
  });

  it.each([
    ["Workbench API authentication required", 401, "authentication_required"],
    ["Space access denied", 403, "authorization_denied"],
    ["Notification not found", 404, "notification_not_found"],
  ] as const)("maps %s to a bounded API error", async (message, status, code) => {
    vi.mocked(markDesktopNotificationRead).mockRejectedValue(new Error(message));

    const response = await POST(
      request({ commandId: "desktop:notification:read:error" }),
      params,
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code, error: message });
  });

  it("hides unexpected service errors", async () => {
    vi.mocked(markDesktopNotificationRead).mockRejectedValue(
      new Error("database host and credentials"),
    );

    const response = await POST(
      request({ commandId: "desktop:notification:read:failure" }),
      params,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      code: "internal_error",
      error: "Desktop notification request failed",
    });
  });
});
