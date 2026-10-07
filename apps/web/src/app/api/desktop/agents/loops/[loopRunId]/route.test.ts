import { beforeEach, describe, expect, it, vi } from "vitest";

import { commandDesktopLoop } from "@/lib/desktop/desktop-agent-commands";
import { readDesktopLoopDetail } from "@/lib/desktop/desktop-loop-detail";
import { GET, POST } from "./route";

vi.mock("@/lib/desktop/desktop-agent-commands", () => ({ commandDesktopLoop: vi.fn() }));
vi.mock("@/lib/desktop/desktop-loop-detail", () => ({ readDesktopLoopDetail: vi.fn() }));

const params = { params: Promise.resolve({ loopRunId: "loop_1" }) };

describe("desktop Agent Loop route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a strict versioned Loop result", async () => {
    vi.mocked(commandDesktopLoop).mockResolvedValue({
      resourceType: "loop", id: "loop_1", status: "paused", version: 4,
    });
    const response = await POST(new Request(
      "http://localhost/api/desktop/agents/loops/loop_1?space=personal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "desktop:agent:loop:1", command: "pause", expectedVersion: 3 }),
      },
    ), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: { resourceType: "loop", id: "loop_1", status: "paused", version: 4 },
    });
  });

  it("maps a stale Loop to conflict without exposing internals", async () => {
    vi.mocked(commandDesktopLoop).mockRejectedValue(Object.assign(new Error("Loop version conflict"), { code: "version_conflict" }));
    const response = await POST(new Request(
      "http://localhost/api/desktop/agents/loops/loop_1?space=personal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "desktop:agent:loop:1", command: "pause", expectedVersion: 3 }),
      },
    ), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "version_conflict" });
  });

  it("returns a forward-compatible Desktop Loop detail response", async () => {
    vi.mocked(readDesktopLoopDetail).mockResolvedValue({
      run: {
        id: "loop_1", status: "running", version: 3, definitionVersion: 2,
        projectionVersion: 4, currentIteration: 1, maxIterations: 5,
        transitionCount: 2, stopReason: null, waitingReason: null,
        lastHeartbeatAt: null,
      },
      task: { id: "task_1", title: "Desktop Loop detail", route: "/tasks/task_1" },
      worker: null,
      agentRunId: null,
      nodes: [],
      edges: [],
      timeline: [],
      interaction: null,
      capabilities: { canReply: false, canConfirm: false, canDecideApproval: false },
    });

    const response = await GET(new Request(
      "http://localhost/api/desktop/agents/loops/loop_1?space=personal",
    ), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { run: { id: "loop_1", version: 3 } },
    });
  });

  it("maps a Loop outside the selected Space to not found", async () => {
    vi.mocked(readDesktopLoopDetail).mockRejectedValue(new Error("Loop not found"));

    const response = await GET(new Request(
      "http://localhost/api/desktop/agents/loops/loop_1?space=personal",
    ), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "loop_not_found" });
  });
});
