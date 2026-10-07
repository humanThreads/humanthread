import {
  getWorkbenchContext,
  type WorkbenchContext,
} from "./workbench-context";
import { WEB_SESSION_COOKIE } from "./web-session-cookie";
import { resolveActiveWebSession } from "./web-session-store";

export interface WorkbenchSessionAccount {
  id: string;
  name: string;
  email: string | null;
  status: string;
  lastSeenAt: Date | null;
  avatarUrl: string | null;
  avatarUpdatedAt: Date | null;
  isSiteAdmin: boolean;
}

export interface WorkbenchSession {
  loginEmail: string | null;
  selectedUserId: string | null;
  webSessionId: string | null;
  context: WorkbenchContext;
  account?: WorkbenchSessionAccount;
}

interface ResolveWorkbenchSessionInput {
  getCookieValue?: (name: string) => string | undefined;
  getWorkbenchContext?: typeof getWorkbenchContext;
  companyId?: string;
  ownerType?: "company" | "personal";
  resolveActiveWebSession?: typeof resolveActiveWebSession;
}

export function hasWorkbenchAuthenticationCookie(
  getCookieValue: (name: string) => string | undefined,
): boolean {
  return Boolean(
    getCookieValue(WEB_SESSION_COOKIE)?.trim(),
  );
}

export async function resolveWorkbenchSession(
  input: ResolveWorkbenchSessionInput = {},
): Promise<WorkbenchSession> {
  const contextResolver = input.getWorkbenchContext ?? getWorkbenchContext;
  const scope = {
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.ownerType ? { ownerType: input.ownerType } : {}),
  };
  const sessionCookie = input.getCookieValue?.(WEB_SESSION_COOKIE)?.trim();

  if (sessionCookie) {
    const actor = await (input.resolveActiveWebSession ?? resolveActiveWebSession)({
      token: sessionCookie,
    });

    if (actor) {
      return {
        loginEmail: actor.email,
        selectedUserId: null,
        webSessionId: actor.webSessionId,
        context: await contextResolver({
          selectedUserId: actor.userId,
          ...scope,
        }),
      };
    }
  }

  return {
    loginEmail: null,
    selectedUserId: null,
    webSessionId: null,
    context:
      input.companyId || input.ownerType
        ? await contextResolver(scope)
        : await contextResolver(),
  };
}
