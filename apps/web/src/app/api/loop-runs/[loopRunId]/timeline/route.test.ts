import { expect, it, vi } from "vitest";

import { readWorkflowTimeline } from "@/lib/orchestration/workflow-timeline-query";
import { GET } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/orchestration/workflow-timeline-query", () => ({ readWorkflowTimeline: vi.fn() }));

it("reads a filtered authorized workflow timeline", async () => {
  vi.mocked(readWorkflowTimeline).mockResolvedValue({
    items: [],
    nextCursor: null,
    filters: { query: "需求" },
    capabilities: { canReply: true, canConfirm: false, canDecideApproval: false, canExport: true, supportsInteractions: true },
  });
  const response = await GET(
    new Request("http://localhost/api/loop-runs/run_1/timeline?query=%E9%9C%80%E6%B1%82&kinds=requirement_message&limit=20"),
    { params: Promise.resolve({ loopRunId: "run_1" }) },
  );
  expect(response.status).toBe(200);
  expect(readWorkflowTimeline).toHaveBeenCalledWith(expect.objectContaining({
    userId: "user_session", loopRunId: "run_1", query: "需求", kinds: ["requirement_message"], limit: 20,
  }));
});
