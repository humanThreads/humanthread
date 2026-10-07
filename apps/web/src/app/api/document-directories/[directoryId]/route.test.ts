import { describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "./route";

vi.mock("@/lib/workbench/workbench-documents", () => ({
  deleteWorkbenchDocumentDirectory: vi.fn().mockResolvedValue({ id: "dir_1" }),
  updateWorkbenchDocumentDirectory: vi.fn().mockResolvedValue({ id: "dir_1" }),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_1" }),
}));

describe("document directory API conflicts", () => {
  it("returns 409 when deleting a non-empty directory", async () => {
    const { deleteWorkbenchDocumentDirectory } = await import("@/lib/workbench/workbench-documents");
    vi.mocked(deleteWorkbenchDocumentDirectory).mockRejectedValueOnce(
      new Error("Document directory is not empty"),
    );

    const response = await DELETE(
      new Request("http://localhost/api/document-directories/dir_1", { method: "DELETE" }),
      { params: Promise.resolve({ directoryId: "dir_1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Document directory is not empty",
    });
  });

  it.each([
    "Document directory cycle",
    "Document directory move crosses containers",
  ])("returns 409 for %s", async (message) => {
    const { updateWorkbenchDocumentDirectory } = await import("@/lib/workbench/workbench-documents");
    vi.mocked(updateWorkbenchDocumentDirectory).mockRejectedValueOnce(new Error(message));

    const response = await PATCH(
      new Request("http://localhost/api/document-directories/dir_1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: "dir_2" }),
      }),
      { params: Promise.resolve({ directoryId: "dir_1" }) },
    );

    expect(response.status).toBe(409);
  });
});
