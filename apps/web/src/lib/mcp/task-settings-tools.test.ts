import { describe, expect, it, vi } from "vitest";
import { dispatchMcpTaskSettingsTool } from "./task-settings-tools";

describe("MCP Task settings tools", () => {
  it("creates a label with a server-owned ID when the caller omits one", async () => {
    const createTaskLabelDefinition = vi.fn().mockResolvedValue({ id: "label:created", name: "发布", color: "#0969da" });
    const result = await dispatchMcpTaskSettingsTool({
      tool: "create_task_label_definition",
      actorUserId: "user_1",
      arguments: { spaceId: "space_1", name: "发布", color: "#0969da" },
    }, { createTaskLabelDefinition });

    expect(createTaskLabelDefinition).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", spaceId: "space_1", name: "发布", color: "#0969da", id: expect.stringMatching(/^label:/u) }));
    expect(result).toEqual({ label: { id: "label:created", name: "发布", color: "#0969da" }, keyGuide: { labelId: "label.id" } });
  });

  it("lists status definitions with definition IDs and project scope", async () => {
    const listTaskStatusDefinitions = vi.fn().mockResolvedValue([{ id: "status_1", projectId: "project_1", key: "qa" }]);
    const result = await dispatchMcpTaskSettingsTool({
      tool: "list_task_status_definitions",
      actorUserId: "user_1",
      arguments: { spaceId: "space_1", projectId: "project_1" },
    }, { listTaskStatusDefinitions });

    expect(listTaskStatusDefinitions).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1", projectId: "project_1" });
    expect(result).toEqual({
      definitions: [{ id: "status_1", projectId: "project_1", key: "qa" }],
      keyGuide: { definitionId: "definitions[].id", projectId: "definitions[].projectId" },
    });
  });

  it("routes label and status definition deletions to their scoped commands", async () => {
    const deleteTaskLabelDefinition = vi.fn().mockResolvedValue({ count: 1 });
    const deleteTaskStatusDefinition = vi.fn().mockResolvedValue({ count: 1 });
    await dispatchMcpTaskSettingsTool({ tool: "delete_task_label_definition", actorUserId: "user_1", arguments: { spaceId: "space_1", labelId: "label_1" } }, { deleteTaskLabelDefinition });
    await dispatchMcpTaskSettingsTool({ tool: "delete_task_status_definition", actorUserId: "user_1", arguments: { spaceId: "space_1", definitionId: "status_1" } }, { deleteTaskStatusDefinition });

    expect(deleteTaskLabelDefinition).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1", labelId: "label_1" });
    expect(deleteTaskStatusDefinition).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1", definitionId: "status_1" });
  });
});
