import { NextResponse } from "next/server";
import { resolveWorkbenchSession } from "../../../../lib/workbench/workbench-session";
import { getWorkbenchNotificationSummary } from "../../../../lib/workbench/workbench-notification-summary";
import {
  WORKBENCH_SPACE_COOKIE,
  getWorkbenchSelectedSpaceFilter,
} from "../../../../lib/workbench/workbench-space-filters";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";

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

export async function GET(request: Request) {
  const session = await resolveWorkbenchSession({
    getCookieValue: (name) =>
      getCookieValueFromHeader(request.headers.get("cookie"), name),
  });

  if (!session.loginEmail) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const companyFilters = await getWorkbenchCompanyFilters({
    userId: session.context.userId,
  });
  const selectedFilter = getWorkbenchSelectedSpaceFilter({
    filters: companyFilters,
    cookieValue: getCookieValueFromHeader(
      request.headers.get("cookie"),
      WORKBENCH_SPACE_COOKIE,
    ),
  });
  const summary = await getWorkbenchNotificationSummary({
    teamId: session.context.teamId,
    userId: session.context.userId,
    ...(selectedFilter.companyId ? { companyId: selectedFilter.companyId } : {}),
    ...(selectedFilter.ownerType ? { ownerType: selectedFilter.ownerType } : {}),
  });

  return NextResponse.json({
    ok: true,
    summary,
  });
}
