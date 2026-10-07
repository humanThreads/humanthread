import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDesktopAccessToken, verifyDesktopAccessToken } from "./desktop-token";

const secret = "desktop-session-secret-for-tests";
const now = new Date("2026-07-27T08:00:00.000Z");

function createTokenWithPayload(payload: Record<string, unknown>): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `v1.${encodedPayload}.${signature}`;
}

describe("desktop access tokens", () => {
  it("issues a 15-minute token scoped to a human desktop session", () => {
    const created = createDesktopAccessToken({
      userId: "user_1",
      sessionId: "desktop_session_1",
      now,
      secret,
    });

    expect(created.expiresAt).toEqual(new Date("2026-07-27T08:15:00.000Z"));
    expect(
      verifyDesktopAccessToken({
        token: created.accessToken,
        now: new Date("2026-07-27T08:14:59.000Z"),
        secret,
      }),
    ).toEqual({
      userId: "user_1",
      sessionId: "desktop_session_1",
      issuedAt: now,
      expiresAt: new Date("2026-07-27T08:15:00.000Z"),
    });
  });

  it("rejects expired tokens", () => {
    const created = createDesktopAccessToken({
      userId: "user_1",
      sessionId: "desktop_session_1",
      now,
      secret,
    });

    expect(() =>
      verifyDesktopAccessToken({
        token: created.accessToken,
        now: new Date("2026-07-27T08:16:00.000Z"),
        secret,
      }),
    ).toThrow("Desktop access token has expired");
  });

  it("rejects a validly signed token for another audience", () => {
    const token = createTokenWithPayload({
      sub: "user_1",
      sid: "desktop_session_1",
      aud: "humanthread-agent",
      iat: 1785139200,
      exp: 1785140100,
    });

    expect(() => verifyDesktopAccessToken({ token, now, secret })).toThrow(
      "Desktop access token audience is invalid",
    );
  });

  it("does not accept an Agent device credential as a human access token", () => {
    expect(() =>
      verifyDesktopAccessToken({ token: "ht_device_abc123", now, secret }),
    ).toThrow("Desktop access token is invalid");
  });
});
