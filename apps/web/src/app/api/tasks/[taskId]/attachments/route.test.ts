import { expect, it, vi } from "vitest";
import { saveTaskAttachment } from "@/lib/tasks/task-attachments";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-attachments", () => ({ saveTaskAttachment: vi.fn() }));
vi.mock("@/lib/storage/storage-settings", () => ({ getStorageSettings: vi.fn(async () => null) }));

it("uploads a protected Task attachment as the signed user", async () => {
  vi.mocked(saveTaskAttachment).mockResolvedValue({ id: "attachment_1", downloadUrl: "/api/task-attachments/attachment_1" } as never);
  const form = new FormData();
  form.set("file", new File(["proof"], "proof.txt", { type: "text/plain" }));
  form.set("userId", "attacker");
  const response = await POST(new Request("http://localhost/api/tasks/task_1/attachments", { method: "POST", body: form }), {
    params: Promise.resolve({ taskId: "task_1" }),
  });
  expect(response.status).toBe(201);
  expect(saveTaskAttachment).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_session", taskId: "task_1" }));
});
