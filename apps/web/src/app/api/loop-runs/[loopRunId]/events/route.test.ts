import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLoopEventsAfterCursor } from "@/lib/orchestration/loop-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET } from "./route";

vi.mock("@/lib/orchestration/loop-read-model", () => ({ readLoopEventsAfterCursor: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop_run_1" }) };

describe("GET /api/loop-runs/:loopRunId/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("reads events after a validated cursor", async () => {
    vi.mocked(readLoopEventsAfterCursor).mockResolvedValue({ cursor: 14, events: [] });

    const response = await GET(new Request("http://localhost/api/loop-runs/loop_run_1/events?cursor=12"), context);

    expect(response.status).toBe(200);
    expect(readLoopEventsAfterCursor).toHaveBeenCalledWith({
      userId: "user_1",
      loopRunId: "loop_run_1",
      cursor: 12,
    });
  });

  it("authenticates before rejecting an invalid cursor", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await GET(new Request("http://localhost/api/loop-runs/loop_run_1/events?cursor=invalid"), context);

    expect(response.status).toBe(401);
    expect(readLoopEventsAfterCursor).not.toHaveBeenCalled();
  });
});
