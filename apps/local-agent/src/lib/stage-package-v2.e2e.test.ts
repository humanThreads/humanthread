import {
  initializeProjectLoops,
  readProjectLoopInitializationState,
  readProjectLoopStageContract,
  resolveStageResources,
  type ProjectLoopCatalogV2,
  type ProjectLoopLockV2,
  type ProjectLoopSyncFilesystem,
} from "@humanthread/project-loop-sync";
import type { LocalRouteDecision, LoopAssignment, LoopAssignmentV2 } from "@humanthread/shared";
import { parse, stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";

import { DECISION_ROUTER_CONTRACT_DIGEST } from "./decision-router-contract";
import { flushAssignmentOutbox, type LoopAssignmentApi } from "./loop-assignment-runner";
import type { LoopOutbox, LoopOutboxRecord } from "./loop-outbox";
import { createOfflineContinuation } from "./offline-continuation";
import { buildStageExecution } from "./stage-runner";

const synchronizedAt = new Date("2026-08-08T08:00:00.000Z");
const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;

function catalog(includeTest = false): ProjectLoopCatalogV2 {
  return {
    contractVersion: 2,
    projectId: "project_1",
    catalogVersion: digest(includeTest ? "b" : "a"),
    projectBindings: [{ id: "binding_1", loopDefinitionId: "loop_task", activeVersionId: "version_1", status: "enabled", bindingRole: "root", version: 1 }],
    publishedLoops: [{
      loopDefinitionId: "loop_task",
      spaceId: "space_1",
      name: "Task Loop",
      description: null,
      scope: "task",
      origin: "space",
      readOnly: false,
      latestPublishedVersionId: "version_1",
      publishedVersions: [{
        loopVersionId: "version_1",
        versionNumber: 1,
        graph: {
          schemaVersion: 2,
          limits: { maxStages: 8, maxRepeatCount: 2 },
          nodes: [
            { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement the task", allowedRouteTargets: [includeTest ? "test" : "done"] },
            ...(includeTest ? [{ key: "test", nodeId: "test", label: "Test", type: "agent_action" as const, executionTarget: "local" as const, offlinePolicy: "local_capable" as const, responsibility: "Test the implementation", allowedRouteTargets: ["done"] }] : []),
            { key: "done", nodeId: "done", label: "Done", type: "end", offlinePolicy: "online_required" },
          ],
          edges: [
            ...(includeTest ? [{ id: "develop-test", source: "develop", target: "test", kind: "normal" as const, outcome: "success" as const }] : []),
            { id: "work-done", source: includeTest ? "test" : "develop", target: "done", kind: "normal", outcome: "success" },
          ],
        },
      }],
    }],
  };
}

function memoryFilesystem(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const fs: ProjectLoopSyncFilesystem = {
    readText: async (path) => files.get(path) ?? null,
    listTree: async (prefix) => [...files.keys()].filter((path) => path === prefix || path.startsWith(`${prefix}/`)).sort(),
    mkdir: async () => undefined,
    writeTextExclusive: async (path, content) => {
      if (files.has(path)) throw Object.assign(new Error(`exists: ${path}`), { code: "path_exists" });
      files.set(path, content);
    },
    writeTextAtomic: async (path, content) => { files.set(path, content); },
    renameExclusive: async (from, to) => {
      const moved = [...files.entries()].filter(([path]) => path.startsWith(`${from}/`));
      for (const [path] of moved) files.delete(path);
      for (const [path, content] of moved) files.set(`${to}${path.slice(from.length)}`, content);
    },
    removeTransactionTree: async (prefix) => {
      for (const path of [...files.keys()]) if (path === prefix || path.startsWith(`${prefix}/`)) files.delete(path);
    },
  };
  return { files, fs };
}

async function initialize(fixture: ReturnType<typeof memoryFilesystem>, current: ProjectLoopCatalogV2) {
  return initializeProjectLoops({
    fs: fixture.fs,
    catalog: current,
    previousState: await readProjectLoopInitializationState(fixture.fs),
    now: synchronizedAt,
  });
}

function projectOwnedStageBytes(files: Map<string, string>, stagePath: string) {
  return Object.fromEntries([...files].filter(([path]) => path.startsWith(`${stagePath}/`)).sort(([left], [right]) => left.localeCompare(right)));
}

describe("Stage Package v2 local lifecycle E2E", () => {
  it("preserves project-owned bytes across re-init, adds new stages, and retains orphans", async () => {
    const fixture = memoryFilesystem({ "CLAUDE.md": "# Project instructions\n" });
    await initialize(fixture, catalog());
    const firstLock = JSON.parse(fixture.files.get(".humanthread/structure/lock.json")!) as ProjectLoopLockV2;
    const developPath = firstLock.subloops.develop!.path;
    fixture.files.set(`${developPath}/rules/project.md`, "必须运行本项目业务测试。\n");
    const firstBytes = projectOwnedStageBytes(fixture.files, developPath);

    const repeated = await initialize(fixture, catalog());
    expect(repeated).toMatchObject({ createdFiles: 0, migratedStages: 0 });
    expect(projectOwnedStageBytes(fixture.files, developPath)).toEqual(firstBytes);

    await initialize(fixture, catalog(true));
    const expandedLock = JSON.parse(fixture.files.get(".humanthread/structure/lock.json")!) as ProjectLoopLockV2;
    expect(expandedLock.subloops.test?.state).toBe("unconfigured");
    expect(projectOwnedStageBytes(fixture.files, developPath)).toEqual(firstBytes);

    await initialize(fixture, { ...catalog(true), projectBindings: [], publishedLoops: [] });
    const orphanedLock = JSON.parse(fixture.files.get(".humanthread/structure/lock.json")!) as ProjectLoopLockV2;
    expect(orphanedLock.subloops.develop?.state).toBe("orphaned");
    expect(orphanedLock.subloops.test?.state).toBe("orphaned");
    expect(fixture.files.get(`${developPath}/rules/project.md`)).toBe("必须运行本项目业务测试。\n");
  });

  it("builds identical scoped context for Codex and Claude", async () => {
    const fixture = memoryFilesystem();
    await initialize(fixture, catalog());
    const lock = JSON.parse(fixture.files.get(".humanthread/structure/lock.json")!) as ProjectLoopLockV2;
    const entry = lock.subloops.develop!;
    const stageYaml = parse(fixture.files.get(`${entry.path}/stage.yaml`)!) as Record<string, unknown>;
    fixture.files.set(`${entry.path}/stage.yaml`, stringify({ ...stageYaml, configured: true }));
    fixture.files.set(`${entry.path}/rules/project.md`, "Never read .env.\n");
    const stage = await readProjectLoopStageContract({ entry, readText: fixture.fs.readText });
    const resources = await resolveStageResources({ stage, execId: "main", readText: fixture.fs.readText, listTree: fixture.fs.listTree });
    const assignment = {
      id: "assignment_1",
      loopRunId: "run_1",
      loopNodeRunId: "node_1",
      loopNodeAttemptId: "attempt_1",
      checkpointSnapshot: { branch: "2026-HT100013", commit: "a".repeat(40) },
    } as unknown as LoopAssignment;

    const codex = await buildStageExecution({ stage, resources, assignment, provider: "codex" });
    const claude = await buildStageExecution({ stage, resources, assignment, provider: "claude" });
    expect(claude).toEqual(codex);
    expect(codex.prompt).toContain("Never read .env.");
    expect(codex.context.rules).toContain(`${entry.path}/rules/project.md`);
  });
});

function offlineAssignment(): LoopAssignmentV2 {
  return {
    id: "assignment_offline",
    agentRunId: "agent_run_offline",
    loopRunId: "run_offline",
    loopNodeRunId: "node_test",
    loopNodeAttemptId: "attempt_test",
    attemptNo: 1,
    leaseGeneration: 1,
    leaseExpiresAt: "2026-08-08T09:00:00.000Z",
    acceptedThroughSequence: 0,
    node: { key: "test", nodeId: "test", label: "Test", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", promptTemplate: "Test" },
    graph: {} as LoopAssignmentV2["graph"],
    inputSnapshot: {},
    policySnapshot: {},
    grantSnapshot: {},
    runtime: { agentProfileId: "profile_codex", provider: "codex", runtimeProfileId: "runtime_1", configurationVersion: 1 },
    workspace: { bindingId: "workspace_1", configurationVersion: 1, pathFingerprint: "hmac-sha256:offline" },
    prompt: "Test",
    resultSchemaPath: ".humanthread/results/test.json",
    contractVersion: 2,
    runGraphSnapshot: { schemaVersion: 2, snapshotId: "snapshot_1", graphDigest: digest("c"), rootLoopVersionId: "version_1", loopVersions: [], reachableNodeIds: ["test", "develop"] },
    routerContract: { version: 1, digest: DECISION_ROUTER_CONTRACT_DIGEST },
    offlineContinuation: { token: "offline-token-abcdefghijklmnopqrstuvwxyz", validUntil: "2026-08-08T08:30:00.000Z", workerId: "worker_1", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1", snapshotDigest: digest("c"), allowedNodeIds: ["develop"] },
  } as unknown as LoopAssignmentV2;
}

describe("Stage Package v2 offline recovery E2E", () => {
  it("continues only on the bound Worker and replays the durable route before the offline record", async () => {
    const assignment = offlineAssignment();
    const decision: LocalRouteDecision = {
      decisionId: "decision_offline",
      fromNodeId: "test",
      nextNodeId: "develop",
      reasonCode: "TEST_FAILED",
      summary: "Return to development",
      evidence: ["artifacts/test-report.json"],
      confidence: 0.94,
      snapshotDigest: digest("c"),
      routerContractVersion: 1,
      routerContractDigest: DECISION_ROUTER_CONTRACT_DIGEST,
    };
    const checkpoint = { branch: "2026-HT100013", commit: "a".repeat(40), artifacts: ["artifacts/test-report.json"], checklist: [] };
    const continued = await createOfflineContinuation({
      assignment,
      decision,
      current: { workerId: "worker_1", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1" },
      checkpoint,
      now: new Date("2026-08-08T08:05:00.000Z"),
    });
    const switched = await createOfflineContinuation({
      assignment,
      decision,
      current: { workerId: "worker_2", agentProfileId: "profile_codex", workspaceBindingId: "workspace_1" },
      checkpoint,
      now: new Date("2026-08-08T08:05:00.000Z"),
    });
    expect(continued).toMatchObject({ status: "continue", record: { nextNodeId: "develop" } });
    expect(switched).toMatchObject({ status: "pause", code: "offline_worker_mismatch" });

    const records = [
      { id: "route_1", assignmentId: assignment.agentRunId, leaseGeneration: 1, sequence: 1, priority: "critical", kind: "route_decision", payload: { routeDecision: decision }, createdAt: "2026-08-08T08:05:00.000Z" },
      { id: "offline_1", assignmentId: assignment.agentRunId, leaseGeneration: 1, sequence: 2, priority: "critical", kind: "offline_stage_result", payload: { record: continued.status === "continue" ? continued.record : null }, createdAt: "2026-08-08T08:05:01.000Z" },
    ] as LoopOutboxRecord[];
    const outbox: LoopOutbox = {
      enqueue: vi.fn(),
      list: vi.fn().mockResolvedValue(records),
      acknowledge: vi.fn().mockResolvedValue(undefined),
      capacity: vi.fn().mockResolvedValue({ canClaim: true, canAppendCritical: true, reason: null }),
    };
    const calls: string[] = [];
    const api = {
      routeDecision: vi.fn(async () => { calls.push("route"); return { accepted: true }; }),
      offlineStageResult: vi.fn(async () => { calls.push("offline"); return { accepted: true }; }),
    } as unknown as LoopAssignmentApi;
    await expect(flushAssignmentOutbox(outbox, api)).resolves.toEqual({ staleAssignmentIds: [], online: true });
    expect(calls).toEqual(["route", "offline"]);
    expect(outbox.acknowledge).toHaveBeenCalledWith(["route_1", "offline_1"]);
  });
});
