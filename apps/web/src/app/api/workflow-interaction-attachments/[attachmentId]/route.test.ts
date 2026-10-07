import { describe, expect, it, vi } from "vitest";

import { readWorkflowInteractionAttachment } from "@/lib/orchestration/workflow-interaction-attachments";
import { GET } from "./route";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn().mockResolvedValue(Buffer.from("proof")) }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/orchestration/workflow-interaction-attachments", () => ({
  readWorkflowInteractionAttachment: vi.fn(),
  workflowInteractionAttachmentDisposition: vi.fn().mockReturnValue("attachment"),
}));

const context = { params: Promise.resolve({ attachmentId: "attachment_1" }) };

describe("workflow interaction attachment resource", () => {
  it("downloads only after protected attachment lookup", async () => {
    vi.mocked(readWorkflowInteractionAttachment).mockResolvedValue({
      filePath: "/tmp/proof",
      mimeType: "image/png",
      byteSize: 5,
      originalName: "proof.png",
    } as never);

    const response = await GET(new Request("http://localhost/api/workflow-interaction-attachments/attachment_1"), context);

    expect(response.status).toBe(200);
    expect(readWorkflowInteractionAttachment).toHaveBeenCalledWith({
      userId: "user_session",
      attachmentId: "attachment_1",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps quarantined attachments unavailable", async () => {
    vi.mocked(readWorkflowInteractionAttachment).mockRejectedValue(Object.assign(
      new Error("Workflow attachment is not available"),
      { code: "attachment_quarantined" },
    ));
    const response = await GET(new Request("http://localhost/api/workflow-interaction-attachments/attachment_1"), context);
    expect(response.status).toBe(423);
  });
});
