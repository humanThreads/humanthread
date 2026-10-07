import {
  clearWebAuthenticationCookies,
  setWebSessionCookie,
  type WebCookieWriter,
} from "./web-session-cookie";
import { createWebSession } from "./web-session-store";
import { authenticateWorkbenchUser } from "./workbench-auth";

export type CookieWriter = WebCookieWriter;

export interface CreateWorkbenchLoginSessionInput {
  email: string;
  password: string;
  request: Request;
  cookieStore: CookieWriter;
  authenticateUser?: typeof authenticateWorkbenchUser;
  createSession?: typeof createWebSession;
}

export interface CreateWorkbenchLoginSessionResult {
  email: string;
  webSessionId: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePassword(value: string): string {
  return value.trim();
}

export async function createWorkbenchLoginSession(
  input: CreateWorkbenchLoginSessionInput,
): Promise<CreateWorkbenchLoginSessionResult> {
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);

  if (!email) {
    throw new Error("Email is required");
  }

  if (!password) {
    throw new Error("Password is required");
  }

  const authenticateUser = input.authenticateUser ?? authenticateWorkbenchUser;
  const user = await authenticateUser({
    email,
    password,
  });
  const webSession = await (input.createSession ?? createWebSession)({
    userId: user.id,
    request: input.request,
  });

  clearWebAuthenticationCookies(input.cookieStore);
  setWebSessionCookie({
    cookieStore: input.cookieStore,
    token: webSession.token,
    request: input.request,
  });

  return {
    email: user.email,
    webSessionId: webSession.session.id,
  };
}
