import { NextResponse } from "next/server";
import { assertCanManageDocumentPermission, revokeDocumentPermission } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export async function DELETE(request: Request, context: { params: Promise<{ documentId: string; permissionId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const spaceId = new URL(request.url).searchParams.get("spaceId");
    if (!spaceId) return NextResponse.json({ ok: false, error: "缺少空间" }, { status: 400 });
    await assertCanManageDocumentPermission({ userId: actor.userId, spaceId });
    const { permissionId } = await context.params;
    return NextResponse.json({ ok: true, permission: await revokeDocumentPermission({ permissionId }) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "撤销授权失败" }, { status: 403 });
  }
}
