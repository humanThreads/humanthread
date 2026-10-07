import { NextResponse } from "next/server";
import { assertCanManageDocumentPermission, grantDocumentPermission, listDocumentPermissions } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const userId = (await resolveWorkbenchApiActor(request)).userId;
    const spaceId = new URL(request.url).searchParams.get("spaceId");
    if (!spaceId) return NextResponse.json({ ok: false, error: "缺少空间" }, { status: 400 });
    await assertCanManageDocumentPermission({ userId, spaceId });
    return NextResponse.json({ ok: true, permissions: await listDocumentPermissions({ spaceId, documentId }) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "授权读取失败" }, { status: 403 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const actor = await resolveWorkbenchApiActor(request);
    const body = await request.json() as { spaceId?: string; userId?: string; permission?: "read" | "edit" | "manage" };
    if (!body.spaceId || !body.userId || !body.permission) return NextResponse.json({ ok: false, error: "授权参数不完整" }, { status: 400 });
    await assertCanManageDocumentPermission({ userId: actor.userId, spaceId: body.spaceId });
    return NextResponse.json({ ok: true, permission: await grantDocumentPermission({ spaceId: body.spaceId, documentId, userId: body.userId, permission: body.permission, createdById: actor.userId }) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "授权失败" }, { status: 403 });
  }
}
