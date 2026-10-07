import { NextResponse } from "next/server";

import { readWorkflowTimeline } from "@/lib/orchestration/workflow-timeline-query";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  apiValidationError,
  decodeWorkflowInteractionRouteId,
  workflowInteractionApiErrorResponse,
} from "../../../../../lib/orchestration/workflow-interaction-http";

export async function GET(
  request: Request,
  context: { params: Promise<{ loopRunId: string }> },
) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const loopRunId = decodeWorkflowInteractionRouteId((await context.params).loopRunId, 96);
    const search = new URL(request.url).searchParams;
    const kinds = values(search, "kinds");
    const nodeKeys = values(search, "nodeKeys");
    const actorIds = values(search, "actorIds");
    const statuses = values(search, "statuses");
    const result = await readWorkflowTimeline({
      userId: actor.userId,
      loopRunId,
      ...(search.get("query") ? { query: search.get("query")! } : {}),
      ...(kinds === undefined ? {} : { kinds }),
      ...(nodeKeys === undefined ? {} : { nodeKeys }),
      ...(actorIds === undefined ? {} : { actorIds }),
      ...(statuses === undefined ? {} : { statuses }),
      ...(search.get("from") ? { from: search.get("from")! } : {}),
      ...(search.get("to") ? { to: search.get("to")! } : {}),
      ...(search.get("cursor") ? { cursor: search.get("cursor")! } : {}),
      ...(search.get("limit") ? { limit: parseLimit(search.get("limit")!) } : {}),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = workflowInteractionApiErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

function values(search: URLSearchParams, key: string) {
  const result = search.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  return result.length > 0 ? [...new Set(result)] : undefined;
}

function parseLimit(value: string) {
  const limit = Number(value);
  if (!Number.isInteger(limit)) throw apiValidationError("Timeline limit is invalid");
  return limit;
}
