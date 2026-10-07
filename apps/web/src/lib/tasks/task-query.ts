import type { TaskRelationFilter } from "@humanthread/db";
import type { TaskStatusCategory } from "@humanthread/orchestration-core";

export type TaskCollectionView = "list" | "board" | "calendar";
export type TaskGroup = "status" | "assignee" | "priority" | "project";
export type TaskSort = "updated_desc" | "due_asc" | "priority_desc" | "created_desc";
export type TaskRelation = TaskRelationFilter | "all" | "blocked" | "completed" | "archived";

export interface ParsedTaskQuery {
  spaceKey: string;
  search?: string;
  relation: TaskRelation;
  view: TaskCollectionView;
  status: TaskStatusCategory[];
  assignee: string[];
  priority: number[];
  project: string[];
  dateFrom?: string;
  dateTo?: string;
  group: TaskGroup;
  sort: TaskSort;
  taskId?: string;
  shortId?: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

const STATUSES = new Set<TaskStatusCategory>([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "completed",
  "cancelled",
]);
const RELATIONS = new Set<TaskRelation>([
  "all",
  "assigned",
  "created",
  "participating",
  "following",
  "overdue",
  "blocked",
  "completed",
  "archived",
]);
const VIEWS = new Set<TaskCollectionView>(["list", "board", "calendar"]);
const GROUPS = new Set<TaskGroup>(["status", "assignee", "priority", "project"]);
const SORTS = new Set<TaskSort>(["updated_desc", "due_asc", "priority_desc", "created_desc"]);

function values(value: string | string[] | undefined) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
}

function first(value: string | string[] | undefined) {
  return values(value)[0];
}

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month! - 1
    && candidate.getUTCDate() === day
    ? value
    : undefined;
}

function enumValue<T extends string>(value: string | undefined, allowed: Set<T>, fallback: T): T {
  return allowed.has(value as T) ? value as T : fallback;
}

export function parseTaskQuery(searchParams: SearchParams = {}): ParsedTaskQuery {
  const dateFrom = validDate(first(searchParams.dateFrom));
  const dateTo = validDate(first(searchParams.dateTo));
  const taskId = first(searchParams.taskId);
  const shortId = first(searchParams.shortId);
  const search = first(searchParams.search)?.trim();
  return {
    spaceKey: first(searchParams.spaceKey)?.trim() || "all",
    ...(search ? { search } : {}),
    relation: enumValue(first(searchParams.relation), RELATIONS, "all"),
    view: enumValue(first(searchParams.view), VIEWS, "list"),
    status: values(searchParams.status).filter((value): value is TaskStatusCategory => STATUSES.has(value as TaskStatusCategory)),
    assignee: [...new Set(values(searchParams.assignee))],
    priority: [...new Set(values(searchParams.priority).map(Number).filter(Number.isInteger))],
    project: [...new Set(values(searchParams.project))],
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    group: enumValue(first(searchParams.group), GROUPS, "status"),
    sort: enumValue(first(searchParams.sort), SORTS, "updated_desc"),
    ...(taskId ? { taskId } : {}),
    ...(shortId ? { shortId } : {}),
  };
}
