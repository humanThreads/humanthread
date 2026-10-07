import { NextResponse } from "next/server";
import { readProjectLoopCatalogV2 } from "../../../../../../lib/orchestration/project-loop-catalog";
import { resolveDesktopApiActor } from "../../../../../../lib/workbench/workbench-api-session";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  const { projectId } = await context.params;
  try {
    const authorization = request.headers.get("authorization")?.trim();
    const accessToken = authorization?.match(/^Bearer\s+(.+)$/u)?.[1]?.trim();
    if (!accessToken) throw new Error("Workbench API authentication required");
    const actor = await resolveDesktopApiActor(accessToken);
    const catalog = await readProjectLoopCatalogV2({ userId: actor.userId, projectId });
    if (!catalog) return NextResponse.json({ ok: false, code: "not_found", error: "Project not found" }, { status: 404 });
    return NextResponse.json({ ok: true, result: catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Loop catalog request failed";
    const status = /project not found/iu.test(message)
      ? 404
      : /authentication required|Desktop session/iu.test(message)
        ? 401
        : /access denied/iu.test(message)
          ? 403
          : 500;
    return NextResponse.json({
      ok: false,
      code: status === 404
        ? "not_found"
        : status === 401
          ? "authentication_required"
          : status === 403
            ? "authorization_denied"
            : "internal_error",
      error: status === 500 ? "Loop catalog request failed" : message,
    }, { status });
  }
}
