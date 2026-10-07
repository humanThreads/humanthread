import { describe, expect, it, vi } from "vitest";
import { readTaskAttachment, removeTaskAttachment } from "@/lib/tasks/task-attachments";
import { DELETE, GET } from "./route";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn().mockResolvedValue(Buffer.from("proof")) }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-attachments", () => ({
  readTaskAttachment: vi.fn(), removeTaskAttachment: vi.fn(),
  isInlineTaskAttachment: vi.fn().mockReturnValue(false), taskAttachmentDisposition: vi.fn().mockReturnValue("attachment"),
}));

const context = { params: Promise.resolve({ attachmentId: "attachment_1" }) };

describe("Task attachment resource API", () => {
  it("downloads only after protected attachment lookup", async () => {
    vi.mocked(readTaskAttachment).mockResolvedValue({ filePath: "/tmp/proof", mimeType: "text/plain", byteSize: 5, originalName: "proof.txt" } as never);
    const response = await GET(new Request("http://localhost/api/task-attachments/attachment_1"), context);
    expect(response.status).toBe(200);
    expect(readTaskAttachment).toHaveBeenCalledWith({ userId: "user_session", attachmentId: "attachment_1" });
  });

  it("soft deletes as the signed user", async () => {
    vi.mocked(removeTaskAttachment).mockResolvedValue({ id: "attachment_1" } as never);
    expect((await DELETE(new Request("http://localhost/api/task-attachments/attachment_1", { method: "DELETE" }), context)).status).toBe(200);
  });
});
