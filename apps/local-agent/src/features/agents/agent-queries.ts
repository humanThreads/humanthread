import {
  workbenchQueryKey,
  type WorkbenchContextIdentity,
} from "@humanthread/workbench-client";

export type AgentView = "overview" | "runs" | "loops" | "approvals" | "workers" | "terminals";
export type AgentLoopPanel = "runtime" | "logs" | "interaction" | "terminal";

export interface AgentQuery {
  view: AgentView;
  runId?: string;
  loopId?: string;
  loopPanel?: AgentLoopPanel;
  profileId?: string;
  sessionId?: string;
}

const VIEWS = new Set<AgentView>(["overview", "runs", "loops", "approvals", "workers", "terminals"]);
const LOOP_PANELS = new Set<AgentLoopPanel>(["runtime", "logs", "interaction", "terminal"]);

export function parseAgentQuery(search: URLSearchParams): AgentQuery {
  const requestedView = search.get("view")?.trim() as AgentView | undefined;
  const runId = search.get("run")?.trim();
  const loopId = search.get("loop")?.trim();
  const requestedLoopPanel = search.get("panel")?.trim() as AgentLoopPanel | undefined;
  const profileId = search.get("profile")?.trim();
  const sessionId = search.get("session")?.trim();
  const resourceView: AgentView = runId
    ? "runs"
    : loopId
      ? "loops"
      : profileId
        ? "workers"
        : "overview";
  return {
    view: requestedView && VIEWS.has(requestedView) ? requestedView : resourceView,
    ...(runId ? { runId } : {}),
    ...(loopId ? { loopId } : {}),
    ...(loopId && requestedLoopPanel && LOOP_PANELS.has(requestedLoopPanel)
      ? { loopPanel: requestedLoopPanel }
      : {}),
    ...(profileId ? { profileId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function buildAgentSearch(query: AgentQuery): URLSearchParams {
  const search = new URLSearchParams({ view: query.view });
  if (query.runId) search.set("run", query.runId);
  if (query.loopId) search.set("loop", query.loopId);
  if (query.loopId && query.loopPanel) search.set("panel", query.loopPanel);
  if (query.profileId) search.set("profile", query.profileId);
  if (query.sessionId) search.set("session", query.sessionId);
  return search;
}

export function agentQueryKey(context: WorkbenchContextIdentity) {
  return workbenchQueryKey(context, "agents");
}

export function agentLoopDetailQueryKey(context: WorkbenchContextIdentity, loopRunId: string) {
  return workbenchQueryKey(context, "agent-loop-detail", { loopRunId });
}

export function createAgentCommandMetadata(resource: "approval" | "loop") {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { commandId: `desktop:agent:${resource}:${id}` };
}
