import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkflowInteractionAttachment,
  markWorkflowInteractionAttachmentScanned,
  readWorkflowInteractionAttachment,
} from "./workflow-interaction-attachments";

function authorizedInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: "interaction_1",
    projectId: "project_1",
    taskId: "task_1",
    loopRunId: "loop_run_1",
    status: "open",
    ...overrides,
  };
}

describe("workflow interaction attachments", () => {
  it.each([
    ["../secret.txt", "text/plain", 1, "invalid_name"],
    ["capture.exe", "application/octet-stream", 1, "unsupported_mime"],
    ["capture.png", "image/png", 10 * 1024 * 1024 + 1, "too_large"],
  ] as const)("rejects %s", async (fileName, mimeType, size, code) => {
    const bytes = new Uint8Array(size);
    await expect(createWorkflowInteractionAttachment({
      userId: "user_1",
      loopRunId: "loop_run_1",
      interactionId: "interaction_1",
      file: new File([bytes], fileName, { type: mimeType }),
      dependencies: {
        loadInteraction: vi.fn().mockResolvedValue(authorizedInteraction()),
        assertCanReply: vi.fn().mockResolvedValue(undefined),
      },
      db: { workflowInteractionAttachment: { create: vi.fn() } },
    })).rejects.toMatchObject({ code });
  });

  it("stores an opaque quarantined upload with a checksum", async () => {
    const root = await mkdtemp(join(tmpdir(), "ht-workflow-attachment-"));
    const create = vi.fn().mockImplementation(async ({ data }) => data);
    const result = await createWorkflowInteractionAttachment({
      userId: "user_1",
      loopRunId: "loop_run_1",
      interactionId: "interaction_1",
      file: new File(["proof"], "proof.png", { type: "image/png" }),
      storageRoot: root,
      createId: () => "attachment_1",
      dependencies: {
        loadInteraction: vi.fn().mockResolvedValue(authorizedInteraction()),
        assertCanReply: vi.fn().mockResolvedValue(undefined),
      },
      db: { workflowInteractionAttachment: { create } },
    });

    expect(await readFile(join(root, "interaction_1/attachment_1"), "utf8")).toBe("proof");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      scanStatus: "pending_scan",
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
      uploadedByUserId: "user_1",
    }) }));
    expect(result).toMatchObject({
      attachmentId: "attachment_1",
      fileName: "proof.png",
      mimeType: "image/png",
      byteSize: 5,
      scanStatus: "pending_scan",
    });
  });

  it("does not download a pending scan", async () => {
    await expect(readWorkflowInteractionAttachment({
      userId: "user_1",
      attachmentId: "attachment_1",
      dependencies: { assertCanReadProject: vi.fn().mockResolvedValue({ role: "viewer" }) },
      db: { workflowInteractionAttachment: { findUnique: vi.fn().mockResolvedValue({
        id: "attachment_1",
        interactionId: "interaction_1",
        storageKey: "interaction_1/attachment_1",
        originalName: "proof.png",
        mimeType: "image/png",
        byteSize: 5,
        scanStatus: "pending_scan",
        interaction: { projectId: "project_1" },
      }) } },
    })).rejects.toMatchObject({ code: "attachment_quarantined" });
  });

  it("marks a pending upload safe exactly once", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(markWorkflowInteractionAttachmentScanned({
      attachmentId: "attachment_1",
      scanStatus: "safe",
      scanner: "clamav:1",
      scannedAt: new Date("2026-08-05T11:00:00.000Z"),
    }, { db: { workflowInteractionAttachment: { updateMany } } })).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "attachment_1", scanStatus: "pending_scan" },
      data: expect.objectContaining({ scanStatus: "safe", scanner: "clamav:1" }),
    });
  });
});
