import { NextResponse } from "next/server";
import { getTeamOverview } from "@/lib/overviews/task-overviews";
import { resolveWorkbenchSession } from "@/lib/workbench/workbench-session";

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
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId")?.trim() || undefined;
  const ownerType =
    searchParams.get("ownerType") === "company" ||
    searchParams.get("ownerType") === "personal"
      ? (searchParams.get("ownerType") as "company" | "personal")
      : undefined;
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

  const result = await getTeamOverview({
    teamId: session.context.teamId,
    userId: session.context.userId,
    ...(companyId ? { companyId } : {}),
    ...(ownerType ? { ownerType } : {}),
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
