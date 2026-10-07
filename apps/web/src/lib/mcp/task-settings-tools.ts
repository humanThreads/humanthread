import { randomUUID } from "node:crypto";
import {
  createTaskLabelDefinition,
  createTaskStatusDefinition,
  deleteTaskLabelDefinition,
  deleteTaskStatusDefinition,
  listTaskStatusDefinitions,
} from "../tasks/task-settings";

export type McpTaskSettingsToolRequest =
  | { tool: "create_task_label_definition"; actorUserId: string; arguments: { spaceId: string; name: string; color: string; id?: string } }
  | { tool: "delete_task_label_definition"; actorUserId: string; arguments: { spaceId: string; labelId: string } }
  | { tool: "list_task_status_definitions"; actorUserId: string; arguments: { spaceId: string; projectId?: string } }
  | { tool: "create_task_status_definition"; actorUserId: string; arguments: { spaceId: string; projectId?: string; key: string; name: string; category: "backlog" | "todo" | "in_progress" | "in_review" | "completed" | "cancelled"; color: string; sortOrder: number; id?: string } }
  | { tool: "delete_task_status_definition"; actorUserId: string; arguments: { spaceId: string; definitionId: string } };

type Dependencies = Partial<{
  createTaskLabelDefinition: typeof createTaskLabelDefinition;
  deleteTaskLabelDefinition: typeof deleteTaskLabelDefinition;
  listTaskStatusDefinitions: typeof listTaskStatusDefinitions;
  createTaskStatusDefinition: typeof createTaskStatusDefinition;
  deleteTaskStatusDefinition: typeof deleteTaskStatusDefinition;
}>;

function generatedId(prefix: string) {
  return `${prefix}:${randomUUID()}`;
}

export async function dispatchMcpTaskSettingsTool(request: McpTaskSettingsToolRequest, overrides: Dependencies = {}) {
  const dependencies = {
    createTaskLabelDefinition,
    deleteTaskLabelDefinition,
    listTaskStatusDefinitions,
    createTaskStatusDefinition,
    deleteTaskStatusDefinition,
    ...overrides,
  };
  switch (request.tool) {
    case "create_task_label_definition": {
      const label = await dependencies.createTaskLabelDefinition({
        userId: request.actorUserId,
        spaceId: request.arguments.spaceId,
        name: request.arguments.name,
        color: request.arguments.color,
        id: request.arguments.id ?? generatedId("label"),
      });
      return { label, keyGuide: { labelId: "label.id" } };
    }
    case "delete_task_label_definition":
      return {
        result: await dependencies.deleteTaskLabelDefinition({
          userId: request.actorUserId,
          spaceId: request.arguments.spaceId,
          labelId: request.arguments.labelId,
        }),
        keyGuide: { labelId: "result.labelId or request.labelId" },
      };
    case "list_task_status_definitions":
      return {
        definitions: await dependencies.listTaskStatusDefinitions({
          userId: request.actorUserId,
          spaceId: request.arguments.spaceId,
          ...(request.arguments.projectId ? { projectId: request.arguments.projectId } : {}),
        }),
        keyGuide: { definitionId: "definitions[].id", projectId: "definitions[].projectId" },
      };
    case "create_task_status_definition": {
      const definition = await dependencies.createTaskStatusDefinition({
        userId: request.actorUserId,
        spaceId: request.arguments.spaceId,
        ...(request.arguments.projectId ? { projectId: request.arguments.projectId } : {}),
        key: request.arguments.key,
        name: request.arguments.name,
        category: request.arguments.category,
        color: request.arguments.color,
        sortOrder: request.arguments.sortOrder,
        id: request.arguments.id ?? generatedId("status"),
      });
      return { definition, keyGuide: { definitionId: "definition.id" } };
    }
    case "delete_task_status_definition":
      return {
        result: await dependencies.deleteTaskStatusDefinition({
          userId: request.actorUserId,
          spaceId: request.arguments.spaceId,
          definitionId: request.arguments.definitionId,
        }),
        keyGuide: { definitionId: "request.definitionId" },
      };
  }
}
