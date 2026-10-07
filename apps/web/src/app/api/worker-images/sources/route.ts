import { NextResponse } from "next/server";
import { listAvailableWorkerImages } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { resolveWorkerProjectScope } from "@/lib/orchestration/worker-resource-scope";

export async function GET(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    if (!projectId) return NextResponse.json({ ok: false, code: "validation_failed", error: "项目标识不能为空" }, { status: 400 });
    const scope = await resolveWorkerProjectScope({ userId: actor.userId, projectId });
    return NextResponse.json({ ok: true, sources: await listAvailableWorkerImages({ companyId: scope.companyId }) });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "request_failed";
    if (error instanceof Error && error.message === "Workbench API authentication required") {
      return NextResponse.json({ ok: false, code: "authentication_required", error: error.message }, { status: 401 });
    }
    if (code === "authorization_denied") {
      return NextResponse.json({ ok: false, code, error: "无权读取项目可用的 Worker 镜像" }, { status: 403 });
    }
    if (code === "validation_failed") {
      return NextResponse.json({ ok: false, code, error: error instanceof Error ? error.message : "Worker 镜像请求无效" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, code, error: "无法读取可用 Worker 镜像" }, { status: 500 });
  }
}
