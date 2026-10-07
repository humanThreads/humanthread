import { randomUUID } from "node:crypto";
import { deleteTaskSavedView, listTaskSavedViews, saveTaskView, updateTaskSavedView } from "../tasks/task-read-model";
import { parseTaskQuery, type ParsedTaskQuery } from "../tasks/task-query";

type QueryInput = {
  search?: string;
  relation?: string;
  status?: string[];
  assignee?: string[];
  priority?: number[];
  project?: string[];
  dateFrom?: string;
  dateTo?: string;
  group?: string;
  sort?: string;
  view?: string;
};

type ViewArguments = { name: string; query: QueryInput };

export type McpTaskViewToolRequest =
  | { tool: "list_task_saved_views"; actorUserId: string; arguments: Record<string, never> }
  | { tool: "create_task_saved_view"; actorUserId: string; arguments: ViewArguments & { id?: string } }
  | { tool: "update_task_saved_view"; actorUserId: string; arguments: ViewArguments & { viewId: string } }
  | { tool: "delete_task_saved_view"; actorUserId: string; arguments: { viewId: string } };

type Dependencies = Partial<{
  listTaskSavedViews: typeof listTaskSavedViews;
  saveTaskView: typeof saveTaskView;
  updateTaskSavedView: typeof updateTaskSavedView;
  deleteTaskSavedView: typeof deleteTaskSavedView;
}>;

function generatedId() {
  return `view:${randomUUID()}`;
}

function toParsedQuery(query: QueryInput): ParsedTaskQuery {
  return parseTaskQuery({
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.relation !== undefined ? { relation: query.relation } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.assignee !== undefined ? { assignee: query.assignee } : {}),
    ...(query.priority !== undefined ? { priority: query.priority.map(String) } : {}),
    ...(query.project !== undefined ? { project: query.project } : {}),
    ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
    ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
    ...(query.group !== undefined ? { group: query.group } : {}),
    ...(query.sort !== undefined ? { sort: query.sort } : {}),
    ...(query.view !== undefined ? { view: query.view } : {}),
  });
}

export async function dispatchMcpTaskViewTool(request: McpTaskViewToolRequest, overrides: Dependencies = {}) {
  const dependencies = { listTaskSavedViews, saveTaskView, updateTaskSavedView, deleteTaskSavedView, ...overrides };
  switch (request.tool) {
    case "list_task_saved_views":
      return {
        views: await dependencies.listTaskSavedViews({ userId: request.actorUserId }),
        keyGuide: { viewId: "views[].id" },
      };
    case "create_task_saved_view": {
      const view = await dependencies.saveTaskView({
        userId: request.actorUserId,
        id: request.arguments.id ?? generatedId(),
        name: request.arguments.name,
        query: toParsedQuery(request.arguments.query),
      });
      return { view, keyGuide: { viewId: "view.id" } };
    }
    case "update_task_saved_view": {
      const result = await dependencies.updateTaskSavedView({
        userId: request.actorUserId,
        viewId: request.arguments.viewId,
        name: request.arguments.name,
        query: toParsedQuery(request.arguments.query),
      });
      if (result.count !== 1) throw Object.assign(new Error("Saved view not found"), { code: "not_found" });
      return { result, keyGuide: { viewId: "request.viewId" } };
    }
    case "delete_task_saved_view": {
      const result = await dependencies.deleteTaskSavedView({ userId: request.actorUserId, viewId: request.arguments.viewId });
      if (result.count !== 1) throw Object.assign(new Error("Saved view not found"), { code: "not_found" });
      return { result, keyGuide: { viewId: "request.viewId" } };
    }
  }
}
