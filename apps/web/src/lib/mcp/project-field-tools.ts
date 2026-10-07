import {
  deleteProjectTaskField,
  listProjectTaskFields,
  upsertProjectTaskField,
} from "../workbench/project-task-fields";

export type McpProjectFieldToolRequest =
  | { tool: "list_project_task_fields"; actorUserId: string; arguments: { projectId: string } }
  | { tool: "upsert_project_task_field"; actorUserId: string; arguments: { projectId: string; field: { key: string; name: string; type: string; required?: boolean; options?: unknown; sortOrder?: number; isActive?: boolean } } }
  | { tool: "delete_project_task_field"; actorUserId: string; arguments: { projectId: string; fieldId: string } };

type Dependencies = Partial<{
  listProjectTaskFields: typeof listProjectTaskFields;
  upsertProjectTaskField: typeof upsertProjectTaskField;
  deleteProjectTaskField: typeof deleteProjectTaskField;
}>;

export async function dispatchMcpProjectFieldTool(request: McpProjectFieldToolRequest, overrides: Dependencies = {}) {
  const dependencies = { listProjectTaskFields, upsertProjectTaskField, deleteProjectTaskField, ...overrides };
  if (request.tool === "list_project_task_fields") {
    return {
      fields: await dependencies.listProjectTaskFields({ userId: request.actorUserId, projectId: request.arguments.projectId }),
      keyGuide: { fieldId: "fields[].id" },
    };
  }
  if (request.tool === "upsert_project_task_field") {
    return {
      field: await dependencies.upsertProjectTaskField({
        userId: request.actorUserId,
        projectId: request.arguments.projectId,
        field: request.arguments.field,
      }),
      keyGuide: { fieldId: "field.id" },
    };
  }
  return {
    result: await dependencies.deleteProjectTaskField({
      userId: request.actorUserId,
      projectId: request.arguments.projectId,
      fieldId: request.arguments.fieldId,
    }),
    keyGuide: { fieldId: "result.fieldId" },
  };
}
