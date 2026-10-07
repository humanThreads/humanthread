import type { AgentWorkerCapabilitySnapshot, LoopAssignment, LoopAssignmentV2, LoopNodeResult } from "@humanthread/shared";
import { describe, expect, it, vi } from "vitest";

import type { LoopOutbox, LoopOutboxRecord } from "./loop-outbox";
import type { AgentProviderAdapter, NormalizedRunEvent } from "./providers/provider-adapter";
import {
  flushAssignmentOutbox,
  runLoopAssignment,
  startLoopWorker,
  type LoopAssignmentApi,
} from "./loop-assignment-runner";
import { DECISION_ROUTER_CONTRACT_DIGEST, DECISION_ROUTER_OUTPUT_SCHEMA } from "./decision-router-contract";

const assignment: LoopAssignment = {
  id: "assignment_1",
  agentRunId: "agent_run_1",
  loopRunId: "loop_run_1",
  loopNodeRunId: "node_run_1",
  loopNodeAttemptId: "attempt_1",
  attemptNo: 1,
  leaseGeneration: 7,
  leaseExpiresAt: "2026-07-30T12:03:00.000Z",
  acceptedThroughSequence: 2,
  node: {
    key: "implement",
    label: "Implement",
    type: "agent_action",
    offlinePolicy: "online_required",
    executionTarget: "local",
    promptTemplate: "Implement the requested change",
    outputSchema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  graph: {
    schemaVersion: 1,
    inputSchema: {},
    outputSchema: {},
    limits: { maxStages: 4, maxRepeatCount: 2 },
    nodes: [
      { key: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
      {
        key: "implement",
        label: "Implement",
        type: "agent_action",
        offlinePolicy: "online_required",
        executionTarget: "local",
        promptTemplate: "Implement the requested change",
        outputSchema: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
      },
      { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
    ],
    edges: [
      { id: "start-work", source: "start", target: "implement", kind: "normal", outcome: "success" },
      { id: "work-end", source: "implement", target: "end", kind: "normal", outcome: "success" },
    ],
  },
  inputSnapshot: { task: "Implement" },
  policySnapshot: {},
  grantSnapshot: { permission: "workspace_full", networkTargets: [] },
  runtime: { agentProfileId: "profile_codex", provider: "codex", runtimeProfileId: "runtime_1", configurationVersion: 1 },
  workspace: { bindingId: "workspace_1", configurationVersion: 1, pathFingerprint: "hmac-sha256:abcdef" },
  prompt: "Implement the requested change",
  resultSchemaPath: ".humanthread/loop/results/attempt_1.schema.json",
};

const wrappedWorkspaceGrant = {
  id: "grant_workspace",
  spaceId: "space_1",
  projectId: "project_1",
  bindingIds: ["binding_1"],
  nodeKeys: ["implement"],
  executionPlanes: ["local"],
  deviceIds: ["device_1"],
  workerIds: ["local-worker:device_1"],
  agentProfileIds: ["profile_codex"],
  providers: ["codex"],
  permission: "workspace_full",
  workspaceBindingIds: ["workspace_1"],
  allowedRelativePathPrefixes: ["."],
  tools: ["filesystem", "shell", "git"],
  commandCategories: ["build", "dependency_install", "git", "test"],
  operationTypes: ["workspace.write"],
  networkTargets: [],
  recipients: [],
  credentialRefs: [],
  allowProduction: false,
  limits: {
    maxConcurrency: 1,
    maxDurationMs: 3_600_000,
    maxTokens: 100_000,
    maxCostUsd: 20,
    maxToolCalls: 1_000,
  },
  policyVersion: "policy_v1",
  status: "active",
  confirmedAt: "2026-07-30T11:00:00.000Z",
  expiresAt: "2026-07-31T11:00:00.000Z",
  revokedAt: null,
  futurePlatformField: { compatible: true },
};

const truncatedWorkspaceGrant: Partial<typeof wrappedWorkspaceGrant> = {
  ...wrappedWorkspaceGrant,
};
delete truncatedWorkspaceGrant.spaceId;

const taskCommit = "a".repeat(40);
const verifyAndPushAssignment: LoopAssignment = {
  ...assignment,
  node: {
    key: "verify_and_push",
    label: "Verify and push task branch",
    type: "agent_action",
    offlinePolicy: "online_required",
    executionTarget: "local",
    promptTemplate: "Verify and push only the task branch",
  },
};

function validTaskDevelopmentResult() {
  return {
    report: {
      taskId: "task_1",
      branch: "2026-HT100023",
      commit: taskCommit,
      status: "passed",
      requirements: [{
        requirementId: "requirement_login",
        status: "passed",
        evidenceRefs: ["artifact_requirement_login"],
      }],
      checks: [{
        name: "unit-tests",
        status: "passed",
        evidenceRefs: ["artifact_unit_tests"],
      }],
    },
    knowledgeRefs: [{ path: "docs/knowledge/login.md", commit: taskCommit }],
    pushReceipt: {
      status: "succeeded",
      branch: "2026-HT100023",
      remoteHeadCommit: taskCommit,
    },
  };
}

function asyncEvents(events: NormalizedRunEvent[]): AsyncIterable<NormalizedRunEvent> {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

function createMemoryOutbox(initial: LoopOutboxRecord[] = []) {
  let records = [...initial];
  const outbox: LoopOutbox = {
    enqueue: vi.fn(async (record) => { records.push(record); }),
    list: vi.fn(async (limit) => records.slice(0, limit)),
    acknowledge: vi.fn(async (ids) => {
      const acknowledged = new Set(ids);
      records = records.filter(({ id }) => !acknowledged.has(id));
    }),
    capacity: vi.fn(async () => ({ canClaim: true, canAppendCritical: true, reason: null })),
  };
  return { outbox, records: () => records };
}

function createApi(): LoopAssignmentApi {
  return {
    claim: vi.fn().mockResolvedValue({ assignment: null, leaseGeneration: null, leaseExpiresAt: null }),
    heartbeat: vi.fn().mockResolvedValue({ leaseExpiresAt: "2026-07-30T12:04:00.000Z" }),
    events: vi.fn().mockResolvedValue({ acceptedThroughSequence: 99 }),
    checkpoint: vi.fn().mockResolvedValue({ checkpointed: true }),
    complete: vi.fn().mockResolvedValue({ completed: true }),
    uploadArtifact: vi.fn().mockResolvedValue({
      artifactId: "a".repeat(32),
      storageKey: `loop-review-artifacts/${"b".repeat(32)}/${"a".repeat(32)}.html`,
      fileName: "chapter-plan.html",
      mimeType: "text/html",
      byteSize: 42,
      checksum: "c".repeat(64),
      relativePath: "generated/reviews/chapter-plan.html",
      href: `/api/loop-artifacts/${"a".repeat(32)}`,
    }),
    routeDecision: vi.fn().mockResolvedValue({ accepted: true }),
    offlineStageResult: vi.fn().mockResolvedValue({ accepted: true }),
  };
}

function createProvider(events: NormalizedRunEvent[]): AgentProviderAdapter {
  return {
    capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
    executeStructured: vi.fn(() => asyncEvents(events)),
    start: vi.fn(() => asyncEvents(events)),
    resume: vi.fn(() => asyncEvents(events)),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Loop assignment runner", () => {
  it("passes the resolved local model tuple to the stage Provider", async () => {
    const provider = createProvider([{ type: "run.completed", result: { summary: "done" } }]);

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      resolveLocalModel: vi.fn().mockResolvedValue({
        model: "gpt-5.6-sol",
        reasoningEffort: "ultra",
        credentialContext: null,
      }),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-sol",
      reasoningEffort: "ultra",
      credentialContext: null,
    }));
  });

  it("uploads an Agent-generated review HTML and returns its platform reference", async () => {
    const api = createApi();
    const readStageArtifact = vi.fn().mockResolvedValue("<!doctype html><html><body>review</body></html>");
    const provider = createProvider([
      {
        type: "artifact.produced",
        payload: {
          type: "fileChange",
          changes: [{ path: "generated/reviews/chapter-plan.html", kind: "add" }],
        },
      },
      { type: "run.completed", result: { summary: "done" } },
    ]);

    await runLoopAssignment(assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      readStageArtifact,
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(readStageArtifact).toHaveBeenCalledWith({
      workspaceRealpath: "/Volumes/code/project",
      relativePath: "generated/reviews/chapter-plan.html",
    });
    expect(api.uploadArtifact).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "agent_run_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      relativePath: "generated/reviews/chapter-plan.html",
      content: "<!doctype html><html><body>review</body></html>",
    }));
    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        artifactRefs: [`loop-review-artifacts/${"b".repeat(32)}/${"a".repeat(32)}.html`],
      }),
    }));
  });

  it("projects the lease-bound checklist MCP only to Codex Stage execution", async () => {
    const provider = createProvider([{ type: "run.completed", result: { summary: "done" } }]);
    const checklistMcp = {
      url: "https://platform.example.com/api/agent/loop-assignments/agent_run_1/checklist-mcp",
      headers: { "x-agent-device-token": "device_token" },
    };

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      resolveChecklistMcp: vi.fn().mockResolvedValue(checklistMcp),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({ checklistMcp }));
  });

  it("reconciles sequence after MCP checklist writes before lifecycle output", async () => {
    const api = createApi();
    api.currentSequence = vi.fn().mockResolvedValue({ acceptedThroughSequence: 8 });
    const outbox = createMemoryOutbox();
    await runLoopAssignment(assignment, {
      api,
      outbox: outbox.outbox,
      provider: createProvider([{ type: "run.started" }, { type: "run.completed", result: { summary: "done" } }]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      resolveChecklistMcp: vi.fn().mockResolvedValue({ url: "https://platform.example.com/checklist", headers: { authorization: "Bearer token" } }),
      readCurrentSequence: vi.fn().mockImplementation(async () => (await api.currentSequence!({ agentRunId: assignment.agentRunId, leaseGeneration: assignment.leaseGeneration })).acceptedThroughSequence),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.currentSequence).toHaveBeenCalled();
    expect(api.events).toHaveBeenCalledWith(expect.objectContaining({
      events: expect.arrayContaining([expect.objectContaining({ sequence: 9 })]),
    }));
  });

  it("preserves a mobile-source Stage failure and adds a non-retryable envelope", async () => {
    const api = createApi();
    const failedAssignment: LoopAssignment = {
      ...assignment,
      node: {
        ...assignment.node,
        outputSchema: { type: "object" },
      },
    } as LoopAssignment;

    await runLoopAssignment(failedAssignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([{ type: "run.completed", result: {
        status: "FAILED",
        issueType: "MOBILE_SOURCE_UNAVAILABLE",
        summary: "No mobile checkout is configured",
        evidence: ["environment/mobile-source"],
        checkpoint: null,
      } }]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
      now: () => new Date("2026-08-15T08:00:00.000Z"),
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: {
        outcome: "failure",
        output: {
          status: "FAILED",
          issueType: "MOBILE_SOURCE_UNAVAILABLE",
          summary: "No mobile checkout is configured",
          evidence: ["environment/mobile-source"],
          checkpoint: null,
        },
        artifactRefs: [],
        effectReceipts: [],
        failure: expect.objectContaining({
          status: "FAILED",
          code: "MOBILE_SOURCE_UNAVAILABLE",
          categoryHint: "dependency_unavailable",
          summary: "No mobile checkout is configured",
          retryHint: { recommended: false, reason: expect.any(String) },
          occurredAt: "2026-08-15T08:00:00.000Z",
          evidence: [expect.objectContaining({
            kind: "environment",
            reference: expect.stringMatching(/^environment\/[0-9a-f]{32}$/u),
            digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          })],
        }),
      },
    }));
  });

  it("starts the lease heartbeat before resolving the workspace and local Stage", async () => {
    let releaseWorkspace!: () => void;
    const workspaceReady = new Promise<string>((resolve) => {
      releaseWorkspace = () => resolve("/Volumes/code/project");
    });
    const startHeartbeat = vi.fn(() => () => undefined);
    const run = runLoopAssignment(assignment, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([{ type: "run.completed", result: { summary: "done" } }]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn(() => workspaceReady),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat,
    });

    await vi.waitFor(() => expect(startHeartbeat).toHaveBeenCalledWith(expect.any(Function), 10_000));
    releaseWorkspace();
    await run;
  });

  it("normalizes a Provider stream that ends without a terminal result", async () => {
    const api = createApi();
    const v2Assignment = {
      ...assignment,
      contractVersion: 2,
      runGraphSnapshot: {
        schemaVersion: 2,
        snapshotId: "snapshot_protocol_error",
        graphDigest: `sha256:${"d".repeat(64)}`,
        rootLoopVersionId: "version_1",
        loopVersions: [],
        reachableNodeIds: ["implement"],
      },
      routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
      offlineContinuation: null,
    } as unknown as LoopAssignmentV2;

    await runLoopAssignment(v2Assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-08-15T08:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task",
          subloopId: "implement",
          stagePath: ".humanthread/loops/task/subloops/implement",
          configured: true,
          businessGoal: "Implement the task",
          inputScope: { codeAccess: true, writeAccess: true, include: ["src/**"], exclude: [], allowedCommands: [], blockedPaths: [] },
          resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
          checklist: [],
          qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
          agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
          skillSelection: { schemaVersion: 1, mode: "none" },
          outputSchema: { type: "object" },
          fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: {
          main: { prompt: "Implement", rules: [], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"b".repeat(64)}` },
        },
      }),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: { errorCode: "provider_protocol_error", message: "Provider stream ended without a terminal result" },
        failure: expect.objectContaining({
          status: "FAILED",
          code: "provider_protocol_error",
          categoryHint: "transient_technical",
          retryHint: expect.objectContaining({ recommended: true }),
        }),
      }),
    }));
  });

  it("reports a structured terminal failure when initialization fails", async () => {
    const api = createApi();
    const error = Object.assign(
      new Error("Stage synchronization failed at /Users/alice/private-project token=super-secret"),
      { code: "loop_catalog_error" },
    );

    await runLoopAssignment(assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockRejectedValue(error),
      writeResultSchema: vi.fn(),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "result:attempt_1",
      result: expect.objectContaining({
        outcome: "failure",
        output: {
          errorCode: "loop_catalog_error",
          message: "Stage synchronization failed at [local path] token=[redacted]",
          stage: "implement",
        },
        failure: expect.objectContaining({
          status: "FAILED",
          code: "loop_catalog_error",
          categoryHint: "unknown",
          retryHint: expect.objectContaining({ recommended: false }),
        }),
      }),
    }));
    expect(JSON.stringify(vi.mocked(api.complete).mock.calls)).not.toContain("/Users/alice");
    expect(JSON.stringify(vi.mocked(api.complete).mock.calls)).not.toContain("super-secret");
  });

  it("preserves serialized initialization errors instead of replacing them with a generic message", async () => {
    const api = createApi();

    await expect(runLoopAssignment(assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockRejectedValue({
        code: "loop_catalog_sync_failed",
        message: "Workspace marker is stale",
      }),
      writeResultSchema: vi.fn(),
      startHeartbeat: () => () => undefined,
    })).rejects.toMatchObject({ code: "loop_catalog_sync_failed" });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        output: {
          errorCode: "loop_catalog_sync_failed",
          message: "Workspace marker is stale",
          stage: "implement",
        },
      }),
    }));
  });

  it("submits a terminal failure when a v2 Provider throws after initialization", async () => {
    const api = createApi();
    const provider = createProvider([]);
    provider.executeStructured = vi.fn(() => {
      throw Object.assign(
        new Error("Provider launch failed at /Users/alice/private-project token=super-secret"),
        { code: "provider_launch_failed" },
      );
    });
    const v2Assignment = {
      ...assignment,
      contractVersion: 2,
      runGraphSnapshot: {
        schemaVersion: 2,
        snapshotId: "snapshot_runtime_failure",
        graphDigest: `sha256:${"d".repeat(64)}`,
        rootLoopVersionId: "version_1",
        loopVersions: [],
        reachableNodeIds: ["implement"],
      },
      routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
      offlineContinuation: null,
    } as unknown as LoopAssignmentV2;

    await expect(runLoopAssignment(v2Assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-08-14T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task",
          subloopId: "implement",
          stagePath: ".humanthread/loops/task/subloops/implement",
          configured: true,
          businessGoal: "Implement the task",
          inputScope: {
            codeAccess: true,
            writeAccess: true,
            include: ["src/**"],
            exclude: [],
            allowedCommands: [],
            blockedPaths: [".env"],
          },
          resourceScope: {
            prompts: true,
            resources: true,
            rules: true,
            schemas: true,
            skills: true,
            templates: true,
          },
          checklist: [],
          qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
          agents: {
            schemaVersion: 1,
            executionMode: "SINGLE_WRITER",
            execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }],
          },
          skillSelection: { schemaVersion: 1, mode: "none" },
          outputSchema: {},
          fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: {
          main: {
            prompt: "Implement",
            rules: [],
            resources: [],
            schemas: [],
            templates: [],
            skills: [],
            fingerprint: `sha256:${"b".repeat(64)}`,
          },
        },
      }),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    })).resolves.toBeUndefined();

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "result:attempt_1",
      result: expect.objectContaining({
        outcome: "failure",
        output: {
          errorCode: "provider_launch_failed",
          message: "Provider launch failed at [local path] token=[redacted]",
          stage: "loop_task/implement",
        },
      }),
    }));
    expect(JSON.stringify(vi.mocked(api.complete).mock.calls)).not.toContain("/Users/alice");
    expect(JSON.stringify(vi.mocked(api.complete).mock.calls)).not.toContain("super-secret");
  });

  it("executes a v2 Stage sequentially and gates results before completing", async () => {
    const api = createApi();
    const provider = createProvider([]);
    const projectStructuredOutputSchema = vi.fn((schema: unknown) => schema);
    provider.projectStructuredOutputSchema = projectStructuredOutputSchema;
    const executeStructured = vi.mocked(provider.executeStructured)
      .mockReturnValueOnce(asyncEvents([
        { type: "run.started", providerSessionId: "thread_v2" },
        { type: "checkpoint.created", payload: { branch: "2026-HT100013", commit: "a".repeat(40), token: "super-secret" } },
        { type: "run.completed", result: {
          execId: "main", status: "SUCCESS", issueType: "NONE", summary: "Implemented", confidence: 0.95,
          evidence: ["artifacts/report.json"], artifacts: ["artifacts/report.json"], checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40) },
        } },
      ]))
      .mockReturnValueOnce(asyncEvents([{ type: "run.completed", result: {
        execId: "review", status: "SUCCESS", issueType: "NONE", summary: "Reviewed", confidence: 0.9,
        evidence: ["artifacts/report.json"], artifacts: [], checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40) },
      } }]))
      .mockReturnValueOnce(asyncEvents([{ type: "run.completed", result: {
        decisionId: "decision_v2", fromNodeId: "implement", nextNodeId: "end",
        reasonCode: "STAGE_SUCCEEDED", summary: "Stage completed", evidence: ["artifacts/report.json"], confidence: 0.95,
        snapshotDigest: `sha256:${"d".repeat(64)}`, routerContractVersion: 1, routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
      } }]));
    const outputSchema = {
      type: "object",
      required: ["execId", "status", "issueType", "summary", "confidence", "evidence", "artifacts", "checkpoint"],
      properties: {
        execId: { type: "string" }, status: { type: "string" }, issueType: { type: "string" }, summary: { type: "string" },
        confidence: { type: "number" }, evidence: { type: "array", items: { type: "string" } }, artifacts: { type: "array", items: { type: "string" } }, checkpoint: { type: ["object", "null"] },
      },
    };
    const v2Assignment = {
      ...assignment,
      contractVersion: 2,
      runGraphSnapshot: {
        schemaVersion: 2, snapshotId: "snapshot_1", graphDigest: `sha256:${"d".repeat(64)}`, rootLoopVersionId: "version_1",
        loopVersions: [{
          loopDefinitionId: "loop_task", loopVersionId: "version_1", scope: "task",
          graph: {
            schemaVersion: 2, limits: { maxStages: 4, maxRepeatCount: 2 },
            nodes: [
              { key: "implement", nodeId: "implement", label: "Implement", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement the task", allowedRouteTargets: ["end"] },
              { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
            ],
            edges: [{ id: "implement-end", source: "implement", target: "end", kind: "normal", outcome: "success" }],
          },
        }],
        reachableNodeIds: ["implement", "end"],
      },
      routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
      offlineContinuation: null,
    } as unknown as LoopAssignmentV2;

    await runLoopAssignment(v2Assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: { providers: [{ name: "codex", version: "0.145.0" }], capabilities: ["workspace", "commands"], loginStateCategories: [], maxConcurrency: 1 },
      now: () => new Date("2026-08-07T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue({
        workspaceRealpath: "/Volumes/code/project/.worktrees/2026-HT100013",
        branch: "2026-HT100013",
        headCommit: "a".repeat(40),
        clean: false,
        isWorktree: true,
      }),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task", subloopId: "implement", stagePath: ".humanthread/loops/task/subloops/implement", configured: true,
          businessGoal: "Implement and review", inputScope: { codeAccess: true, writeAccess: true, include: ["src/**"], exclude: [], allowedCommands: ["pnpm test"], blockedPaths: [".env"] },
          resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true }, checklist: [],
          qualityGate: { checks: ["pnpm test"], requiredArtifacts: ["artifacts/report.json"], minConfidence: 0.8 },
          agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [
            { execId: "main", role: "primary", resumePolicy: "CHECKPOINT" },
            { execId: "review", role: "reviewer", resumePolicy: "NEW_SESSION" },
          ] },
          skillSelection: { schemaVersion: 1, mode: "none" }, outputSchema, fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: {
          main: { prompt: "Implement", rules: [{ path: "rules/project.md", content: "private rule" }], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"b".repeat(64)}` },
          review: { prompt: "Review", rules: [{ path: "rules/project.md", content: "private rule" }], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"c".repeat(64)}` },
        },
      }),
      loadProjectConstraints: vi.fn().mockResolvedValue({ sources: [{ relativePath: "AGENTS.md", content: "private constraint" }], checks: [], fingerprint: `sha256:${"f".repeat(64)}` }),
      readStageArtifact: vi.fn().mockResolvedValue("{}"),
      runStageCheck: vi.fn().mockResolvedValue({ passed: true, summary: "passed" }),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(executeStructured.mock.calls.map(([input]) => input.prompt)).toEqual([
      expect.stringContaining("Implement"),
      expect.stringContaining("Review"),
      expect.stringContaining("immutable current-Loop candidate list"),
    ]);
    expect(executeStructured.mock.calls.map(([input]) => input.mode)).toEqual(["stage", "stage", "router"]);
    expect(projectStructuredOutputSchema).toHaveBeenNthCalledWith(1, outputSchema);
    expect(projectStructuredOutputSchema).toHaveBeenNthCalledWith(2, DECISION_ROUTER_OUTPUT_SCHEMA);
    expect(executeStructured.mock.calls[2]?.[0]?.executionPolicy).toEqual({ mode: "read_only", workspaceRealpath: "/Volumes/code/project/.worktrees/2026-HT100013" });
    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        outcome: "success",
        output: expect.objectContaining({
          schemaVersion: 2,
          stage: { loopId: "loop_task", subloopId: "implement" },
          executions: [
            expect.objectContaining({ execId: "main", gate: expect.objectContaining({ passed: true }) }),
            expect.objectContaining({ execId: "review", gate: expect.objectContaining({ passed: true }) }),
          ],
        }),
        artifactRefs: ["artifacts/report.json"],
      }),
    }));
    expect(api.routeDecision).toHaveBeenCalledWith(expect.objectContaining({
      routeDecision: expect.objectContaining({ decisionId: "decision_v2", nextNodeId: "end" }),
    }));
    expect(vi.mocked(api.complete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.routeDecision!).mock.invocationCallOrder[0]!,
    );
    expect(api.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        value: expect.objectContaining({
          stage: "loop_task/implement",
          globalConstraintFingerprint: `sha256:${"f".repeat(64)}`,
          workspace: {
            workspaceRealpath: "/Volumes/code/project/.worktrees/2026-HT100013",
            branch: "2026-HT100013",
            headCommit: "a".repeat(40),
            clean: false,
            isWorktree: true,
          },
        }),
      }),
    }));
    expect(api.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: {
        providerSessionId: "thread_v2",
        value: expect.objectContaining({
          stage: "loop_task/implement",
          execId: "main",
          checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40) },
        }),
      },
    }));
    const uploaded = JSON.stringify([vi.mocked(api.events).mock.calls, vi.mocked(api.checkpoint).mock.calls]);
    expect(uploaded).not.toContain("private rule");
    expect(uploaded).not.toContain("private constraint");
    expect(uploaded).not.toContain("super-secret");
  });

  it("preserves a failed Stage result when the DecisionRouter Provider is unavailable", async () => {
    const api = createApi();
    const provider = createProvider([]);
    const executeStructured = vi.mocked(provider.executeStructured)
      .mockReturnValueOnce(asyncEvents([{ type: "run.completed", result: {
        execId: "main",
        status: "NEEDS_CLARIFICATION",
        issueType: "WORKSPACE_BLOCKED",
        summary: "Task branch is blocked",
        confidence: 0.99,
        evidence: ["artifacts/prepare-task-branch/context.json"],
        artifacts: ["artifacts/prepare-task-branch/context.json"],
        checkpoint: null,
      } }]))
      .mockReturnValueOnce(asyncEvents([{
        type: "run.failed",
        errorCode: "provider_error",
        message: "unexpected status 502 Bad Gateway",
      }]));
    const outputSchema = {
      type: "object",
      required: ["execId", "status", "issueType", "summary", "confidence", "evidence", "artifacts", "checkpoint"],
      properties: {
        execId: { type: "string" },
        status: { type: "string" },
        issueType: { type: "string" },
        summary: { type: "string" },
        confidence: { type: "number" },
        evidence: { type: "array", items: { type: "string" } },
        artifacts: { type: "array", items: { type: "string" } },
        checkpoint: { type: ["object", "null"] },
      },
    };
    const v2Assignment = {
      ...assignment,
      contractVersion: 2,
      runGraphSnapshot: {
        schemaVersion: 2,
        snapshotId: "snapshot_failed_stage",
        graphDigest: `sha256:${"d".repeat(64)}`,
        rootLoopVersionId: "version_1",
        loopVersions: [{
          loopDefinitionId: "loop_task",
          loopVersionId: "version_1",
          scope: "task",
          graph: {
            schemaVersion: 2,
            limits: { maxStages: 4, maxRepeatCount: 2 },
            nodes: [
              { key: "implement", nodeId: "implement", label: "Implement", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement the task", allowedRouteTargets: ["end"] },
              { key: "end", nodeId: "end", label: "End", type: "end", offlinePolicy: "online_required" },
            ],
            edges: [{ id: "implement-end", source: "implement", target: "end", kind: "normal", outcome: "success" }],
          },
        }],
        reachableNodeIds: ["implement", "end"],
      },
      routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
      offlineContinuation: null,
    } as unknown as LoopAssignmentV2;

    await runLoopAssignment(v2Assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-08-14T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task",
          subloopId: "implement",
          stagePath: ".humanthread/loops/task/subloops/implement",
          configured: true,
          businessGoal: "Implement the task",
          inputScope: { codeAccess: true, writeAccess: true, include: ["src/**"], exclude: [], allowedCommands: [], blockedPaths: [".env"] },
          resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
          checklist: [],
          qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
          agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
          skillSelection: { schemaVersion: 1, mode: "none" },
          outputSchema,
          fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: {
          main: { prompt: "Implement", rules: [], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"b".repeat(64)}` },
        },
      }),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(executeStructured.mock.calls.map(([input]) => input.mode)).toEqual(["stage", "router"]);
    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: {
          execId: "main",
          status: "NEEDS_CLARIFICATION",
          issueType: "WORKSPACE_BLOCKED",
          summary: "Task branch is blocked",
          confidence: 0.99,
          evidence: ["artifacts/prepare-task-branch/context.json"],
          artifacts: ["artifacts/prepare-task-branch/context.json"],
          checkpoint: null,
        },
        artifactRefs: ["artifacts/prepare-task-branch/context.json"],
        effectReceipts: [],
        failure: expect.objectContaining({
          status: "NEEDS_CLARIFICATION",
          code: "WORKSPACE_BLOCKED",
          categoryHint: "requirement_unclear",
          retryHint: expect.objectContaining({ recommended: false }),
        }),
      }),
    }));
    expect(api.routeDecision).not.toHaveBeenCalled();
  });

  it("auto-recovers one declared environment failure and resumes the same Stage exec", async () => {
    const api = createApi();
    const provider = createProvider([]);
    const blocked = {
      execId: "main",
      status: "NEEDS_CLARIFICATION",
      issueType: "ENVIRONMENT_GENERATED_TYPES_MISSING",
      summary: "Generated workspace types are missing",
      confidence: 0.99,
      evidence: ["artifacts/develop/checkpoint.json"],
      artifacts: ["artifacts/develop/checkpoint.json"],
      checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40) },
    };
    const completed = { ...blocked, status: "SUCCESS", issueType: "NONE", summary: "Typecheck passed" };
    const executeStructured = vi.mocked(provider.executeStructured)
      .mockReturnValueOnce(asyncEvents([
        { type: "run.started", providerSessionId: "thread_recovery" },
        { type: "run.completed", result: blocked },
      ]))
      .mockReturnValueOnce(asyncEvents([{ type: "run.completed", result: completed }]))
      .mockReturnValueOnce(asyncEvents([{ type: "run.completed", result: {
        decisionId: "decision_recovered", fromNodeId: "implement", nextNodeId: "end",
        reasonCode: "STAGE_SUCCEEDED", summary: "Stage completed after environment recovery",
        evidence: ["artifacts/develop/checkpoint.json"], confidence: 0.95,
        snapshotDigest: `sha256:${"d".repeat(64)}`, routerContractVersion: 1,
        routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
      } }]));
    const runStageCheck = vi.fn().mockResolvedValue({ passed: true, summary: "passed" });
    const outputSchema = {
      type: "object",
      required: ["execId", "status", "issueType", "summary", "confidence", "evidence", "artifacts", "checkpoint"],
      properties: {
        execId: { type: "string" }, status: { type: "string" }, issueType: { type: "string" }, summary: { type: "string" },
        confidence: { type: "number" }, evidence: { type: "array", items: { type: "string" } },
        artifacts: { type: "array", items: { type: "string" } }, checkpoint: { type: ["object", "null"] },
      },
    };
    const v2Assignment = {
      ...assignment,
      contractVersion: 2,
      runGraphSnapshot: {
        schemaVersion: 2, snapshotId: "snapshot_recovery", graphDigest: `sha256:${"d".repeat(64)}`, rootLoopVersionId: "version_1",
        loopVersions: [{
          loopDefinitionId: "loop_task", loopVersionId: "version_1", scope: "task",
          graph: {
            schemaVersion: 2, limits: { maxStages: 4, maxRepeatCount: 2 },
            nodes: [
              { key: "implement", nodeId: "implement", label: "Implement", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement", allowedRouteTargets: ["end"] },
              { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
            ],
            edges: [{ id: "implement-end", source: "implement", target: "end", kind: "normal", outcome: "success" }],
          },
        }],
        reachableNodeIds: ["implement", "end"],
      },
      routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
      offlineContinuation: null,
    } as unknown as LoopAssignmentV2;

    await runLoopAssignment(v2Assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: { providers: [{ name: "codex", version: "0.145.0" }], capabilities: ["workspace", "commands"], loginStateCategories: [], maxConcurrency: 1 },
      now: () => new Date("2026-08-13T04:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task", subloopId: "implement", stagePath: ".humanthread/loops/task/subloops/implement", configured: true,
          businessGoal: "Implement", inputScope: { codeAccess: true, writeAccess: true, include: ["**/*"], exclude: [], allowedCommands: ["pnpm db:generate", "pnpm -r --sort build"], blockedPaths: [".env"] },
          resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true }, checklist: [],
          qualityGate: { checks: [], requiredArtifacts: ["artifacts/develop/checkpoint.json"], minConfidence: 0.8 },
          autoRecovery: { maxAttempts: 1, issueTypes: ["ENVIRONMENT_GENERATED_TYPES_MISSING"], commands: ["pnpm db:generate", "pnpm -r --sort build"] },
          agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
          skillSelection: { schemaVersion: 1, mode: "none" }, outputSchema, fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: { main: { prompt: "Continue the implementation checklist.", rules: [], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"b".repeat(64)}` } },
      }),
      readStageArtifact: vi.fn().mockResolvedValue("{}"),
      runStageCheck,
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(runStageCheck.mock.calls.map(([input]) => input.command)).toEqual([
      "pnpm db:generate",
      "pnpm -r --sort build",
    ]);
    expect(executeStructured).toHaveBeenNthCalledWith(2, expect.objectContaining({
      providerSessionId: "thread_recovery",
      prompt: expect.stringContaining("Resume from the failed validation only"),
    }));
    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outcome: "success" }),
    }));
  });

  it("uses the platform prompt and Schema for a v1 assignment without reading legacy local nodes", async () => {
    const provider = createProvider([{ type: "run.completed", result: { localSummary: "done" } }]);
    const writeResultSchema = vi.fn().mockResolvedValue("/Volumes/code/project/result.json");
    const loadLocalNodeContract = vi.fn().mockRejectedValue(new Error("legacy local nodes must not execute"));
    const dependencies: Parameters<typeof runLoopAssignment>[1] & {
      loadLocalNodeContract: typeof loadLocalNodeContract;
    } = {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalNodeContract,
      writeResultSchema,
      startHeartbeat: () => () => undefined,
    };

    await runLoopAssignment(assignment, dependencies);

    expect(loadLocalNodeContract).not.toHaveBeenCalled();
    expect(writeResultSchema).toHaveBeenCalledWith(expect.objectContaining({
      schema: expect.objectContaining({ required: ["summary"] }),
    }));
    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Implement the requested change"),
    }));
  });

  it("uses a configured project Stage package for a v1 assignment instead of an empty platform Schema", async () => {
    const provider = createProvider([{ type: "run.completed", result: { status: "SUCCESS", summary: "done" } }]);
    const writeResultSchema = vi.fn().mockResolvedValue("/Volumes/code/project/result.json");
    const localOutputSchema = {
      type: "object",
      required: ["status", "summary"],
      properties: {
        status: { const: "SUCCESS" },
        summary: { type: "string" },
      },
      additionalProperties: false,
    };

    await runLoopAssignment({
      ...assignment,
      node: {
        key: "implement",
        label: "Implement",
        type: "agent_action",
        offlinePolicy: "online_required",
        executionTarget: "local",
        promptTemplate: "Implement the requested change",
        outputSchema: {},
      },
    }, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task",
          subloopId: "implement",
          stagePath: ".humanthread/loops/task/subloops/implement",
          configured: true,
          businessGoal: "Implement the requested change",
          inputScope: { codeAccess: true, writeAccess: true, include: ["src/**"], exclude: [], allowedCommands: [], blockedPaths: [] },
          resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
          checklist: [],
          qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
          agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
          skillSelection: { schemaVersion: 1, mode: "none" },
          outputSchema: localOutputSchema,
          fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: {
          main: {
            prompt: "Apply the repository implementation rules.",
            rules: [{ path: "rules/project.md", content: "Use repository-owned rules." }],
            resources: [], schemas: [], templates: [], skills: [],
            fingerprint: `sha256:${"b".repeat(64)}`,
          },
        },
      }),
      writeResultSchema,
      startHeartbeat: () => () => undefined,
    });

    expect(writeResultSchema).toHaveBeenCalledWith(expect.objectContaining({ schema: localOutputSchema }));
    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Apply the repository implementation rules."),
    }));
  });

  it("delivers a claimed scheduled task snapshot to the provider prompt across reclaim", async () => {
    const immutableRunSnapshot = {
      id: "d".repeat(32),
      name: "Daily inspection",
      description: "Inspect the previous delivery.",
      contentMode: "platform",
      contentMarkdown: "# Checks\n- Inspect logs\n- Verify artifacts",
    };
    const currentScheduledTask = {
      name: "Changed after the run started",
      description: "Current edited configuration",
      contentMarkdown: "# Must not reach the old run",
    };
    let claimCount = 0;
    const capabilitySnapshot: AgentWorkerCapabilitySnapshot = {
      providers: [{ name: "codex", version: "0.145.0" }],
      capabilities: ["workspace", "commands"],
      loginStateCategories: [],
      maxConcurrency: 1,
    };
    const api = createApi();
    api.claim = vi.fn(async () => {
      claimCount += 1;
      return {
        assignment: {
          ...assignment,
          id: `assignment_${claimCount}`,
          leaseGeneration: 7 + claimCount,
          inputSnapshot: {
            scheduledTask: structuredClone(immutableRunSnapshot),
            currentScheduledTask: structuredClone(currentScheduledTask),
          },
        },
        leaseGeneration: 7 + claimCount,
        leaseExpiresAt: assignment.leaseExpiresAt,
      };
    });
    const outputSchema = {
      type: "object",
      required: ["status", "summary"],
      properties: {
        status: { const: "SUCCESS" },
        summary: { type: "string" },
      },
      additionalProperties: false,
    };
    const runProvider = async (claimed: LoopAssignment, provider: AgentProviderAdapter) => {
      await runLoopAssignment(claimed, {
        api: createApi(),
        outbox: createMemoryOutbox().outbox,
        provider,
        capabilitySnapshot,
        now: () => new Date("2026-07-30T12:00:00.000Z"),
        resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
        loadLocalStageContract: vi.fn().mockResolvedValue({
          stage: {
            loopId: "loop_task",
            subloopId: "implement",
            stagePath: ".humanthread/loops/project/subloops/implement",
            configured: true,
            businessGoal: "Complete the scheduled inspection.",
            inputScope: { codeAccess: true, writeAccess: false, include: ["**/*"], exclude: [], allowedCommands: [], blockedPaths: [".env"] },
            resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
            checklist: [],
            qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
            agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
            skillSelection: { schemaVersion: 1, mode: "none" },
            outputSchema,
            fingerprint: `sha256:${"a".repeat(64)}`,
          },
          resourcesByExecId: {
            main: { prompt: "Inspect the repository using the scheduled task context.", rules: [], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"b".repeat(64)}` },
          },
        }),
        writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
        startHeartbeat: () => () => undefined,
      });
    };

    const firstClaim = await api.claim({ capabilitySnapshot });
    const firstProvider = createProvider([{ type: "run.completed", result: { status: "SUCCESS", summary: "first" } }]);
    await runProvider(firstClaim.assignment as LoopAssignment, firstProvider);

    currentScheduledTask.contentMarkdown = "# Changed body";
    const secondClaim = await api.claim({ capabilitySnapshot });
    const secondProvider = createProvider([{ type: "run.completed", result: { status: "SUCCESS", summary: "second" } }]);
    await runProvider(secondClaim.assignment as LoopAssignment, secondProvider);

    const firstScheduledTask = (firstClaim.assignment?.inputSnapshot as { scheduledTask?: unknown } | undefined)?.scheduledTask;
    const secondScheduledTask = (secondClaim.assignment?.inputSnapshot as { scheduledTask?: unknown } | undefined)?.scheduledTask;
    expect(firstScheduledTask).toEqual(secondScheduledTask);
    const prompts = [firstProvider.start, secondProvider.start].map((start) => vi.mocked(start).mock.calls[0]?.[0]?.prompt ?? "");
    expect(prompts[0]).toContain("Scheduled task execution context:");
    expect(prompts[0]).toContain("# Checks\n- Inspect logs\n- Verify artifacts");
    expect(prompts[1]).toContain("# Checks\n- Inspect logs\n- Verify artifacts");
    expect(prompts.join("\n")).not.toContain(currentScheduledTask.name);
    expect(prompts.join("\n")).not.toContain(currentScheduledTask.contentMarkdown);
  });

  it("omits loop-managed scheduled task content from the provider prompt", async () => {
    const provider = createProvider([{ type: "run.completed", result: { status: "SUCCESS", summary: "done" } }]);
    const capabilitySnapshot: AgentWorkerCapabilitySnapshot = {
      providers: [{ name: "codex", version: "0.145.0" }],
      capabilities: ["workspace", "commands"],
      loginStateCategories: [],
      maxConcurrency: 1,
    };
    const outputSchema = {
      type: "object",
      required: ["status", "summary"],
      properties: {
        status: { const: "SUCCESS" },
        summary: { type: "string" },
      },
      additionalProperties: false,
    };

    await runLoopAssignment({
      ...assignment,
      inputSnapshot: {
        scheduledTask: {
          id: "d".repeat(32),
          name: "Project-managed inspection",
          description: "The Loop supplies its own content.",
          contentMode: "loop_managed",
          contentMarkdown: "# Must not reach the provider",
        },
      },
    }, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task",
          subloopId: "implement",
          stagePath: ".humanthread/loops/project/subloops/implement",
          configured: true,
          businessGoal: "Complete the scheduled inspection.",
          inputScope: { codeAccess: true, writeAccess: false, include: ["**/*"], exclude: [], allowedCommands: [], blockedPaths: [".env"] },
          resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
          checklist: [],
          qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
          agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
          skillSelection: { schemaVersion: 1, mode: "none" },
          outputSchema,
          fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: {
          main: { prompt: "Inspect the repository using the scheduled task context.", rules: [], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"b".repeat(64)}` },
        },
      }),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    const prompt = vi.mocked(provider.start).mock.calls[0]?.[0]?.prompt ?? "";
    expect(prompt).toContain("Scheduled task name: Project-managed inspection");
    expect(prompt).toContain("Scheduled task description: The Loop supplies its own content.");
    expect(prompt).not.toContain("# Must not reach the provider");
    expect(prompt).not.toContain("Scheduled task content:");
    expect(prompt).not.toContain("contentMarkdown");
  });

  it("writes the Provider projection while retaining the full local Schema", async () => {
    const provider = createProvider([{ type: "run.completed", result: { status: "SUCCESS", summary: "done", evidence: [] } }]);
    provider.projectStructuredOutputSchema = vi.fn(() => ({ type: "object", required: ["status", "summary", "evidence"] }));
    const writeResultSchema = vi.fn().mockResolvedValue("/Volumes/code/project/result.json");
    const localOutputSchema = {
      type: "object",
      required: ["status", "summary", "evidence"],
      properties: {
        status: { const: "SUCCESS" },
        summary: { type: "string", minLength: 1 },
        evidence: { type: "array", uniqueItems: true, items: { type: "string" } },
      },
      additionalProperties: false,
    };

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task", subloopId: "implement", stagePath: ".humanthread/loops/task/subloops/implement", configured: true,
          businessGoal: "Implement the requested change",
          inputScope: { codeAccess: true, writeAccess: true, include: ["src/**"], exclude: [], allowedCommands: [], blockedPaths: [] },
          resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
          checklist: [], qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
          agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
          skillSelection: { schemaVersion: 1, mode: "none" }, outputSchema: localOutputSchema, fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: { main: { prompt: "Apply the repository implementation rules.", rules: [], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"b".repeat(64)}` } },
      }),
      writeResultSchema,
      startHeartbeat: () => () => undefined,
    });

    expect(provider.projectStructuredOutputSchema).toHaveBeenCalledWith(localOutputSchema);
    expect(writeResultSchema).toHaveBeenCalledWith(expect.objectContaining({
      schema: { type: "object", required: ["status", "summary", "evidence"] },
    }));
    expect(localOutputSchema.properties.evidence).toHaveProperty("uniqueItems", true);
  });

  it("validates a Draft 2020-12 project Schema locally", async () => {
    const api = createApi();
    const provider = createProvider([{ type: "run.completed", result: { status: "SUCCESS", summary: "done" } }]);
    const outputSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["status", "summary"],
      properties: {
        status: { const: "SUCCESS" },
        summary: { type: "string", minLength: 1 },
      },
    };

    await runLoopAssignment(assignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadLocalStageContract: vi.fn().mockResolvedValue({
        stage: {
          loopId: "loop_task", subloopId: "implement", stagePath: ".humanthread/loops/task/subloops/implement", configured: true,
          businessGoal: "Implement the requested change",
          inputScope: { codeAccess: true, writeAccess: true, include: ["src/**"], exclude: [], allowedCommands: [], blockedPaths: [] },
          resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
          checklist: [], qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
          agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
          skillSelection: { schemaVersion: 1, mode: "none" }, outputSchema, fingerprint: `sha256:${"a".repeat(64)}`,
        },
        resourcesByExecId: { main: { prompt: "Apply the repository implementation rules.", rules: [], resources: [], schemas: [], templates: [], skills: [], fingerprint: `sha256:${"b".repeat(64)}` } },
      }),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outcome: "success" }),
    }));
  });

  it("binds verify_and_push evidence to a stable Git push effect receipt", async () => {
    const api = createApi();
    const provider = createProvider([
      { type: "run.completed", result: validTaskDevelopmentResult() },
    ]);
    const { outbox, records } = createMemoryOutbox();

    await runLoopAssignment(verifyAndPushAssignment, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: {
        outcome: "success",
        output: validTaskDevelopmentResult(),
        artifactRefs: [
          "artifact_requirement_login",
          "artifact_unit_tests",
          "docs/knowledge/login.md",
        ],
        effectReceipts: [{
          operationType: "git.push",
          effectId: `git.push:2026-HT100023:${taskCommit}`,
          status: "succeeded",
          branch: "2026-HT100023",
          remoteHeadCommit: taskCommit,
        }],
      },
    }));
  });

  it("rejects verify_and_push evidence when the report and remote head disagree", async () => {
    const api = createApi();
    const changed = validTaskDevelopmentResult();
    changed.pushReceipt.remoteHeadCommit = "c".repeat(40);

    await runLoopAssignment(verifyAndPushAssignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([{ type: "run.completed", result: changed }]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: expect.objectContaining({ errorCode: "invalid_task_development_evidence" }),
        effectReceipts: [],
      }),
    }));
  });

  it("heartbeats, checkpoints events, and submits a schema-valid Codex result", async () => {
    const api = createApi();
    const provider = createProvider([
      { type: "run.started", providerSessionId: "thread_1" },
      { type: "agent.message.completed", text: "working" },
      { type: "checkpoint.created", payload: { phase: "tests" } },
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox, records } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "files", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/.humanthread/loop/results/attempt_1.schema.json"),
      startHeartbeat: (heartbeat) => {
        void heartbeat();
        return () => undefined;
      },
    });

    expect(api.heartbeat).toHaveBeenCalledWith(expect.objectContaining({ leaseGeneration: 7 }));
    expect(api.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "checkpoint:attempt_1:5",
      checkpoint: {
        providerSessionId: "thread_1",
        value: { phase: "tests" },
        workspace: {
          workspaceRealpath: "/Volumes/code/project",
          branch: null,
          headCommit: null,
          clean: null,
          isWorktree: false,
        },
      },
    }));
    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "result:attempt_1",
      result: {
        outcome: "success",
        output: { summary: "done" },
        artifactRefs: [],
        effectReceipts: [],
      } satisfies LoopNodeResult,
    }));
    expect(records()).toEqual([]);
    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/Volumes/code/project",
      executionPolicy: {
        mode: "workspace_full",
        workspaceRealpath: "/Volumes/code/project",
      },
    }));
  });

  it("does not persist high-frequency agent messages or tool lifecycle events", async () => {
    const provider = createProvider([
      { type: "run.started", providerSessionId: "thread_volume" },
      { type: "agent.message.completed", text: "chunk" },
      { type: "tool.started", tool: "shell", payload: { command: "pwd" } },
      { type: "tool.completed", tool: "shell", payload: { command: "pwd" } },
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "files", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    const eventTypes = vi.mocked(outbox.enqueue).mock.calls
      .map(([record]) => record)
      .filter((record) => record.kind === "event")
      .map((record) => (record.payload as { eventType: string }).eventType);
    expect(eventTypes).toEqual(["run.started"]);
    expect(vi.mocked(outbox.enqueue).mock.calls.some(([record]) => record.kind === "terminal_result")).toBe(true);
  });

  it("reports a schema-valid clarification without advancing and preserves its artifacts", async () => {
    const execResultAssignment: LoopAssignment = {
      ...assignment,
      node: {
        key: "implement",
        label: "Implement",
        type: "agent_action",
        offlinePolicy: "online_required",
        executionTarget: "local",
        promptTemplate: "Implement the requested change",
        outputSchema: {
          type: "object",
          required: ["execId", "status", "issueType", "summary", "confidence", "evidence", "artifacts", "checkpoint"],
          properties: {
            execId: { type: "string" },
            status: { enum: ["SUCCESS", "FAILED", "NEEDS_CLARIFICATION", "TIMEOUT", "OUTPUT_PARSE_FAILED"] },
            issueType: { type: "string" },
            summary: { type: "string" },
            confidence: { type: "number" },
            evidence: { type: "array", items: { type: "string" } },
            artifacts: { type: "array", items: { type: "string" } },
            checkpoint: { type: ["object", "null"] },
          },
          additionalProperties: false,
        },
      },
    };
    const clarification = {
      execId: "main",
      status: "NEEDS_CLARIFICATION",
      issueType: "GIT_METADATA_WRITE_DENIED",
      summary: "Git metadata is read-only",
      confidence: 0.99,
      evidence: [],
      artifacts: [
        "artifacts/get-requirement/input-snapshot.json",
        "artifacts/get-requirement/source-manifest.json",
      ],
      checkpoint: null,
    };
    const api = createApi();

    await runLoopAssignment(execResultAssignment, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([{ type: "run.completed", result: clarification }]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: clarification,
        artifactRefs: [
          "artifacts/get-requirement/input-snapshot.json",
          "artifacts/get-requirement/source-manifest.json",
        ],
        effectReceipts: [],
        failure: expect.objectContaining({
          status: "NEEDS_CLARIFICATION",
          code: "GIT_METADATA_WRITE_DENIED",
          categoryHint: "requirement_unclear",
          retryHint: expect.objectContaining({ recommended: false }),
        }),
      }),
    }));
  });

  it("fails closed for a schema-valid future terminal status", async () => {
    const api = createApi();
    const futureResult = { summary: "Provider introduced a new terminal state", status: "DEFERRED" };

    await runLoopAssignment({
      ...assignment,
      node: {
        key: "implement",
        label: "Implement",
        type: "agent_action",
        offlinePolicy: "online_required",
        executionTarget: "local",
        promptTemplate: "Implement the requested change",
        outputSchema: {
          type: "object",
          required: ["summary", "status"],
          properties: { summary: { type: "string" }, status: { type: "string" } },
          additionalProperties: false,
        },
      },
    }, {
      api,
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([{ type: "run.completed", result: futureResult }]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outcome: "failure", output: futureResult }),
    }));
  });

  it("schedules heartbeats from the server lease duration instead of the client clock", async () => {
    const startHeartbeat = vi.fn(() => () => undefined);

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([{ type: "run.completed", result: { summary: "done" } }]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      initialLeaseDurationMs: 60_000,
      startHeartbeat,
    });

    expect(startHeartbeat).toHaveBeenCalledWith(expect.any(Function), 20_000);
  });

  it("uses the conservative heartbeat window for an unsafe server lease duration", async () => {
    const startHeartbeat = vi.fn(() => () => undefined);

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider: createProvider([{ type: "run.completed", result: { summary: "done" } }]),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      initialLeaseDurationMs: Number.MAX_SAFE_INTEGER,
      startHeartbeat,
    });

    expect(startHeartbeat).toHaveBeenCalledWith(expect.any(Function), 10_000);
  });

  it("uses a matching workspace Grant from the wrapped platform snapshot", async () => {
    const provider = createProvider([
      { type: "run.completed", result: { summary: "done" } },
    ]);

    await runLoopAssignment({
      ...assignment,
      grantSnapshot: {
        automationGrantIds: ["grant_workspace"],
        grants: [wrappedWorkspaceGrant],
      },
    }, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({
      executionPolicy: {
        mode: "workspace_full",
        workspaceRealpath: "/Volumes/code/project",
      },
    }));
  });

  it.each([
    ["ID is outside automationGrantIds", { id: "grant_unbound" }],
    ["node", { nodeKeys: ["other_node"] }],
    ["execution plane", { executionPlanes: ["platform"] }],
    ["Workspace", { workspaceBindingIds: ["workspace_other"] }],
    ["Agent Profile", { agentProfileIds: ["profile_other"] }],
    ["Provider", { providers: ["claude"] }],
    ["status", { status: "revoked", revokedAt: "2026-07-30T11:30:00.000Z" }],
    ["confirmation", { confirmedAt: "2026-07-30T12:30:00.000Z" }],
    ["confirmation format", { confirmedAt: "2026-07-30 11:00:00" }],
    ["expiry", { expiresAt: "2026-07-30T11:30:00.000Z" }],
    ["expiry boundary", { expiresAt: "2026-07-30T12:00:00.000Z" }],
  ])("keeps the Provider execution open when the wrapped Grant %s does not match", async (
    _scope,
    grantOverrides,
  ) => {
    const provider = createProvider([
      { type: "run.completed", result: { summary: "done" } },
    ]);

    await runLoopAssignment({
      ...assignment,
      grantSnapshot: {
        automationGrantIds: ["grant_workspace"],
        grants: [{ ...wrappedWorkspaceGrant, ...grantOverrides }],
      },
    }, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({
      executionPolicy: {
        mode: "workspace_full",
        workspaceRealpath: "/Volumes/code/project",
      },
    }));
  });

  it.each([
    ["is incomplete", {
      automationGrantIds: ["grant_workspace"],
      permission: "workspace_full",
      networkTargets: [],
    }],
    ["contains a truncated Grant", {
      automationGrantIds: ["grant_workspace"],
      grants: [truncatedWorkspaceGrant],
    }],
  ])("uses open workspace execution when the platform Grant wrapper %s", async (
    _case,
    grantSnapshot,
  ) => {
    const provider = createProvider([
      { type: "run.completed", result: { summary: "done" } },
    ]);

    await runLoopAssignment({ ...assignment, grantSnapshot }, {
      api: createApi(),
      outbox: createMemoryOutbox().outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({
      executionPolicy: {
        mode: "workspace_full",
        workspaceRealpath: "/Volumes/code/project",
      },
    }));
  });

  it("injects local constraints into the Provider prompt and uploads only their fingerprint", async () => {
    const api = createApi();
    const provider = createProvider([
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment({
      ...assignment,
      inputSnapshot: { task: "Implement", targetPaths: ["packages/web/src/page.tsx"] },
    }, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      loadProjectConstraints: vi.fn().mockResolvedValue({
        fingerprint: `sha256:${"a".repeat(64)}`,
        checks: [{ name: "check-1", command: "corepack pnpm test" }],
        sources: [{ relativePath: "AGENTS.md", content: "private local rules" }],
      }),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(provider.start).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("private local rules"),
    }));
    expect(api.events).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({
        eventType: "loop.assignment.constraints_loaded",
        payloadSummary: { constraintFingerprint: `sha256:${"a".repeat(64)}` },
      })],
    }));
    expect(JSON.stringify(vi.mocked(api.events).mock.calls)).not.toContain("private local rules");
  });

  it("resumes only from a provider session in the platform checkpoint snapshot", async () => {
    const provider = createProvider([{ type: "run.completed", result: { summary: "done" } }]);
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment({
      ...assignment,
      checkpointSnapshot: {
        providerSessionId: "thread_acknowledged",
        value: { phase: "tests" },
      },
    }, {
      api: createApi(),
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(provider.resume).toHaveBeenCalledWith(expect.objectContaining({
      providerSessionId: "thread_acknowledged",
    }));
    expect(provider.start).not.toHaveBeenCalled();
  });

  it("omits an unavailable Provider session from persisted checkpoints", async () => {
    const provider = createProvider([
      { type: "checkpoint.created", payload: { phase: "tests" } },
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    const checkpoint = vi.mocked(outbox.enqueue).mock.calls
      .map(([record]) => record)
      .find(({ kind }) => kind === "checkpoint");
    expect(checkpoint?.payload).toMatchObject({
      checkpoint: { value: { phase: "tests" } },
    });
    expect(Reflect.has(
      Reflect.get(checkpoint?.payload as object, "checkpoint") as object,
      "providerSessionId",
    )).toBe(false);
  });

  it("cancels the provider when a heartbeat reports a stale lease", async () => {
    let rejectHeartbeat: (error: unknown) => void = () => undefined;
    const api = createApi();
    api.heartbeat = vi.fn(() => new Promise<{ leaseExpiresAt: string }>((_, reject) => {
      rejectHeartbeat = reject;
    }));
    const provider = createProvider([]);
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: (heartbeat) => {
        void heartbeat();
        rejectHeartbeat(Object.assign(new Error("stale"), { code: "stale_lease" }));
        return () => undefined;
      },
    });

    await vi.waitFor(() => expect(provider.cancel).toHaveBeenCalled());
  });

  it("cancels the provider when the lease heartbeat exceeds its bounded timeout", async () => {
    const api = createApi();
    api.heartbeat = vi.fn(() => new Promise<{ leaseExpiresAt: string }>(() => undefined));
    const provider = createProvider([]);
    provider.start = vi.fn((input) => (async function* () {
      await new Promise<void>((resolve) => {
        input.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    })());
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api,
      outbox,
      provider,
      initialLeaseDurationMs: 3_000,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: (heartbeat) => {
        void heartbeat();
        return () => undefined;
      },
    });

    await vi.waitFor(() => expect(provider.cancel).toHaveBeenCalled(), { timeout: 2_000 });
  });

  it("keeps a terminal result until the platform explicitly accepts it", async () => {
    const terminal = {
      id: "result:attempt_1",
      assignmentId: assignment.id,
      leaseGeneration: assignment.leaseGeneration,
      sequence: 3,
      priority: "critical" as const,
      kind: "terminal_result" as const,
      payload: {
        agentRunId: assignment.agentRunId,
        loopRunId: assignment.loopRunId,
        loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        attemptNo: assignment.attemptNo,
        result: { outcome: "success", output: { summary: "done" }, artifactRefs: [], effectReceipts: [] },
      },
      byteSize: 490,
      createdAt: "2026-07-30T12:00:00.000Z",
    } satisfies LoopOutboxRecord;
    const { outbox, records } = createMemoryOutbox([terminal]);
    const api = createApi();

    await flushAssignmentOutbox(outbox, api);

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "result:attempt_1",
    }));
    expect(records()).toEqual([]);
  });

  it("replays a terminal result, route decision, and token-redacted offline record in order", async () => {
    const terminal = {
      id: "result:attempt_1", assignmentId: assignment.agentRunId, leaseGeneration: assignment.leaseGeneration,
      sequence: 1, priority: "critical" as const, kind: "terminal_result" as const,
      payload: {
        agentRunId: assignment.agentRunId, leaseGeneration: assignment.leaseGeneration,
        loopRunId: assignment.loopRunId, loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId, attemptNo: assignment.attemptNo,
        result: { outcome: "success", output: { summary: "done" }, artifactRefs: [], effectReceipts: [] },
      }, byteSize: 480, createdAt: "2026-07-30T12:00:00.000Z",
    } satisfies LoopOutboxRecord;
    const route = {
      id: "route:abc", assignmentId: assignment.agentRunId, leaseGeneration: assignment.leaseGeneration,
      sequence: 2, priority: "critical" as const, kind: "route_decision" as const,
      payload: {
        agentRunId: assignment.agentRunId, leaseGeneration: assignment.leaseGeneration,
        loopRunId: assignment.loopRunId, loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId, attemptNo: assignment.attemptNo,
        routeDecision: {
          decisionId: "decision_1", fromNodeId: "implement", nextNodeId: "end", reasonCode: "STAGE_SUCCEEDED",
          summary: "done", evidence: [], confidence: 1,
          snapshotDigest: `sha256:${"a".repeat(64)}`, routerContractVersion: 1, routerContractDigest: `sha256:${"b".repeat(64)}`,
        },
      }, byteSize: 520, createdAt: "2026-07-30T12:00:01.000Z",
    } satisfies LoopOutboxRecord;
    const offline = {
      id: "offline:attempt_1:decision_1", assignmentId: assignment.agentRunId, leaseGeneration: assignment.leaseGeneration,
      sequence: 3, priority: "critical" as const, kind: "offline_stage_result" as const,
      payload: {
        agentRunId: assignment.agentRunId, leaseGeneration: assignment.leaseGeneration,
        loopRunId: assignment.loopRunId, loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId, attemptNo: assignment.attemptNo,
        offlineStageResult: { record: { grant: { workerId: "worker_1" }, provisionalStepId: "offline:attempt_1:decision_1" } },
      }, byteSize: 420, createdAt: "2026-07-30T12:00:02.000Z",
    } satisfies LoopOutboxRecord;
    const { outbox, records } = createMemoryOutbox([terminal, route, offline]);
    const api = createApi();

    await flushAssignmentOutbox(outbox, api);

    expect(records()).toEqual([]);
    expect(vi.mocked(api.complete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.routeDecision!).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(api.routeDecision!).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.offlineStageResult!).mock.invocationCallOrder[0]!,
    );
    expect(JSON.stringify(vi.mocked(api.offlineStageResult!).mock.calls)).not.toContain("token");
  });

  it("discards a stale assignment record while flushing later assignment records", async () => {
    const stale = {
      id: "event:attempt_old:1",
      assignmentId: "agent_run_old",
      leaseGeneration: 1,
      sequence: 3,
      priority: "activity" as const,
      kind: "event" as const,
      payload: {
        eventId: "event:attempt_old:1",
        loopRunId: "loop_old",
        loopNodeRunId: "node_old",
        loopNodeAttemptId: "attempt_old",
        attemptNo: 1,
        leaseGeneration: 1,
        sequence: 1,
        eventType: "run.started",
        occurredAt: "2026-07-30T11:00:00.000Z",
        payloadSummary: {},
        artifactRefs: [],
      },
      byteSize: 400,
      createdAt: "2026-07-30T11:00:00.000Z",
    } satisfies LoopOutboxRecord;
    const current = {
      ...stale,
      id: "event:attempt_1:3",
      assignmentId: assignment.agentRunId,
      leaseGeneration: assignment.leaseGeneration,
      sequence: 9,
      payload: {
        ...stale.payload,
        eventId: "event:attempt_1:3",
        loopRunId: assignment.loopRunId,
        loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        leaseGeneration: assignment.leaseGeneration,
        sequence: 3,
      },
    } satisfies LoopOutboxRecord;
    const { outbox, records } = createMemoryOutbox([stale, current]);
    const api = createApi();
    api.events = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "stale_lease" }))
      .mockResolvedValueOnce({ acceptedThroughSequence: 3 });

    await expect(flushAssignmentOutbox(outbox, api)).resolves.toEqual({
      staleAssignmentIds: ["agent_run_old"],
      online: true,
    });

    expect(records()).toEqual([]);
    expect(outbox.acknowledge).toHaveBeenCalledWith([
      "event:attempt_old:1",
      "event:attempt_1:3",
    ]);
    expect(api.events).toHaveBeenCalledTimes(2);
  });

  it.each([
    "authorization_denied",
    "grant_revoked",
    "cancelled",
  ])("discards an outbox record rejected with terminal code %s", async (code) => {
    const terminal = {
      id: `event:attempt_1:${code}`,
      assignmentId: assignment.agentRunId,
      leaseGeneration: assignment.leaseGeneration,
      sequence: 3,
      priority: "activity" as const,
      kind: "event" as const,
      payload: {
        eventId: `event:attempt_1:${code}`,
        loopRunId: assignment.loopRunId,
        loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        attemptNo: assignment.attemptNo,
        leaseGeneration: assignment.leaseGeneration,
        sequence: 1,
        eventType: "run.started" as const,
        occurredAt: "2026-08-10T12:00:00.000Z",
        payloadSummary: {},
        artifactRefs: [],
      },
      byteSize: 400,
      createdAt: "2026-08-10T12:00:00.000Z",
    } satisfies LoopOutboxRecord;
    const { outbox, records } = createMemoryOutbox([terminal]);
    const api = createApi();
    api.events = vi.fn().mockRejectedValue(Object.assign(new Error(code), { code }));

    await expect(flushAssignmentOutbox(outbox, api)).resolves.toEqual({
      staleAssignmentIds: [assignment.agentRunId],
      online: true,
    });

    expect(records()).toEqual([]);
  });

  it("retains a retryable record without blocking a different assignment", async () => {
    const retryable = {
      id: "event:attempt_1:temporary",
      assignmentId: assignment.agentRunId,
      leaseGeneration: assignment.leaseGeneration,
      sequence: 3,
      priority: "activity" as const,
      kind: "event" as const,
      payload: {
        eventId: "event:attempt_1:temporary",
        loopRunId: assignment.loopRunId,
        loopNodeRunId: assignment.loopNodeRunId,
        loopNodeAttemptId: assignment.loopNodeAttemptId,
        attemptNo: assignment.attemptNo,
        leaseGeneration: assignment.leaseGeneration,
        sequence: 1,
        eventType: "run.started" as const,
        occurredAt: "2026-08-10T12:00:00.000Z",
        payloadSummary: {},
        artifactRefs: [],
      },
      byteSize: 400,
      createdAt: "2026-08-10T12:00:00.000Z",
    } satisfies LoopOutboxRecord;
    const following = {
      ...retryable,
      id: "event:attempt_2:1",
      assignmentId: "agent_run_2",
      payload: {
        ...retryable.payload,
        eventId: "event:attempt_2:1",
        loopNodeAttemptId: "attempt_2",
      },
    } satisfies LoopOutboxRecord;
    const { outbox, records } = createMemoryOutbox([retryable, following]);
    const api = createApi();
    api.events = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Service unavailable"), {
        code: "request_failed",
        status: 503,
      }))
      .mockResolvedValueOnce({ acceptedThroughSequence: 1 });

    await expect(flushAssignmentOutbox(outbox, api)).resolves.toEqual({
      staleAssignmentIds: [],
      online: false,
    });

    expect(records()).toEqual([retryable]);
    expect(api.events).toHaveBeenCalledTimes(2);
  });

  it("uses distinct durable ordering identities for an event and its checkpoint", async () => {
    const provider = createProvider([
      { type: "checkpoint.created", payload: { phase: "tests" } },
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    const persistedSequences = vi.mocked(outbox.enqueue).mock.calls
      .map(([record]) => record.sequence);
    expect(new Set(persistedSequences).size).toBe(persistedSequences.length);
  });

  it("persists the terminal result before any completion event can be uploaded", async () => {
    const provider = createProvider([
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox } = createMemoryOutbox();
    const api = createApi();

    await runLoopAssignment(assignment, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(vi.mocked(outbox.enqueue).mock.calls.map(([record]) => record.kind))
      .toEqual(["terminal_result"]);
    expect(api.events).not.toHaveBeenCalled();
  });

  it("submits provider failures as terminal failure results", async () => {
    const provider = createProvider([
      { type: "run.failed", errorCode: "provider_error", message: "Codex failed" },
    ]);
    const { outbox } = createMemoryOutbox();
    const api = createApi();

    await runLoopAssignment(assignment, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: { errorCode: "provider_error", message: "Codex failed" },
        artifactRefs: [],
        effectReceipts: [],
        failure: expect.objectContaining({
          status: "FAILED",
          code: "provider_error",
          categoryHint: "unknown",
          retryHint: expect.objectContaining({ recommended: false }),
        }),
      }),
    }));
  });

  it("submits an invalid structured Provider result as a terminal failure", async () => {
    const provider = createProvider([
      { type: "run.completed", result: { wrong: true } },
    ]);
    const { outbox } = createMemoryOutbox();
    const api = createApi();

    await runLoopAssignment(assignment, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        outcome: "failure",
        output: {
          errorCode: "invalid_provider_result",
          message: "Provider result does not match the node output Schema",
        },
        artifactRefs: [],
        effectReceipts: [],
        failure: expect.objectContaining({
          status: "FAILED",
          code: "invalid_provider_result",
          categoryHint: "unknown",
          retryHint: expect.objectContaining({ recommended: false }),
        }),
      }),
    }));
  });

  it("does not start the Provider when the host aborts during Workspace preparation", async () => {
    let releaseWorkspace: (() => void) | undefined;
    const workspaceReady = new Promise<void>((resolve) => { releaseWorkspace = resolve; });
    const provider = createProvider([{ type: "run.completed", result: { summary: "done" } }]);
    const { outbox } = createMemoryOutbox();
    const controller = new AbortController();
    const running = runLoopAssignment(assignment, {
      api: createApi(),
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: async () => {
        await workspaceReady;
        return "/Volumes/code/project";
      },
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      signal: controller.signal,
    });

    controller.abort();
    releaseWorkspace?.();
    await running;

    expect(provider.start).not.toHaveBeenCalled();
    expect(provider.resume).not.toHaveBeenCalled();
  });

  it("does not start Codex when the local runtime configuration is stale", async () => {
    const provider = createProvider([{ type: "run.completed", result: { summary: "done" } }]);
    const { outbox } = createMemoryOutbox();

    await expect(runLoopAssignment(assignment, {
      api: createApi(),
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      resolveProvider: vi.fn().mockRejectedValue(Object.assign(
        new Error("stale runtime"),
        { code: "runtime_configuration_stale" },
      )),
      writeResultSchema: vi.fn(),
      startHeartbeat: () => () => undefined,
    })).rejects.toMatchObject({ code: "runtime_configuration_stale" });

    expect(provider.start).not.toHaveBeenCalled();
    expect(provider.resume).not.toHaveBeenCalled();
  });

  it("reports a redacted configuration event before rejecting a stale Workspace", async () => {
    const provider = createProvider([{ type: "run.completed", result: { summary: "done" } }]);
    const { outbox, records } = createMemoryOutbox();
    const api = createApi();
    const writeResultSchema = vi.fn();

    await expect(runLoopAssignment(assignment, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockRejectedValue(Object.assign(
        new Error("stale /Users/alice/private-project"),
        { code: "workspace_configuration_stale" },
      )),
      writeResultSchema,
      startHeartbeat: () => () => undefined,
    })).rejects.toMatchObject({ code: "workspace_configuration_stale" });

    expect(api.events).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({
        eventType: "loop.assignment.configuration_rejected",
        payloadSummary: { code: "workspace_configuration_stale" },
      })],
    }));
    expect(JSON.stringify(vi.mocked(api.events).mock.calls)).not.toContain("/Users/");
    expect(records()).toEqual([]);
    expect(writeResultSchema).not.toHaveBeenCalled();
    expect(provider.start).not.toHaveBeenCalled();
    expect(provider.resume).not.toHaveBeenCalled();
  });

  it("does not persist the raw tool payload or per-tool lifecycle", async () => {
    const provider = createProvider([
      { type: "tool.completed", tool: "shell", payload: { command: "build", output: "x".repeat(5_000) } },
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    const event = vi.mocked(outbox.enqueue).mock.calls
      .map(([record]) => record)
      .find(({ kind }) => kind === "event");
    expect(event).toBeUndefined();
  });

  it("does not persist high-frequency message completion text", async () => {
    const provider = createProvider([
      { type: "agent.message.completed", text: "private draft text" },
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api: createApi(),
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    const event = vi.mocked(outbox.enqueue).mock.calls
      .map(([record]) => record)
      .find(({ kind }) => kind === "event");
    expect(event).toBeUndefined();
  });

  it("continues offline and persists a checkpoint before upload retries", async () => {
    const api = createApi();
    api.events = vi.fn().mockRejectedValue(new TypeError("network offline"));
    const provider = createProvider([
      { type: "checkpoint.created", payload: { phase: "tests" } },
      { type: "run.completed", result: { summary: "done" } },
    ]);
    const { outbox, records } = createMemoryOutbox();

    await runLoopAssignment(assignment, {
      api,
      outbox,
      provider,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveWorkspace: vi.fn().mockResolvedValue("/Volumes/code/project"),
      writeResultSchema: vi.fn().mockResolvedValue("/Volumes/code/project/result.json"),
      startHeartbeat: () => () => undefined,
    });

    expect(records().map(({ kind }) => kind)).toEqual([
      "event",
      "checkpoint",
      "terminal_result",
    ]);
    expect(provider.cancel).not.toHaveBeenCalled();
  });

  it("opens a claimed direct LiveSession even when no Loop assignment is available", async () => {
    const api = createApi();
    api.claim = vi.fn().mockResolvedValue({
      assignment: null,
      leaseGeneration: null,
      leaseExpiresAt: null,
      liveSession: {
        sessionId: "f".repeat(32),
        kind: "agent",
        target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
        projectId: null,
        taskId: null,
        executionPolicy: "direct",
        relayUrl: "ws://localhost:3000/live-session/execution?sessionId=" + "f".repeat(32),
        authorization: "lst1.payload.signature",
        initialCols: 120,
        initialRows: 36,
      },
    });
    const openLiveSession = vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    });
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(undefined),
      runAssignment: vi.fn(),
      openLiveSession,
      canClaim: vi.fn().mockResolvedValue(true),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await worker.onOnline();

    expect(openLiveSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "f".repeat(32),
      executionPolicy: "direct",
    }));
    worker.stop();
  });

  it("keeps one direct LiveSession open across polling passes", async () => {
    const api = createApi();
    api.claim = vi.fn().mockResolvedValue({
      assignment: null,
      leaseGeneration: null,
      leaseExpiresAt: null,
      liveSession: {
        sessionId: "f".repeat(32),
        kind: "agent",
        target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
        projectId: null,
        taskId: null,
        executionPolicy: "direct",
        relayUrl: `ws://localhost:3000/live-session/execution?sessionId=${"f".repeat(32)}`,
        authorization: "lst1.payload.signature",
        initialCols: 120,
        initialRows: 36,
      },
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const openLiveSession = vi.fn().mockResolvedValue({ close });
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(undefined),
      runAssignment: vi.fn(),
      openLiveSession,
      canClaim: vi.fn().mockResolvedValue(true),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 2,
      },
    });

    await worker.onOnline();
    await worker.onOnline();

    expect(openLiveSession).toHaveBeenCalledOnce();
    await worker.stop();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it("flushes the durable outbox before claiming after reconnect", async () => {
    const calls: string[] = [];
    const api = createApi();
    api.claim = vi.fn(async () => {
      calls.push("claim");
      return { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
    });

    const worker = startLoopWorker({
      api,
      flush: async () => { calls.push("flush"); },
      runAssignment: vi.fn(),
      canClaim: async () => true,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await worker.onOnline();

    expect(calls).toEqual(["flush", "claim"]);
    worker.stop();
  });

  it("fills the configured Worker slots and excludes assignments already running locally", async () => {
    const assignments = [
      { ...assignment, agentRunId: "agent_run_1", id: "assignment_1" },
      { ...assignment, agentRunId: "agent_run_2", id: "assignment_2" },
      null,
    ];
    const api = createApi();
    api.claim = vi.fn(async ({ acceptAssignments }) => {
      if (acceptAssignments === false) {
        return { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
      }
      const next = assignments.shift() ?? null;
      return next
        ? { assignment: next, leaseGeneration: next.leaseGeneration, leaseExpiresAt: next.leaseExpiresAt }
        : { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
    });
    const releases: Array<() => void> = [];
    const runAssignment = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(undefined),
      runAssignment,
      canClaim: async () => true,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 2,
      },
    });

    await worker.onOnline();

    expect(runAssignment).toHaveBeenCalledTimes(2);
    expect(api.claim).toHaveBeenNthCalledWith(1, expect.objectContaining({ activeAgentRunIds: [] }));
    expect(api.claim).toHaveBeenNthCalledWith(2, expect.objectContaining({ activeAgentRunIds: ["agent_run_1"] }));
    releases.forEach((release) => release());
    worker.stop();
  });

  it("excludes assignments awaiting durable outbox replay from a new claim", async () => {
    const api = createApi();
    api.claim = vi.fn().mockResolvedValue({
      assignment: { ...assignment, agentRunId: "agent_run_pending" },
      leaseGeneration: assignment.leaseGeneration,
      leaseExpiresAt: assignment.leaseExpiresAt,
    });
    const runAssignment = vi.fn();
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(false),
      pendingAgentRunIds: vi.fn().mockResolvedValue(["agent_run_pending"]),
      runAssignment,
      canClaim: vi.fn().mockResolvedValue(true),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await worker.onOnline();

    expect(api.claim).toHaveBeenCalledWith(expect.objectContaining({
      activeAgentRunIds: ["agent_run_pending"],
      acceptAssignments: true,
    }));
    expect(runAssignment).not.toHaveBeenCalled();
    worker.stop();
  });

  it("does not cancel active assignments when concurrency is lowered", async () => {
    const assignments = [
      { ...assignment, agentRunId: "agent_run_1", id: "assignment_1" },
      { ...assignment, agentRunId: "agent_run_2", id: "assignment_2" },
      { ...assignment, agentRunId: "agent_run_3", id: "assignment_3" },
    ];
    const api = createApi();
    api.claim = vi.fn(async ({ acceptAssignments }) => {
      if (acceptAssignments === false) {
        return { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
      }
      const next = assignments.shift() ?? null;
      return next
        ? { assignment: next, leaseGeneration: next.leaseGeneration, leaseExpiresAt: next.leaseExpiresAt }
        : { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
    });
    const releases = new Map<string, () => void>();
    const runAssignment = vi.fn((current: LoopAssignment) => new Promise<void>((resolve) => releases.set(current.agentRunId, resolve)));
    const cancelActive = vi.fn().mockResolvedValue(undefined);
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(true),
      runAssignment,
      canClaim: async () => true,
      cancelActive,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 2,
      },
    });

    await worker.onOnline();
    worker.updateMaxConcurrency(1);
    releases.get("agent_run_1")?.();
    await vi.waitFor(() => expect(runAssignment).toHaveBeenCalledTimes(2));
    await worker.onOnline();

    expect(runAssignment).toHaveBeenCalledTimes(2);
    expect(cancelActive).not.toHaveBeenCalled();
    releases.get("agent_run_2")?.();
    await vi.waitFor(() => expect(releases.has("agent_run_2")).toBe(true));
    await worker.onOnline();
    expect(runAssignment).toHaveBeenCalledTimes(3);
    releases.get("agent_run_3")?.();
    worker.stop();
  });

  it("accepts an assignment while outbox replay is degraded and capacity remains", async () => {
    const api = createApi();
    api.claim = vi.fn(async ({ acceptAssignments }) => acceptAssignments
      ? {
          assignment,
          leaseGeneration: assignment.leaseGeneration,
          leaseExpiresAt: assignment.leaseExpiresAt,
        }
      : { assignment: null, leaseGeneration: null, leaseExpiresAt: null });
    const runAssignment = vi.fn().mockResolvedValue(undefined);
    const worker = startLoopWorker({
      api,
      flush: async () => false,
      runAssignment,
      canClaim: async () => true,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await worker.onOnline();

    expect(runAssignment).toHaveBeenCalledWith(assignment);
    expect(worker.getSyncStatus()).toBe("degraded");
    worker.stop();
  });

  it("accepts assignments when outbox inspection throws but capacity remains", async () => {
    const api = createApi();
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockRejectedValue(new Error("local outbox unavailable")),
      runAssignment: vi.fn(),
      canClaim: vi.fn().mockResolvedValue(true),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await expect(worker.onOnline()).resolves.toBeUndefined();

    expect(api.claim).toHaveBeenCalledWith(expect.objectContaining({
      acceptAssignments: true,
    }));
    expect(worker.getSyncStatus()).toBe("degraded");
  });

  it("heartbeats without accepting assignments when outbox capacity inspection throws", async () => {
    const api = createApi();
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(true),
      runAssignment: vi.fn(),
      canClaim: vi.fn().mockRejectedValue(new Error("local capacity unavailable")),
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await expect(worker.onOnline()).resolves.toBeUndefined();

    expect(api.claim).toHaveBeenCalledWith(expect.objectContaining({
      acceptAssignments: false,
    }));
    expect(worker.getSyncStatus()).toBe("degraded");
  });

  it("keeps accepting assignments across repeated degraded outbox passes", async () => {
    const api = createApi();
    const claims = [null, null, assignment];
    api.claim = vi.fn(async ({ acceptAssignments }) => {
      const claimedAssignment = acceptAssignments ? claims.shift() ?? null : null;
      return claimedAssignment
        ? {
            assignment: claimedAssignment,
            leaseGeneration: claimedAssignment.leaseGeneration,
            leaseExpiresAt: claimedAssignment.leaseExpiresAt,
          }
        : { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
    });
    const flush = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const runAssignment = vi.fn(() => new Promise<void>(() => undefined));
    const worker = startLoopWorker({
      api,
      flush,
      runAssignment,
      canClaim: async () => true,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await worker.onOnline();
    expect(worker.getSyncStatus()).toBe("degraded");
    await worker.onOnline();
    await worker.onOnline();

    expect(vi.mocked(api.claim).mock.calls.map(([input]) => input.acceptAssignments)).toEqual([
      true,
      true,
      true,
    ]);
    expect(runAssignment).toHaveBeenCalledOnce();
    expect(worker.getSyncStatus()).toBe("online");
    worker.stop();
  });

  it("records an offline sync state when the claim heartbeat fails", async () => {
    const api = createApi();
    api.claim = vi.fn().mockRejectedValue(new TypeError("network offline"));
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(true),
      runAssignment: vi.fn(),
      canClaim: async () => true,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await expect(worker.onOnline()).rejects.toThrow("network offline");

    expect(worker.getSyncStatus()).toBe("offline");
  });

  it("does not run a claim that resolves after the Worker has stopped", async () => {
    let resolveClaim: ((value: {
      assignment: LoopAssignment;
      leaseGeneration: number;
      leaseExpiresAt: string;
    }) => void) | undefined;
    const api = createApi();
    api.claim = vi.fn(() => new Promise<{
      assignment: LoopAssignment;
      leaseGeneration: number;
      leaseExpiresAt: string;
    }>((resolve) => { resolveClaim = resolve; }));
    const runAssignment = vi.fn();
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(undefined),
      runAssignment,
      canClaim: async () => true,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    const pass = worker.onOnline();
    await vi.waitFor(() => expect(api.claim).toHaveBeenCalled());
    worker.stop();
    resolveClaim?.({
      assignment,
      leaseGeneration: assignment.leaseGeneration,
      leaseExpiresAt: assignment.leaseExpiresAt,
    });
    await pass;

    expect(runAssignment).not.toHaveBeenCalled();
  });

  it("passes the claimed server lease duration to assignment execution", async () => {
    const api = createApi();
    api.claim = vi.fn().mockResolvedValue({
      assignment,
      leaseGeneration: assignment.leaseGeneration,
      leaseExpiresAt: assignment.leaseExpiresAt,
      leaseDurationMs: 60_000,
    });
    const runAssignment = vi.fn().mockResolvedValue(undefined);
    const worker = startLoopWorker({
      api,
      flush: vi.fn().mockResolvedValue(undefined),
      runAssignment,
      canClaim: async () => true,
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.145.0" }],
        capabilities: ["workspace"],
        loginStateCategories: [],
        maxConcurrency: 1,
      },
    });

    await worker.onOnline();

    expect(runAssignment).toHaveBeenCalledWith(assignment, 60_000);
    worker.stop();
  });
});
