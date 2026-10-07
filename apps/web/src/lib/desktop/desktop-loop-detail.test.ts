import { describe, expect, it, vi } from "vitest";

import { readDesktopLoopDetail } from "./desktop-loop-detail";

const context = {
  actor: { userId: "user_1" },
  space: { id: "space_1" },
};

const scope = {
  id: "loop_1",
  spaceId: "space_1",
  task: { id: "task_1", title: "Desktop Loop detail" },
  version: 4,
  currentIteration: 2,
  maxIterations: 5,
  waitingReason: "requirement_confirmation",
  lastHeartbeatAt: new Date("2026-08-06T10:05:00.000Z"),
  worker: { id: "worker_1", name: "Mac Studio", status: "online" },
  agentRunId: "agent_run_1",
};

const projection = {
  definitionVersion: 2,
  projectionVersion: 7,
  eventCursor: 1,
  run: {
    id: "loop_1", status: "waiting", repeatCount: 0, transitionCount: 6,
    stopReason: null,
  },
  nodes: [{
    nodeKey: "develop", label: "Develop", type: "agent_action", status: "waiting_input",
    currentNodeRunId: "node_run_1", attemptNo: 1, waitingReason: "requirement_confirmation",
    attempts: [{
      attempt: 1, status: "waiting", executorType: "local_agent",
      startedAt: "2026-08-06T10:00:00.000Z", finishedAt: null,
      result: { summary: "Ready", accessToken: "must-not-leak" },
      error: { message: "Paused", command: "rm -rf sensitive" },
    }],
  }],
  edges: [{
    edgeId: "edge_done", source: "develop", target: "test", kind: "forward",
    outcome: "success", traversalCount: 0, limit: 1, lastTraversalAt: null,
  }],
  activities: [],
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
    loadLoopScope: vi.fn().mockResolvedValue(scope),
    readLoopRunProjection: vi.fn().mockResolvedValue(projection),
    readWorkflowTimeline: vi.fn().mockResolvedValue({
      items: [{
        id: "timeline_1", kind: "loop_event", occurredAt: "2026-08-06T10:05:00.000Z",
        summary: "Waiting", actorType: "agent", actorId: "agent_1", status: "open",
      }],
      capabilities: { canReply: true, canConfirm: true, canDecideApproval: false },
    }),
    readAuthorizedLoopRunInteractions: vi.fn().mockResolvedValue({
      interactions: [{
        id: "interaction_1", kind: "requirement_conversation", status: "open", version: 3,
        createdAt: "2026-08-06T10:05:00.000Z", closedAt: null,
        messages: [{
          id: "message_1", sequence: 1, actorType: "agent", actorId: "agent_1",
          commandId: "command_1", body: "Confirm the requirement", answers: {},
          createdAt: "2026-08-06T10:05:00.000Z",
        }],
        decision: null,
      }],
      capabilities: { canReply: true, canConfirm: true, canDecideApproval: false },
    }),
    ...overrides,
  };
}

describe("Desktop Loop detail projection", () => {
  it("returns selected-Space runtime detail with secret-free attempt summaries", async () => {
    const result = await readDesktopLoopDetail(
      new Request("http://localhost/api/desktop/agents/loops/loop_1?space=company:company_1"),
      "loop_1",
      dependencies(),
    );

    expect(result.run).toMatchObject({ id: "loop_1", version: 4, currentIteration: 2 });
    expect(result.worker?.name).toBe("Mac Studio");
    expect(result.agentRunId).toBe("agent_run_1");
    expect(result.interaction?.id).toBe("interaction_1");
    expect(JSON.stringify(result.nodes[0]?.attempts[0])).toContain("Ready");
    expect(JSON.stringify(result.nodes[0]?.attempts[0])).not.toMatch(/must-not-leak|rm -rf|accessToken|command/u);
  });

  it("conceals a Loop from another selected Space before reading its projection", async () => {
    const deps = dependencies({
      loadLoopScope: vi.fn().mockResolvedValue({ ...scope, spaceId: "space_other" }),
    });

    await expect(readDesktopLoopDetail(
      new Request("http://localhost/api/desktop/agents/loops/loop_1?space=company:company_1"),
      "loop_1",
      deps,
    )).rejects.toThrow("Loop not found");
    expect(deps.readLoopRunProjection).not.toHaveBeenCalled();
  });

  it("keeps run and node detail available when timeline and interactions fail", async () => {
    const result = await readDesktopLoopDetail(
      new Request("http://localhost/api/desktop/agents/loops/loop_1?space=company:company_1"),
      "loop_1",
      dependencies({
        readWorkflowTimeline: vi.fn().mockRejectedValue(new Error("timeline unavailable")),
        readAuthorizedLoopRunInteractions: vi.fn().mockRejectedValue(new Error("interaction unavailable")),
      }),
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.timeline).toEqual([]);
    expect(result.interaction).toBeNull();
    expect(result.capabilities).toEqual({ canReply: false, canConfirm: false, canDecideApproval: false });
  });

  it("reuses validated route audit activities in the Desktop timeline", async () => {
    const routeDecision = {
      decisionId: "decision_1", sourceNodeId: "develop", targetNodeId: "test",
      reasonCode: "READY_FOR_TEST", summary: "进入测试节点", confidence: 0.94,
      evidence: ["artifacts/test-plan.md"], routerContractVersion: 1,
      routerContractDigest: "digest_1", selectedEdgeId: "edge_done", errorSummary: null,
    };
    const result = await readDesktopLoopDetail(
      new Request("http://localhost/api/desktop/agents/loops/loop_1?space=company:company_1"),
      "loop_1",
      dependencies({
        readLoopRunProjection: vi.fn().mockResolvedValue({
          ...projection,
          activities: [{
            id: "route_event_1", cursor: 2, eventType: "loop.agent.route_decided",
            occurredAt: "2026-08-06T10:06:00.000Z", nodeKey: "develop",
            edgeId: "edge_done", summary: "Develop 已作出路由决策：READY_FOR_TEST", routeDecision,
          }],
        }),
      }),
    );

    expect(result.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "route_event_1", routeDecision }),
    ]));
  });
});
