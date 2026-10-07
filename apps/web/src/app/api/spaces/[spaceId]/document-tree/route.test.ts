import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { listWorkbenchDocumentTree } from "@/lib/workbench/workbench-documents";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

vi.mock("@/lib/workbench/workbench-documents", () => ({
  listWorkbenchDocumentTree: vi.fn().mockResolvedValue({ spaceId: "space_1", groups: [], trash: [] }),
  createWorkbenchDocumentDirectory: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_1" }),
}));

describe("space document tree API", () => {
  it("passes the selected project to the tree query", async () => {
    const response = await GET(
      new Request("http://localhost/api/spaces/space_1/document-tree?projectId=project_1"),
      { params: Promise.resolve({ spaceId: "space_1" }) },
    );

    expect(response.status).toBe(200);
    expect(resolveWorkbenchApiActor).toHaveBeenCalled();
    expect(listWorkbenchDocumentTree).toHaveBeenCalledWith({
      userId: "user_1",
      spaceId: "space_1",
      projectId: "project_1",
    });
  });
});
