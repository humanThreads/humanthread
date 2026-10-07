import {
  workbenchQueryKey,
  type WorkbenchContextIdentity,
} from "@humanthread/workbench-client";

export type TaskCollectionView = "list" | "board" | "calendar";
export type TaskRelation =
  | "all"
  | "assigned"
  | "created"
  | "participating"
  | "following"
  | "overdue"
  | "blocked"
  | "completed";
export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "completed"
  | "cancelled";
export type TaskGroup = "status" | "assignee" | "priority" | "project";
export type TaskSort = "updated_desc" | "due_asc" | "priority_desc" | "created_desc";

export interface TaskCollectionQuery {
  view: TaskCollectionView;
  relation: TaskRelation;
  search: string;
  status: TaskStatus[];
  group: TaskGroup;
  sort: TaskSort;
  page: number;
  pageSize: number;
  project?: string[];
  taskId?: string;
}

const VIEWS = new Set<TaskCollectionView>(["list", "board", "calendar"]);
const RELATIONS = new Set<TaskRelation>([
  "all", "assigned", "created", "participating", "following", "overdue", "blocked", "completed",
]);
const STATUSES = new Set<TaskStatus>([
  "backlog", "todo", "in_progress", "in_review", "completed", "cancelled",
]);
const GROUPS = new Set<TaskGroup>(["status", "assignee", "priority", "project"]);
const SORTS = new Set<TaskSort>(["updated_desc", "due_asc", "priority_desc", "created_desc"]);

function enumValue<T extends string>(value: string | null, values: Set<T>, fallback: T): T {
  return values.has(value as T) ? value as T : fallback;
}

export function parseTaskCollectionQuery(search: URLSearchParams): TaskCollectionQuery {
  return {
    view: enumValue(search.get("view"), VIEWS, "list"),
    relation: enumValue(search.get("relation"), RELATIONS, "all"),
    search: search.get("search")?.trim() ?? "",
    status: [...new Set(
      (search.get("status") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is TaskStatus => STATUSES.has(value as TaskStatus)),
    )],
    group: enumValue(search.get("group"), GROUPS, "status"),
    sort: enumValue(search.get("sort"), SORTS, "updated_desc"),
    page: Math.max(Number.parseInt(search.get("page") ?? "1", 10) || 1, 1),
    pageSize: Math.min(
      Math.max(Number.parseInt(search.get("pageSize") ?? "20", 10) || 20, 1),
      100,
    ),
    project: [...new Set((search.get("project") ?? "").split(",").map((value) => value.trim()).filter(Boolean))],
    ...((search.get("taskId")?.trim()) ? { taskId: search.get("taskId")!.trim() } : {}),
  };
}

export function buildTaskCollectionSearch(
  query: TaskCollectionQuery,
  spaceKey: string,
): URLSearchParams {
  const search = new URLSearchParams({
    space: spaceKey,
    relation: query.relation,
    view: query.view,
    group: query.group,
    sort: query.sort,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.search) search.set("search", query.search);
  if (query.status.length) search.set("status", query.status.join(","));
  if (query.project?.length) search.set("project", query.project.join(","));
  if (query.taskId) search.set("taskId", query.taskId);
  return search;
}

export function taskCollectionQueryKey(
  context: WorkbenchContextIdentity,
  query: TaskCollectionQuery,
) {
  return workbenchQueryKey(context, "tasks", {
    view: query.view,
    relation: query.relation,
    search: query.search,
    status: query.status,
    group: query.group,
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
    project: query.project,
    taskId: query.taskId,
  });
}

export function createTaskCommandMetadata(expectedVersion: number) {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    commandId: `desktop:task:${id}`,
    expectedVersion,
  };
}
