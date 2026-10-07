import {
  workbenchQueryKey,
  type WorkbenchContextIdentity,
} from "@humanthread/workbench-client";

export type ProjectHealthFilter = "all" | "healthy" | "at_risk" | "blocked" | "complete" | "unknown";

export interface ProjectCollectionQuery {
  search: string;
  status: string;
  health: ProjectHealthFilter;
}

const HEALTH_FILTERS = new Set<ProjectHealthFilter>([
  "all", "healthy", "at_risk", "blocked", "complete", "unknown",
]);

export function parseProjectCollectionQuery(search: URLSearchParams): ProjectCollectionQuery {
  const requestedHealth = search.get("health")?.trim() as ProjectHealthFilter | undefined;
  return {
    search: search.get("search")?.trim() ?? "",
    status: search.get("status")?.trim() ?? "",
    health: requestedHealth && HEALTH_FILTERS.has(requestedHealth)
      ? requestedHealth
      : "all",
  };
}

export function buildProjectCollectionSearch(
  query: ProjectCollectionQuery,
  spaceKey: string,
): URLSearchParams {
  const search = new URLSearchParams({ space: spaceKey });
  if (query.search) search.set("search", query.search);
  if (query.status) search.set("status", query.status);
  if (query.health !== "all") search.set("health", query.health);
  return search;
}

export function projectCollectionQueryKey(
  context: WorkbenchContextIdentity,
  query: ProjectCollectionQuery,
) {
  return workbenchQueryKey(context, "projects", { ...query });
}

export function projectDetailQueryKey(
  context: WorkbenchContextIdentity,
  projectId: string,
) {
  return [...workbenchQueryKey(context, "projects"), "detail", projectId];
}
