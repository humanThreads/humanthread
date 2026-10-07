import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutomationGrant,
  fingerprintAutomationGrant,
  listProjectAutomationGrants,
  revokeAutomationGrant,
  snapshotBindingGrants,
} from "./automation-grants";

const now = new Date("2026-07-30T16:00:00.000Z");

const grant = {
  id: "grant_1",
  spaceId: "space_1",
  projectId: "project_1",
  bindingIds: ["binding_1"],
  nodeKeys: ["code"],
  executionPlanes: ["local"],
  deviceIds: ["device_1"],
  workerIds: ["worker_1"],
  agentProfileIds: ["profile_1"],
  providers: ["codex"],
  permission: "workspace_full",
  workspaceBindingIds: ["workspace_binding_1"],
  allowedRelativePathPrefixes: ["."],
  tools: ["shell", "filesystem"],
  commandCategories: ["test", "build"],
  operationTypes: ["workspace.write"],
  networkTargets: [],
  recipients: [],
  credentialRefs: [],
  allowProduction: false,
  limits: {
    maxConcurrency: 1,
    maxDurationMs: 3_600_000,
    maxTokens: 100_000,
    maxCostUsd: 10,
    maxToolCalls: 1_000,
  },
  policyVersion: "policy_v1",
  status: "active",
  confirmedAt: now.toISOString(),
  expiresAt: "2026-07-31T16:00:00.000Z",
  revokedAt: null,
} as const;

describe("automation grant lifecycle", () => {
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(() => {
    fixture = createFixture();
  });

  it("requires the exact explicit confirmation fingerprint for workspace_full", async () => {
    await expect(createAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "create_grant_1",
      grant,
      confirmationFingerprint: "",
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.authorizeManageAutomation).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
    expect(fixture.tx.automationGrant.create).not.toHaveBeenCalled();
  });

  it("creates one normalized grant for a repeated command", async () => {
    const unordered = {
      ...grant,
      tools: ["shell", "filesystem", "shell"],
      commandCategories: ["test", "build", "test"],
    };
    const input = {
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "create_grant_1",
      grant: unordered,
      confirmationFingerprint: fingerprintAutomationGrant(unordered),
    };

    const first = await createAutomationGrant(input, fixture.dependencies);
    const repeated = await createAutomationGrant(input, fixture.dependencies);

    expect(repeated).toEqual(first);
    expect(fixture.tx.automationGrant.create).toHaveBeenCalledOnce();
    expect(fixture.persisted.get("grant_1")?.scope).toMatchObject({
      tools: ["filesystem", "shell"],
      commandCategories: ["build", "test"],
    });
  });

  it("persists a grant with no Workspace scope", async () => {
    const workspaceFree = {
      ...grant,
      id: "grant_none",
      bindingIds: [],
      nodeKeys: [],
      deviceIds: [],
      workerIds: [],
      agentProfileIds: [],
      providers: [],
      permission: "none",
      workspaceBindingIds: [],
      allowedRelativePathPrefixes: [],
      tools: [],
      commandCategories: [],
      operationTypes: [],
    } as const;

    await expect(createAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "create_grant_none",
      grant: workspaceFree,
      confirmationFingerprint: fingerprintAutomationGrant(workspaceFree),
    }, fixture.dependencies)).resolves.toMatchObject({
      id: "grant_none",
      status: "active",
    });
    expect(fixture.persisted.get("grant_none")?.scope).toMatchObject({
      permission: "none",
      workspaceBindingIds: [],
      allowedRelativePathPrefixes: [],
    });
  });

  it("rejects a bound grant without executable node scope", async () => {
    const missingNodes = { ...grant, nodeKeys: [] };

    await expect(createAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "create_grant_without_nodes",
      grant: missingNodes,
      confirmationFingerprint: fingerprintAutomationGrant(missingNodes),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.automationGrant.create).not.toHaveBeenCalled();
  });

  it("rejects node scope outside the selected binding graph", async () => {
    const unknownNode = { ...grant, nodeKeys: ["other_loop_node"] };

    await expect(createAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "create_grant_with_unknown_node",
      grant: unknownNode,
      confirmationFingerprint: fingerprintAutomationGrant(unknownNode),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.automationGrant.create).not.toHaveBeenCalled();
  });

  it("rejects execution planes that do not cover the selected nodes", async () => {
    const missingLocalPlane = { ...grant, executionPlanes: ["platform"] };

    await expect(createAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "create_grant_without_local_plane",
      grant: missingLocalPlane,
      confirmationFingerprint: fingerprintAutomationGrant(missingLocalPlane),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.automationGrant.create).not.toHaveBeenCalled();
  });

  it("rejects grants confirmed against an obsolete policy version", async () => {
    const obsoletePolicy = { ...grant, policyVersion: "loop_policy_v1" };

    await expect(createAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "create_grant_with_obsolete_policy",
      grant: obsoletePolicy,
      confirmationFingerprint: fingerprintAutomationGrant(obsoletePolicy),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.automationGrant.create).not.toHaveBeenCalled();
  });

  it("rejects a grant whose declared Space does not own the Project", async () => {
    const mismatched = { ...grant, spaceId: "space_2" };

    await expect(createAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "create_cross_space_grant",
      grant: mismatched,
      confirmationFingerprint: fingerprintAutomationGrant(mismatched),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.automationGrant.create).not.toHaveBeenCalled();
  });

  it("revokes idempotently and excludes the grant from new Run snapshots", async () => {
    fixture.seed(grant);

    await revokeAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      grantId: "grant_1",
      commandId: "revoke_grant_1",
    }, fixture.dependencies);
    await revokeAutomationGrant({
      actorUserId: "user_1",
      projectId: "project_1",
      grantId: "grant_1",
      commandId: "revoke_grant_2",
    }, fixture.dependencies);

    await expect(snapshotBindingGrants({ bindingId: "binding_1", now }, fixture.dependencies)).resolves.toEqual([]);
    expect(fixture.tx.automationGrant.updateMany).toHaveBeenCalledOnce();
  });

  it("lists only the authorized Project and reports live revocation", async () => {
    fixture.seed({ ...grant, status: "revoked", revokedAt: now.toISOString() });

    await expect(listProjectAutomationGrants({
      actorUserId: "user_1",
      projectId: "project_1",
      now,
    }, fixture.dependencies)).resolves.toEqual([
      expect.objectContaining({ id: "grant_1", status: "revoked", revokedAt: now.toISOString() }),
    ]);
    expect(fixture.authorizeReadAutomation).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
  });

  it("excludes missing, expired, and cross-Project grants from a binding snapshot", async () => {
    fixture.binding.automationGrantIds = ["missing", "expired", "cross_project", "grant_1"];
    fixture.seed({ ...grant, id: "expired", expiresAt: now.toISOString() });
    fixture.seed({ ...grant, id: "cross_project", projectId: "project_2" });
    fixture.seed(grant);

    await expect(snapshotBindingGrants({ bindingId: "binding_1", now }, fixture.dependencies)).resolves.toEqual([
      expect.objectContaining({ id: "grant_1", projectId: "project_1" }),
    ]);
  });
});

function createFixture() {
  type Persisted = {
    id: string;
    projectId: string;
    status: string;
    scope: unknown;
    expiresAt: Date | null;
    revokedAt: Date | null;
    version: number;
    [key: string]: unknown;
  };
  const receipts = new Map<string, { status: string; result?: unknown }>();
  const aggregateSequences = new Map<string, number>();
  const persisted = new Map<string, Persisted>();
  const binding = {
    id: "binding_1",
    projectId: "project_1",
    automationGrantIds: ["grant_1"],
    activeVersion: {
      status: "published",
      graph: {
        schemaVersion: 1,
        inputSchema: {},
        outputSchema: {},
        limits: { maxStages: 3, maxRepeatCount: 1 },
        nodes: [
          { key: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
          {
            key: "code",
            label: "Code",
            type: "agent_action",
            executionTarget: "local",
            offlinePolicy: "online_required",
            promptTemplate: "Implement the task",
          },
          { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
        ],
        edges: [
          { id: "start_code", source: "start", target: "code", kind: "normal", outcome: "success" },
          { id: "code_end", source: "code", target: "end", kind: "normal", outcome: "success" },
        ],
      },
    },
  };
  const tx = {
    commandReceipt: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const receipt = receipts.get(where.id);
        return receipt ? { id: where.id, ...receipt, result: receipt.result ?? null } : null;
      }),
      create: vi.fn(async ({ data }: { data: { id: string; status: string } }) => {
        receipts.set(data.id, { status: data.status });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string; result: unknown } }) => {
        receipts.set(where.id, { status: data.status, result: data.result });
      }),
    },
    orchestrationAggregateSequence: {
      upsert: vi.fn(async ({ where, create }: {
        where: { aggregateType_aggregateId: { aggregateType: string; aggregateId: string } };
        create: { sequence: number };
      }) => {
        const aggregate = where.aggregateType_aggregateId;
        const key = `${aggregate.aggregateType}:${aggregate.aggregateId}`;
        const sequence = (aggregateSequences.get(key) ?? create.sequence - 1) + 1;
        aggregateSequences.set(key, sequence);
        return { sequence };
      }),
    },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    project: {
      findUnique: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_1" }),
    },
    projectLoopBinding: {
      findUnique: vi.fn(async () => binding),
      findMany: vi.fn(async () => [binding]),
    },
    automationGrant: {
      create: vi.fn(async ({ data }: { data: Persisted }) => {
        persisted.set(data.id, data);
        return data;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => persisted.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { projectId?: string; id?: { in: string[] } } }) => {
        return [...persisted.values()].filter((row) => (
          (where.projectId === undefined || row.projectId === where.projectId)
          && (where.id === undefined || where.id.in.includes(row.id))
        ));
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
        const row = persisted.get(where.id);
        if (!row || row.version !== where.version || row.status === "revoked") return { count: 0 };
        persisted.set(where.id, { ...row, ...data, version: row.version + 1 });
        return { count: 1 };
      }),
    },
  };
  const authorizeManageAutomation = vi.fn().mockResolvedValue({ role: "maintainer" });
  const authorizeReadAutomation = vi.fn().mockResolvedValue({ role: "maintainer" });
  return {
    tx,
    binding,
    persisted,
    authorizeManageAutomation,
    authorizeReadAutomation,
    dependencies: {
      now: () => now,
      authorizeManageAutomation,
      authorizeReadAutomation,
      db: { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) },
    },
    seed(value: typeof grant | (Omit<typeof grant, "id" | "status" | "revokedAt" | "projectId" | "expiresAt"> & {
      id: string;
      status?: "active" | "revoked";
      revokedAt?: string | null;
      projectId?: string;
      expiresAt?: string | null;
    })) {
      const candidate = { ...grant, ...value };
      persisted.set(candidate.id, {
        id: candidate.id,
        projectId: candidate.projectId,
        status: candidate.status,
        scope: candidate,
        expiresAt: candidate.expiresAt === null ? null : new Date(candidate.expiresAt),
        revokedAt: candidate.revokedAt === null ? null : new Date(candidate.revokedAt),
        version: 1,
      });
    },
  };
}
