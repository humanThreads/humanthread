import { NextResponse } from "next/server";
import { getStorageSettings, updateStorageSettings } from "@/lib/storage/storage-settings";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

export async function GET(request: Request) {
  try { await resolveWorkbenchApiActor(request); return NextResponse.json({ ok: true, config: await getStorageSettings() }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "读取存储配置失败" }, { status: 401 }); }
}

export async function PUT(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = await request.json() as { config?: unknown };
    return NextResponse.json({ ok: true, config: await updateStorageSettings({ userId: actor.userId, config: body.config }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存存储配置失败";
    return NextResponse.json({ ok: false, error: message }, { status: message.includes("administrator") ? 403 : 400 });
  }
}
