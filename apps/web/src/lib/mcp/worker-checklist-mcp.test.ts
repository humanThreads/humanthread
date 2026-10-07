import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerChecklistMcpServer } from "./worker-checklist-mcp";

const closes: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closes.splice(0).map((close) => close()));
});

async function connect(dependencies: Parameters<typeof createWorkerChecklistMcpServer>[0]["dependencies"]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWorkerChecklistMcpServer({
    agentRunId: "agent_run_1",
    poolId: "a".repeat(32),
    sessionId: "session_1",
    dependencies,
  });
  const client = new Client({ name: "worker-checklist-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closes.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("Worker checklist MCP", () => {
  it("exposes only lease-bound checklist tools and injects identity server-side", async () => {
    const writeChecklist = vi.fn().mockResolvedValue({ acceptedThroughSequence: 4 });
    const client = await connect({ writeChecklist });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "create_runtime_checklist",
      "update_runtime_checklist",
      "request_workflow_intervention",
      "get_workflow_intervention",
    ]);
    expect(listed.tools[0]?.inputSchema.properties).not.toHaveProperty("loopRunId");
    // The intervention tool must not accept a caller supplied identity either.
    expect(listed.tools[2]?.inputSchema.properties).not.toHaveProperty("loopNodeAttemptId");

    const result = await client.callTool({
      name: "create_runtime_checklist",
      arguments: {
        checklist: [{ id: "inspect", title: "Inspect repository", status: "not_started", evidenceRefs: [] }],
      },
    });

    expect(result.structuredContent).toMatchObject({ acceptedThroughSequence: 4 });
    expect(writeChecklist).toHaveBeenCalledWith({
      agentRunId: "agent_run_1",
      poolId: "a".repeat(32),
      sessionId: "session_1",
      operation: "create",
      payload: { checklist: [{ id: "inspect", title: "Inspect repository", status: "not_started", evidenceRefs: [] }] },
    });
  });

  it("supports MCP resource discovery for the execution protocol", async () => {
    const client = await connect({ writeChecklist: vi.fn() });

    const resources = await client.listResources();

    expect(resources.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ uri: "humanthread://worker-checklist/protocol" }),
    ]));
  });

  it("rejects caller supplied lease identity and validates failure reasons", async () => {
    const writeChecklist = vi.fn();
    const client = await connect({ writeChecklist });

    const spoofed = await client.callTool({
      name: "update_runtime_checklist",
      arguments: { itemId: "inspect", status: "failed", loopRunId: "spoofed" },
    });
    expect(spoofed.isError).toBe(true);
    const missingReason = await client.callTool({
      name: "update_runtime_checklist",
      arguments: { itemId: "inspect", status: "failed" },
    });
    expect(missingReason.isError).toBe(true);
    expect(writeChecklist).not.toHaveBeenCalled();
  });

  it("lets the executing agent open a human intervention bound to its own attempt", async () => {
    const writeChecklist = vi.fn();
    const requestIntervention = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      status: "open",
      loopRunId: "loop_run_1",
    });
    const client = await connect({ writeChecklist, requestIntervention });

    const result = await client.callTool({
      name: "request_workflow_intervention",
      arguments: {
        commandId: "cmd_1",
        reason: "CH-019 draft is missing; the plan is still awaiting confirmation.",
      },
    });

    expect(result.isError).toBeFalsy();
    // Identity is injected from the authenticated lease, never from the caller.
    expect(requestIntervention).toHaveBeenCalledWith({
      agentRunId: "agent_run_1",
      poolId: "a".repeat(32),
      sessionId: "session_1",
      commandId: "cmd_1",
      reason: "CH-019 draft is missing; the plan is still awaiting confirmation.",
    });
  });

  it("reads the human decision back so a resumed stage does not re-ask", async () => {
    const readIntervention = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      status: "confirmed",
      decision: { decision: "confirmed", reason: "plan approved", selectedEdgeId: null },
      messages: [{ sequence: 2, actorType: "user", body: "plan approved", structuredAnswers: {} }],
    });
    const client = await connect({ writeChecklist: vi.fn(), readIntervention });

    const result = await client.callTool({
      name: "get_workflow_intervention",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    expect(readIntervention).toHaveBeenCalledWith({
      agentRunId: "agent_run_1",
      poolId: "a".repeat(32),
      sessionId: "session_1",
    });
    expect(result.structuredContent).toMatchObject({ status: "confirmed" });
  });

  it("ignores a caller supplied loop identity when opening an intervention", async () => {
    const requestIntervention = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      status: "open",
      loopRunId: "loop_run_1",
    });
    const client = await connect({ writeChecklist: vi.fn(), requestIntervention });

    const result = await client.callTool({
      name: "request_workflow_intervention",
      arguments: {
        commandId: "cmd_1",
        reason: "needs a human",
        loopNodeAttemptId: "spoofed",
      },
    });

    expect(result.isError).toBeFalsy();
    // The caller cannot redirect the intervention to another Attempt: only the
    // lease-bound identity reaches the platform.
    expect(requestIntervention).toHaveBeenCalledWith({
      agentRunId: "agent_run_1",
      poolId: "a".repeat(32),
      sessionId: "session_1",
      commandId: "cmd_1",
      reason: "needs a human",
    });
  });

  it("passes Agent-supplied review pages through to the intervention", async () => {
    const requestIntervention = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      status: "open",
      loopRunId: "loop_run_1",
    });
    const client = await connect({ writeChecklist: vi.fn(), requestIntervention });

    const result = await client.callTool({
      name: "request_workflow_intervention",
      arguments: {
        commandId: "cmd_1",
        reason: "请确认第十九至二十一章的规划",
        pages: [{
          fileName: "TASK-1001-chapter-plan.html",
          html: "<!doctype html><title>chapter plan</title>",
        }],
      },
    });

    expect(result.isError).toBeFalsy();
    // The human must be able to read the page the Agent rendered, so the page
    // travels with the intervention rather than being described in prose.
    expect(requestIntervention).toHaveBeenCalledWith({
      agentRunId: "agent_run_1",
      poolId: "a".repeat(32),
      sessionId: "session_1",
      commandId: "cmd_1",
      reason: "请确认第十九至二十一章的规划",
      pages: [{
        fileName: "TASK-1001-chapter-plan.html",
        html: "<!doctype html><title>chapter plan</title>",
      }],
    });
  });
});
