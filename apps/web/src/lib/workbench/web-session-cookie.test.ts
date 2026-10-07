import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_WEB_AUTH_COOKIES,
  WEB_SESSION_COOKIE,
  clearWebAuthenticationCookies,
  setWebSessionCookie,
} from "./web-session-cookie";

describe("web session cookies", () => {
  it("sets one secure production Web session cookie", () => {
    const cookieStore = { set: vi.fn() };
    setWebSessionCookie({
      cookieStore,
      token: "opaque",
      request: new Request("https://localhost:3000/login"),
    });
    expect(cookieStore.set).toHaveBeenCalledWith(WEB_SESSION_COOKIE, "opaque", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      secure: true,
    });
  });

  it("clears the current and every legacy authentication cookie", () => {
    const cookieStore = { set: vi.fn() };
    clearWebAuthenticationCookies(cookieStore);
    for (const name of [WEB_SESSION_COOKIE, ...LEGACY_WEB_AUTH_COOKIES]) {
      expect(cookieStore.set).toHaveBeenCalledWith(name, "", expect.objectContaining({
        maxAge: 0,
        httpOnly: true,
        path: "/",
      }));
    }
  });
});
