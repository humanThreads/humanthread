import { markLoopNotificationIntentRead } from "@humanthread/db";

import { resolveWorkbenchSession } from "../../../lib/workbench/workbench-session";
import { markWorkbenchNotificationRead } from "../../../lib/workbench/workbench-notification-state";
import { listAccessibleLoopNotificationIntents } from "../../../lib/workbench/workbench-notifications";
import {
  buildWorkbenchLoginHref,
  normalizeWorkbenchRedirectPath,
} from "../../../lib/workbench/workbench-auth-guard";

function getCookieValueFromHeader(
  cookieHeader: string | null,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;

  for (const segment of cookieHeader.split(";")) {
    const trimmedSegment = segment.trim();

    if (trimmedSegment.startsWith(prefix)) {
      return decodeURIComponent(trimmedSegment.slice(prefix.length));
    }
  }

  return undefined;
}

function redirectResponse(location: string, status = 307) {
  return new Response(null, {
    status,
    headers: {
      location,
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const notificationId = url.searchParams.get("notificationId")?.trim() ?? "";
  const redirectTo = normalizeWorkbenchRedirectPath(
    url.searchParams.get("redirectTo"),
  );
  const requestedPath = `/notifications/open?${url.searchParams.toString()}`;
  const session = await resolveWorkbenchSession({
    getCookieValue: (name) =>
      getCookieValueFromHeader(request.headers.get("cookie"), name),
  });

  if (!session.loginEmail) {
    return redirectResponse(buildWorkbenchLoginHref(requestedPath));
  }

  if (notificationId) {
    if (notificationId.startsWith("loop-notification:")) {
      const authorized = await listAccessibleLoopNotificationIntents({
        userId: session.context.userId,
      });
      if (authorized.some((notification) => notification.id === notificationId)) {
        await markLoopNotificationIntentRead({
          recipientUserId: session.context.userId,
          notificationId,
        });
      }
    } else {
      await markWorkbenchNotificationRead({
        userId: session.context.userId,
        notificationId,
      });
    }
  }

  return redirectResponse(redirectTo === "/" ? "/notifications" : redirectTo);
}
