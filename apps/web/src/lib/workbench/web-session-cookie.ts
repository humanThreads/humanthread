export const WEB_SESSION_COOKIE = "ht_web_session";
export const LEGACY_WEB_AUTH_COOKIES = [
  "ht_workbench_session",
  "ht_workbench_login_email",
  "ht_workbench_user_id",
] as const;

export interface WebCookieWriter {
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      sameSite: "lax";
      path: string;
      maxAge: number;
      secure?: boolean;
    },
  ): void;
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function setWebSessionCookie(input: {
  cookieStore: WebCookieWriter;
  token: string;
  request: Request;
}): void {
  input.cookieStore.set(WEB_SESSION_COOKIE, input.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    secure: new URL(input.request.url).protocol === "https:",
  });
}

export function clearWebAuthenticationCookies(cookieStore: WebCookieWriter): void {
  for (const name of [WEB_SESSION_COOKIE, ...LEGACY_WEB_AUTH_COOKIES]) {
    cookieStore.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}
