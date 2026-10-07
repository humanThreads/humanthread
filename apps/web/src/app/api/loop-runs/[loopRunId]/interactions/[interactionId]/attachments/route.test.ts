import { expect, it, vi } from "vitest";

import { createWorkflowInteractionAttachment } from "@/lib/orchestration/workflow-interaction-attachments";
import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/orchestration/workflow-interaction-attachments", () => ({
  createWorkflowInteractionAttachment: vi.fn(),
}));

it("uploads a quarantined workflow attachment as the signed user", async () => {
  vi.mocked(createWorkflowInteractionAttachment).mockResolvedValue({
    attachmentId: "attachment_1",
    fileName: "proof.png",
    mimeType: "image/png",
    byteSize: 5,
    scanStatus: "pending_scan",
  });
  const form = new FormData();
  form.set("file", new File(["proof"], "proof.png", { type: "image/png" }));
  form.set("userId", "attacker");

  const response = await POST(new Request("http://localhost/api/loop-runs/loop_run_1/interactions/interaction_1/attachments", {
    method: "POST",
    body: form,
  }), { params: Promise.resolve({ loopRunId: "loop_run_1", interactionId: "interaction_1" }) });

  expect(response.status).toBe(201);
  expect(createWorkflowInteractionAttachment).toHaveBeenCalledWith(expect.objectContaining({
    userId: "user_session",
    loopRunId: "loop_run_1",
    interactionId: "interaction_1",
  }));
});
