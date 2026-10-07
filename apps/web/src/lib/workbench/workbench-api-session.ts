import {
  hasWorkbenchAuthenticationCookie,
  resolveWorkbenchSession,
} from "./workbench-session";
import { prisma } from "../../../../../packages/db/src/index";
import { verifyDesktopAccessToken } from "../desktop/desktop-token";

export type WorkbenchApiActor =
  | { userId: string; authKind: "web_session"; webSessionId: string }
  | { userId: string; authKind: "desktop_token"; sessionId: string };

interface DesktopApiSessionRecord {
  id: string;
  userId: string;
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: { status: string };
}

interface ResolveDesktopApiActorDependencies {
  now: () => Date;
  verifyAccessToken: typeof verifyDesktopAccessToken;
  loadSession: (sessionId: string) => Promise<DesktopApiSessionRecord | null>;
}

export async function resolveDesktopApiActor(
  accessToken: string,
  dependencies: ResolveDesktopApiActorDependencies = {
    now: () => new Date(),
    verifyAccessToken: verifyDesktopAccessToken,
    loadSession: (sessionId) =>
      prisma.desktopSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          userId: true,
          status: true,
          expiresAt: true,
          revokedAt: true,
          user: { select: { status: true } },
        },
      }),
  },
): Promise<{
  userId: string;
  sessionId: string;
}> {
  const now = dependencies.now();
  const token = dependencies.verifyAccessToken({ token: accessToken, now });
  const session = await dependencies.loadSession(token.sessionId);
  if (
    !session ||
    session.userId !== token.userId ||
    session.status !== "active" ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.user.status !== "active"
  ) {
    throw new Error("Desktop session is unavailable");
  }
  return { userId: session.userId, sessionId: session.id };
}

function getCookieValueFromHeader(
  cookieHeader: string | null,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;

  for (const segment of cookieHeader.split(";")) {
    const value = segment.trim();

    if (value.startsWith(prefix)) {
      return decodeURIComponent(value.slice(prefix.length));
    }
  }

  return undefined;
}

export async function resolveWorkbenchApiActor(
  request: Request,
  dependencies: {
    resolveWorkbenchSession: typeof resolveWorkbenchSession;
    resolveDesktopActor?: typeof resolveDesktopApiActor;
  } = { resolveWorkbenchSession },
): Promise<WorkbenchApiActor> {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/u);
    const accessToken = match?.[1]?.trim();
    if (!accessToken?.startsWith("v1.")) {
      throw new Error("Workbench API authentication required");
    }
    try {
      const actor = await (dependencies.resolveDesktopActor ?? resolveDesktopApiActor)(accessToken);
      return { ...actor, authKind: "desktop_token" };
    } catch {
      throw new Error("Workbench API authentication required");
    }
  }

  const getCookieValue = (name: string) =>
    getCookieValueFromHeader(request.headers.get("cookie"), name);
  if (!hasWorkbenchAuthenticationCookie(getCookieValue)) {
    throw new Error("Workbench API authentication required");
  }
  const session = await dependencies.resolveWorkbenchSession({
    getCookieValue,
  });

  if (!session.loginEmail || !session.webSessionId) {
    throw new Error("Workbench API authentication required");
  }

  return {
    userId: session.context.userId,
    webSessionId: session.webSessionId,
    authKind: "web_session",
  };
}
