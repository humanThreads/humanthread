import { NextResponse } from "next/server";
import { getCurrentTaskForUser } from "@/lib/overviews/task-overviews";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId") ?? "team_1";
  const userId = searchParams.get("userId") ?? "user_owner";
  const companyId = searchParams.get("companyId")?.trim() || undefined;
  const ownerType =
    searchParams.get("ownerType") === "company" ||
    searchParams.get("ownerType") === "personal"
      ? (searchParams.get("ownerType") as "company" | "personal")
      : undefined;

  const result = await getCurrentTaskForUser({
    teamId,
    userId,
    ...(companyId ? { companyId } : {}),
    ...(ownerType ? { ownerType } : {}),
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
