import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readTaskAttachment, removeTaskAttachment, saveTaskAttachment } from "./task-attachments";

describe("Task attachments", () => {
  it("stores an opaque protected file after Task write authorization", async () => {
    const root = await mkdtemp(join(tmpdir(), "ht-task-attachment-"));
    const create = vi.fn().mockResolvedValue({ id: "attachment_1", originalName: "proof.txt", mimeType: "text/plain", byteSize: 5n });
    const assertCanEditTask = vi.fn().mockResolvedValue({ role: "creator" });
    const result = await saveTaskAttachment({
      userId: "user_1", taskId: "task_1", file: new File(["proof"], "proof.txt", { type: "text/plain" }),
      storageRoot: root, createId: () => "attachment_1", dependencies: { assertCanEditTask },
      db: { taskAttachment: { create } },
    });
    expect(assertCanEditTask).toHaveBeenCalledWith({ userId: "user_1", taskId: "task_1" });
    expect(await readFile(join(root, "task_1/attachment_1"), "utf8")).toBe("proof");
    expect(result.downloadUrl).toBe("/api/task-attachments/attachment_1");
  });

  it("checks Task read authorization before returning a file path", async () => {
    const assertCanReadTask = vi.fn().mockResolvedValue({ role: "follower" });
    const result = await readTaskAttachment({
      userId: "user_1", attachmentId: "attachment_1", storageRoot: "/tmp/task-attachments",
      dependencies: { assertCanReadTask }, db: { taskAttachment: { findUnique: vi.fn().mockResolvedValue({
        id: "attachment_1", taskId: "task_1", storageKey: "task_1/attachment_1", originalName: "proof.txt",
        mimeType: "text/plain", byteSize: 5n, deletedAt: null,
      }) } },
    });
    expect(assertCanReadTask).toHaveBeenCalledWith({ userId: "user_1", taskId: "task_1" });
    expect(result.filePath).toBe("/tmp/task-attachments/task_1/attachment_1");
  });

  it("soft deletes metadata only after Task edit authorization", async () => {
    const assertCanEditTask = vi.fn().mockResolvedValue({ role: "creator" });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(removeTaskAttachment({
      userId: "user_1", attachmentId: "attachment_1", storageRoot: "/tmp/task-attachments",
      dependencies: { assertCanEditTask }, db: { taskAttachment: {
        findUnique: vi.fn().mockResolvedValue({ id: "attachment_1", taskId: "task_1", storageKey: "task_1/attachment_1", deletedAt: null }),
        updateMany,
      } },
    })).resolves.toMatchObject({ id: "attachment_1" });
    expect(assertCanEditTask).toHaveBeenCalledWith({ userId: "user_1", taskId: "task_1" });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "attachment_1", deletedAt: null } }));
  });
});
