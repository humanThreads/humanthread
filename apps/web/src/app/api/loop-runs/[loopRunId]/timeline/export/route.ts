import { exportWorkflowTimeline } from "@/lib/orchestration/workflow-timeline-export";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  apiValidationError,
  decodeWorkflowInteractionRouteId,
  workflowInteractionApiErrorResponse,
} from "../../../../../../lib/orchestration/workflow-interaction-http";

export async function GET(
  request: Request,
  context: { params: Promise<{ loopRunId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const loopRunId = decodeWorkflowInteractionRouteId((await context.params).loopRunId, 96);
    const search = new URL(request.url).searchParams;
    const format = search.get("format") ?? "json";
    if (format !== "json" && format !== "markdown") throw apiValidationError("Export format is invalid");
    const kinds = values(search, "kinds");
    const nodeKeys = values(search, "nodeKeys");
    const actorIds = values(search, "actorIds");
    const statuses = values(search, "statuses");
    const result = await exportWorkflowTimeline({
      userId: actor.userId,
      loopRunId,
      format,
      filters: {
        ...(search.get("query") ? { query: search.get("query")! } : {}),
        ...(kinds === undefined ? {} : { kinds }),
        ...(nodeKeys === undefined ? {} : { nodeKeys }),
        ...(actorIds === undefined ? {} : { actorIds }),
        ...(statuses === undefined ? {} : { statuses }),
        ...(search.get("from") ? { from: search.get("from")! } : {}),
        ...(search.get("to") ? { to: search.get("to")! } : {}),
      },
    });
    return new Response(result.body, {
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const mapped = workflowInteractionApiErrorResponse(error);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const status = code === "export_too_large" ? 413 : mapped.status;
    return Response.json({ ...mapped.body, ...(code === "export_too_large" ? { code } : {}) }, { status });
  }
}

function values(search: URLSearchParams, key: string) {
  const result = search.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  return result.length > 0 ? [...new Set(result)] : undefined;
}
