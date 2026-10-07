import { describe, expect, it, vi } from "vitest";

import { createLoopAssignmentApi, type LoopAssignmentApiFetch } from "./loop-assignment-api";

const credentials = {
  apiBaseUrl: "http://localhost:3000/",
  userId: "user_1",
  deviceId: "device_1",
  deviceToken: "device_token",
  apiToken: "api_token",
  workerId: "local-device:device_1",
  agentVersion: "Agent v0.1.3 · e16bff4c",
};

describe("Loop assignment API", () => {
  it("claims with runtime credentials and unwraps the assignment response", async () => {
    const fetch = vi.fn<LoopAssignmentApiFetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { assignment: null, leaseGeneration: null, leaseExpiresAt: null },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await expect(api.claim({
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "files", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    })).resolves.toEqual({ assignment: null, leaseGeneration: null, leaseExpiresAt: null });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/agent/loop-assignments/claim",
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer api_token",
          "content-type": "application/json",
          "x-agent-device-token": "device_token",
        },
      }),
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      userId: "user_1",
      deviceId: "device_1",
      workerId: "local-device:device_1",
      agentVersion: "Agent v0.1.3 · e16bff4c",
    });
  });

  it("sends heartbeat-only assignment acceptance state", async () => {
    const fetch = vi.fn<LoopAssignmentApiFetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { assignment: null, leaseGeneration: null, leaseExpiresAt: null },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await api.claim({
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      activeAgentRunIds: ["agent_run_1"],
      acceptAssignments: false,
    });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      activeAgentRunIds: ["agent_run_1"],
      acceptAssignments: false,
    });
  });

  it("falls back to the legacy claim payload when the server rejects heartbeat-only claims", async () => {
    const fetch = vi.fn<LoopAssignmentApiFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: false,
        code: "validation_failed",
        error: "Unrecognized key: acceptAssignments",
      }), { status: 400, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: { assignment: null, leaseGeneration: null, leaseExpiresAt: null },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await expect(api.claim({
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      activeAgentRunIds: ["agent_run_1"],
      acceptAssignments: false,
    })).resolves.toMatchObject({ assignment: null });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      activeAgentRunIds: ["agent_run_1"],
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).not.toHaveProperty("acceptAssignments");
  });

  it("preserves the platform error code for stale lease handling", async () => {
    const fetch = vi.fn<LoopAssignmentApiFetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      code: "stale_lease",
      error: "Stale or expired graph assignment lease",
    }), { status: 409, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await expect(api.heartbeat({
      agentRunId: "agent_run_1",
      leaseGeneration: 7,
      commandId: "heartbeat:attempt_1:1",
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    })).rejects.toMatchObject({ code: "stale_lease", status: 409 });
  });

  it("rejects a malformed claimed assignment at the local trust boundary", async () => {
    const fetch = vi.fn<LoopAssignmentApiFetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        assignment: { id: "assignment_1", workspace: { rootPath: "/tmp" } },
        leaseGeneration: 7,
        leaseExpiresAt: "2026-07-30T12:03:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await expect(api.claim({
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    })).rejects.toThrow();
  });

  it("accepts an explicitly negotiated v2 assignment without weakening v1 validation", async () => {
    const graph = {
      schemaVersion: 1,
      inputSchema: {},
      outputSchema: {},
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [
        { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", promptTemplate: "Develop" },
        { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
      ],
      edges: [{ id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" }],
    } as const;
    const assignment = {
      id: "assignment_v2",
      agentRunId: "agent_run_v2",
      loopRunId: "loop_run_v2",
      loopNodeRunId: "node_run_v2",
      loopNodeAttemptId: "attempt_v2",
      attemptNo: 1,
      leaseGeneration: 7,
      leaseExpiresAt: "2026-07-30T12:03:00.000Z",
      acceptedThroughSequence: 0,
      node: graph.nodes[0],
      graph,
      inputSnapshot: {},
      policySnapshot: {},
      grantSnapshot: {},
      runtime: { agentProfileId: "profile_codex", provider: "codex", runtimeProfileId: "runtime_1", configurationVersion: 1 },
      workspace: { bindingId: "workspace_1", configurationVersion: 1, pathFingerprint: "hmac-sha256:abcdef" },
      prompt: "Develop",
      resultSchemaPath: ".humanthread/results/attempt_v2.schema.json",
      contractVersion: 2,
      runGraphSnapshot: {
        schemaVersion: 2,
        snapshotId: "snapshot_v2",
        graphDigest: `sha256:${"a".repeat(64)}`,
        rootLoopVersionId: "version_task",
        loopVersions: [{
          loopDefinitionId: "loop_task",
          loopVersionId: "version_task",
          scope: "task",
          graph: {
            schemaVersion: 2,
            limits: graph.limits,
            nodes: [
              { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement the task", allowedRouteTargets: ["end"] },
              graph.nodes[1],
            ],
            edges: graph.edges,
          },
        }],
        reachableNodeIds: ["develop", "end"],
      },
      routerContract: { version: 1, digest: `sha256:${"b".repeat(64)}` },
      offlineContinuation: null,
    };
    const fetch = vi.fn<LoopAssignmentApiFetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { assignment, leaseGeneration: 7, leaseExpiresAt: assignment.leaseExpiresAt },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await expect(api.claim({
      capabilitySnapshot: { providers: [{ name: "codex", version: "0.145.0" }], capabilities: ["workspace"], loginStateCategories: [], maxConcurrency: 1 },
    })).resolves.toMatchObject({ assignment: { contractVersion: 2, id: "assignment_v2" } });
  });

  it("posts assignment events to the leased AgentRun resource", async () => {
    const fetch = vi.fn<LoopAssignmentApiFetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { acceptedThroughSequence: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await api.events({
      agentRunId: "agent_run_1",
      leaseGeneration: 7,
      commandId: "events:attempt_1:4",
      loopNodeAttemptId: "attempt_1",
      events: [{
        eventId: "event_4",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 7,
        sequence: 4,
        eventType: "agent.message.completed",
        occurredAt: "2026-07-30T12:00:00.000Z",
        payloadSummary: { text: "done" },
        artifactRefs: [],
      }],
    });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://localhost:3000/api/agent/loop-assignments/agent_run_1/events",
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).not.toHaveProperty("agentVersion");
  });

  it("posts a local route decision to the existing assignment result resource", async () => {
    const fetch = vi.fn<LoopAssignmentApiFetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { accepted: true },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await api.routeDecision!({
      agentRunId: "agent_run_1", leaseGeneration: 7, commandId: "route_1",
      loopRunId: "loop_run_1", loopNodeRunId: "node_run_1", loopNodeAttemptId: "attempt_1", attemptNo: 1,
      routeDecision: {
        decisionId: "decision_1", fromNodeId: "test", nextNodeId: "develop", reasonCode: "REWORK",
        summary: "Return to development", evidence: [], confidence: 0.9,
        snapshotDigest: `sha256:${"a".repeat(64)}`, routerContractVersion: 1, routerContractDigest: `sha256:${"b".repeat(64)}`,
      },
    });

    expect(fetch.mock.calls[0]?.[0]).toBe("http://localhost:3000/api/agent/loop-assignments/agent_run_1/result");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      commandId: "route_1",
      routeDecision: { decisionId: "decision_1", nextNodeId: "develop" },
    });
  });

  it("uploads a review HTML Artifact through the leased AgentRun resource", async () => {
    const fetch = vi.fn<LoopAssignmentApiFetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        artifactId: "a".repeat(32),
        storageKey: `loop-review-artifacts/${"b".repeat(32)}/${"a".repeat(32)}.html`,
        fileName: "chapter-plan.html",
        mimeType: "text/html",
        byteSize: 42,
        checksum: "c".repeat(64),
        relativePath: "generated/reviews/chapter-plan.html",
        href: `/api/loop-artifacts/${"a".repeat(32)}`,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createLoopAssignmentApi(credentials, { fetch });

    await expect(api.uploadArtifact!({
      agentRunId: "agent_run_1",
      leaseGeneration: 7,
      commandId: "artifact_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      relativePath: "generated/reviews/chapter-plan.html",
      content: "<html>review</html>",
    })).resolves.toMatchObject({ artifactId: "a".repeat(32) });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://localhost:3000/api/agent/loop-assignments/agent_run_1/artifacts",
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      relativePath: "generated/reviews/chapter-plan.html",
      content: "<html>review</html>",
    });
  });
});
