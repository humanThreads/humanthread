import { describe, expect, it, vi } from "vitest";

import { exportWorkflowTimeline } from "./workflow-timeline-export";

const page = {
  items: [{
    id: "message_1",
    kind: "requirement_message" as const,
    occurredAt: "2026-08-05T10:00:00.000Z",
    interactionId: "interaction_1",
    loopNodeRunId: "node_1",
    actorType: "agent",
    actorId: "agent_1",
    nodeKey: null,
    status: "open",
    eventType: "workflow.interaction.message_appended",
    summary: "已脱敏",
    body: "AK=[REDACTED]",
    answers: { mode: ["single"] },
    attachmentIds: ["attachment_1"],
  }],
  nextCursor: null,
  filters: {},
  capabilities: { canReply: false, canConfirm: false, canDecideApproval: false, canExport: true, supportsInteractions: true },
};

describe("workflow timeline export", () => {
  it("exports stable redacted JSON with schema metadata", async () => {
    const result = await exportWorkflowTimeline({ userId: "user_1", loopRunId: "run_1", format: "json", filters: {} }, {
      readWorkflowTimeline: vi.fn().mockResolvedValue(page),
      loadRun: vi.fn().mockResolvedValue({ projectId: "project_1", definitionVersion: 3 }),
    });
    expect(result.contentType).toBe("application/json");
    expect(result.body).toContain('"schemaVersion":1');
    expect(result.body).toContain('"attachmentIds":["attachment_1"]');
    expect(result.body).not.toContain("storage/workflow/private-key.pem");
  });

  it("exports Markdown with a stable table and never emits storage keys", async () => {
    const result = await exportWorkflowTimeline({ userId: "user_1", loopRunId: "run_1", format: "markdown", filters: {} }, {
      readWorkflowTimeline: vi.fn().mockResolvedValue(page),
      loadRun: vi.fn().mockResolvedValue({ projectId: "project_1", definitionVersion: 3 }),
    });
    expect(result.contentType).toBe("text/markdown");
    expect(result.body).toContain("# LoopRun Timeline");
    expect(result.body).toContain("| Time | Actor | Kind | Status | Summary |");
    expect(result.body).not.toContain("storage/");
  });

  it("rejects an export that exceeds the bounded record count", async () => {
    await expect(exportWorkflowTimeline({ userId: "user_1", loopRunId: "run_1", format: "json", filters: {} }, {
      readWorkflowTimeline: vi.fn().mockResolvedValue({ ...page, items: Array.from({ length: 5_001 }, () => page.items[0]) }),
      loadRun: vi.fn().mockResolvedValue({ projectId: "project_1", definitionVersion: 3 }),
    })).rejects.toMatchObject({ code: "export_too_large" });
  });
});
