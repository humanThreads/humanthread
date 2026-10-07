import { expect, it, vi } from "vitest";

import { exportWorkflowTimeline } from "@/lib/orchestration/workflow-timeline-export";
import { GET } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/orchestration/workflow-timeline-export", () => ({ exportWorkflowTimeline: vi.fn() }));

it("downloads a private timeline export with a sanitized filename", async () => {
  vi.mocked(exportWorkflowTimeline).mockResolvedValue({
    contentType: "application/json",
    fileName: "loop-run-run_1-timeline.json",
    body: "{\"schemaVersion\":1}",
  });
  const response = await GET(
    new Request("http://localhost/api/loop-runs/run_1/timeline/export?format=json"),
    { params: Promise.resolve({ loopRunId: "run_1" }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("loop-run-run_1-timeline.json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(exportWorkflowTimeline).toHaveBeenCalledWith(expect.objectContaining({
    userId: "user_session", loopRunId: "run_1", format: "json",
  }));
});
