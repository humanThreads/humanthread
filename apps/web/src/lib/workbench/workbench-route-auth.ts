import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildWorkbenchLoginHref,
  isWorkbenchSessionAuthenticated,
} from "./workbench-auth-guard";
import { getWorkbenchAccountSettings } from "./workbench-settings";
import {
  hasWorkbenchAuthenticationCookie,
  resolveWorkbenchSession,
} from "./workbench-session";

export async function requireWorkbenchSession(requestedPath: string) {
  const cookieStore = await cookies();
  const getCookieValue = (name: string) => cookieStore.get(name)?.value;

  if (!hasWorkbenchAuthenticationCookie(getCookieValue)) {
    redirect(buildWorkbenchLoginHref(requestedPath));
  }

  const session = await resolveWorkbenchSession({ getCookieValue });

  if (!isWorkbenchSessionAuthenticated(session)) {
    redirect(buildWorkbenchLoginHref(requestedPath));
  }

  const account = await getWorkbenchAccountSettings({
    userId: session.context.userId,
  });

  return {
    session: {
      ...session,
      account,
    },
    cookieStore,
  };
}
