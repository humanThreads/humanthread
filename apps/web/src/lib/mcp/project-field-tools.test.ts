import { describe, expect, it, vi } from "vitest";
import { dispatchMcpProjectFieldTool } from "./project-field-tools";

describe("MCP Project task field tools", () => {
  it("lists fields with the field ID needed by delete", async () => {
    const listProjectTaskFields = vi.fn().mockResolvedValue([{ id: "field_1", key: "owner" }]);
    const result = await dispatchMcpProjectFieldTool({
      tool: "list_project_task_fields",
      actorUserId: "user_1",
      arguments: { projectId: "project_1" },
    }, { listProjectTaskFields });

    expect(result).toEqual({
      fields: [{ id: "field_1", key: "owner" }],
      keyGuide: { fieldId: "fields[].id" },
    });
  });

  it("deletes a project field through the shared command", async () => {
    const deleteProjectTaskField = vi.fn().mockResolvedValue({ fieldId: "field_1", isActive: false });
    const result = await dispatchMcpProjectFieldTool({
      tool: "delete_project_task_field",
      actorUserId: "user_1",
      arguments: { projectId: "project_1", fieldId: "field_1" },
    }, { deleteProjectTaskField });

    expect(deleteProjectTaskField).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1", fieldId: "field_1" });
    expect(result).toEqual({
      result: { fieldId: "field_1", isActive: false },
      keyGuide: { fieldId: "result.fieldId" },
    });
  });
});
