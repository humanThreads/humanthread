import { describe, expect, it } from "vitest";

import { agentLoopDetailQueryKey, buildAgentSearch, parseAgentQuery } from "./agent-queries";

const context = {
  deploymentUrl: "https://humanthread.test",
  deploymentKey: "https://humanthread.test",
  sessionId: "session_1",
  spaceKey: "company:company_1",
} as const;

describe("Desktop Agent Loop query state", () => {
  it("isolates detail cache keys by context and Loop Run", () => {
    expect(agentLoopDetailQueryKey(context, "loop_1")).not.toEqual(
      agentLoopDetailQueryKey({ ...context, spaceKey: "personal" }, "loop_1"),
    );
    expect(agentLoopDetailQueryKey(context, "loop_1")).not.toEqual(
      agentLoopDetailQueryKey(context, "loop_2"),
    );
  });

  it("keeps selected Loop in URL state and infers the Loop view", () => {
    const query = parseAgentQuery(new URLSearchParams("loop=loop_1"));
    expect(query).toMatchObject({ view: "loops", loopId: "loop_1" });
    expect(buildAgentSearch(query).toString()).toContain("loop=loop_1");
  });

  it("keeps the selected Loop detail panel in URL state", () => {
    const query = parseAgentQuery(new URLSearchParams("loop=loop_1&panel=logs"));

    expect(query).toMatchObject({ view: "loops", loopId: "loop_1", loopPanel: "logs" });
    expect(buildAgentSearch(query).toString()).toContain("panel=logs");
  });

  it("keeps the selected local terminal session in URL state", () => {
    const query = parseAgentQuery(new URLSearchParams("view=terminals&session=session_1"));

    expect(query).toEqual({ view: "terminals", sessionId: "session_1" });
    expect(buildAgentSearch(query).toString()).toBe("view=terminals&session=session_1");
  });
});
