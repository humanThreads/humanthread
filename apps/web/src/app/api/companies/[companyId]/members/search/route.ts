import { NextResponse } from "next/server";
import { prisma } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export async function GET(request: Request, context: { params: Promise<{ companyId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { companyId } = await context.params;
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 1) return NextResponse.json({ ok: true, members: [] });
    const membership = await prisma.companyMember.findFirst({ where: { companyId, userId: actor.userId, status: "active" }, select: { id: true } });
    if (!membership) return NextResponse.json({ ok: false, error: "公司访问被拒绝" }, { status: 403 });
    const members = await prisma.companyMember.findMany({ where: { companyId, status: "active", user: { OR: [{ name: { contains: query } }, { email: { contains: query } }, { id: { contains: query } }] } }, select: { user: { select: { id: true, name: true, email: true } } }, take: 20, orderBy: { user: { name: "asc" } } });
    return NextResponse.json({ ok: true, members: members.map(({ user }) => user) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "成员搜索失败" }, { status: 401 });
  }
}
