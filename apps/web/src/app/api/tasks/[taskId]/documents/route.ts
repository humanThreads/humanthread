import { NextResponse } from "next/server";
import { linkTaskDocument, listLinkableDocuments, unlinkTaskDocument } from "@/lib/tasks/task-document-links";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "文档关联操作失败";
  const status = message.includes("authentication") ? 401 : /access|accessible|permission/iu.test(message) ? 403 : /not found/iu.test(message) ? 404 : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ ok: true, documents: await listLinkableDocuments({ userId: actor.userId, taskId, query }) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const body = await request.json() as { documentId?: unknown };
    if (typeof body.documentId !== "string" || !body.documentId.trim()) return NextResponse.json({ ok: false, error: "文档 ID 不能为空" }, { status: 400 });
    return NextResponse.json({ ok: true, link: await linkTaskDocument({ userId: actor.userId, taskId, documentId: body.documentId.trim() }) }, { status: 201 });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const { taskId } = await context.params;
    const documentId = new URL(request.url).searchParams.get("documentId") ?? "";
    if (!documentId) return NextResponse.json({ ok: false, error: "文档 ID 不能为空" }, { status: 400 });
    return NextResponse.json({ ok: true, result: await unlinkTaskDocument({ userId: actor.userId, taskId, documentId }) });
  } catch (error) { return failure(error); }
}
