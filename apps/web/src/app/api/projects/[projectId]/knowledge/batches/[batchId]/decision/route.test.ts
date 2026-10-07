import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCanWriteKnowledgeBatch,
  decideKnowledgeBatchForIngestion,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  assertCanWriteKnowledgeBatch: vi.fn(),
  decideKnowledgeBatchForIngestion: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

function request(body: unknown): Request {
  return new Request(
    "http://localhost/api/projects/project_1/knowledge/batches/batch_1/decision",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/projects/:projectId/knowledge/batches/:batchId/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "reviewer_1",
      authKind: "web_session",
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    vi.mocked(assertCanWriteKnowledgeBatch).mockResolvedValue({ id: "batch_1" } as never);
    vi.mocked(decideKnowledgeBatchForIngestion).mockResolvedValue({
      batchId: "batch_1",
      entries: [{ entryId: "entry_1", stableKey: "rule.release", version: 1, status: "published" }],
      unresolvedItemIds: [],
    });
  });

  it("approves selected items through the authenticated reviewer", async () => {
    const response = await POST(
      request({
        commandId: "decision_1",
        decision: "approve",
        itemIds: ["item_1"],
      }),
      { params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { batchId: "batch_1", unresolvedItemIds: [] },
    });
    expect(assertCanWriteKnowledgeBatch).toHaveBeenCalledWith({
      userId: "reviewer_1",
      projectId: "project_1",
      batchId: "batch_1",
    });
    expect(decideKnowledgeBatchForIngestion).toHaveBeenCalledWith({
      batchId: "batch_1",
      actorDigest: "reviewer_1",
      commandId: "decision_1",
      decision: "approve",
      itemIds: ["item_1"],
    });
  });

  it("rejects an empty rejection reason before dispatch", async () => {
    const response = await POST(
      request({
        commandId: "decision_2",
        decision: "reject",
        itemIds: ["item_1"],
        reason: " ",
      }),
      { params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }) },
    );

    expect(response.status).toBe(400);
    expect(assertCanWriteKnowledgeBatch).not.toHaveBeenCalled();
    expect(decideKnowledgeBatchForIngestion).not.toHaveBeenCalled();
  });

  it("returns 403 before deciding when batch write authorization fails", async () => {
    vi.mocked(assertCanWriteKnowledgeBatch).mockRejectedValue(
      new Error("Project write access denied"),
    );

    const response = await POST(
      request({ commandId: "decision_1", decision: "approve" }),
      { params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }) },
    );

    expect(response.status).toBe(403);
    expect(decideKnowledgeBatchForIngestion).not.toHaveBeenCalled();
  });

  it("returns 409 when the batch changes during review", async () => {
    vi.mocked(decideKnowledgeBatchForIngestion).mockRejectedValue(
      Object.assign(new Error("Knowledge batch changed while reviewing"), {
        code: "version_conflict",
      }),
    );

    const response = await POST(
      request({ commandId: "decision_1", decision: "approve" }),
      { params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }) },
    );

    expect(response.status).toBe(409);
  });
});
