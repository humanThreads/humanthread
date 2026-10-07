import { beforeEach, describe, expect, it } from "vitest";

import {
  authenticateWorkerPoolSession,
  authenticateWorkerPoolBootstrapToken,
  authenticateWorkerPoolToken,
  createWorkerPool,
  createWorkerPoolSession,
  listWorkerPools,
  revealWorkerPoolToken,
  revokeWorkerPool,
  rotateWorkerPoolToken,
  WORKER_POOL_SESSION_DURATION_MS,
  type WorkerPoolDependencies,
} from "./worker-pools";

const NOW = new Date("2026-08-23T08:00:00.000Z");
const TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

describe("worker pool repository", () => {
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(() => {
    fixture = createFixture();
  });

  it("persists only a bootstrap hash and ciphertext while returning a token at controlled issuance", async () => {
    const created = await createWorkerPool({
      actorUserId: "user_owner",
      displayName: "disaster-gpu",
      maxConcurrentRuns: 2,
      configuration: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
      now: NOW,
    }, fixture.dependencies);

    const stored = fixture.pools.get(created.pool.id);
    expect(created.pool).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{32}$/u),
      ownerUserId: "user_owner",
      displayName: "disaster-gpu",
      status: "active",
      maxConcurrentRuns: 2,
    });
    expect(created.bootstrapToken).toBe("htwp_first_token");
    expect(stored).toMatchObject({
      bootstrapTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      bootstrapTokenEncrypted: expect.any(String),
    });
    expect(JSON.stringify(stored)).not.toContain(created.bootstrapToken);
    expect(created.pool).not.toHaveProperty("bootstrapTokenHash");
    expect(created.pool).not.toHaveProperty("bootstrapTokenEncrypted");
  });

  it("authenticates only the pool owner and uses constant-time token verification", async () => {
    const created = await createPool();

    await expect(authenticateWorkerPoolToken({
      ownerUserId: "user_owner",
      token: created.bootstrapToken,
      now: NOW,
    }, fixture.dependencies)).resolves.toMatchObject({ id: created.pool.id });

    await expect(authenticateWorkerPoolToken({
      ownerUserId: "user_other",
      token: created.bootstrapToken,
      now: NOW,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_unauthorized" });
  });

  it("resolves a bootstrap token to its owning pool without accepting a revoked pool", async () => {
    const created = await createPool();

    await expect(authenticateWorkerPoolBootstrapToken({
      token: created.bootstrapToken,
      now: NOW,
    }, fixture.dependencies)).resolves.toMatchObject({
      id: created.pool.id,
      ownerUserId: "user_owner",
    });

    await revokeWorkerPool({
      poolId: created.pool.id,
      actorUserId: "user_owner",
      now: new Date("2026-08-23T08:10:00.000Z"),
    }, fixture.dependencies);
    await expect(authenticateWorkerPoolBootstrapToken({
      token: created.bootstrapToken,
      now: NOW,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_unauthorized" });
  });

  it("lists only the caller's secret-free Worker pools", async () => {
    const mine = await createPool();
    await createWorkerPool({
      actorUserId: "user_other",
      displayName: "other-pool",
      maxConcurrentRuns: 1,
      configuration: {},
      now: NOW,
    }, fixture.dependencies);

    await expect(listWorkerPools({ actorUserId: "user_owner" }, fixture.dependencies)).resolves.toEqual([
      expect.objectContaining({ id: mine.pool.id, ownerUserId: "user_owner" }),
    ]);
  });

  it("creates and lists a company Pool only within its company resource scope", async () => {
    const created = await createWorkerPool({
      actorUserId: "user_admin",
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
      companyRole: "admin",
      displayName: "company-linux",
      maxConcurrentRuns: 2,
      configuration: {},
      now: NOW,
    }, fixture.dependencies);

    await expect(listWorkerPools({
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
    }, fixture.dependencies)).resolves.toEqual([
      expect.objectContaining({
        id: created.pool.id,
        ownerType: "company",
        ownerUserId: null,
        companyId: "company_1",
      }),
    ]);
    await expect(listWorkerPools({
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_2" },
    }, fixture.dependencies)).resolves.toEqual([]);
  });

  it("projects live capacity and active Linux runs without exposing session credentials", async () => {
    const created = await createPool();
    const session = await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "worker-disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
      now: NOW,
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    }, fixture.dependencies);
    fixture.sessions.get(session.sessionId)!.linuxRuns = [{ id: "agent_run_1" }];

    await expect(listWorkerPools({ actorUserId: "user_owner", now: NOW }, fixture.dependencies)).resolves.toEqual([
      expect.objectContaining({
        id: created.pool.id,
        health: "running",
        capacity: 2,
        currentRuns: 1,
        lastSeenAt: NOW.toISOString(),
        instances: [{
          instanceId: "worker-disaster-1",
          health: "running",
          requestedConcurrency: 2,
          currentRuns: 1,
          lastSeenAt: NOW.toISOString(),
        }],
      }),
    ]);
  });

  it("projects each active Worker instance without exposing its session credential", async () => {
    const created = await createPool();
    const first = await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "human-agent-01",
      capabilities: {},
      requestedConcurrency: 1,
      now: NOW,
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    }, fixture.dependencies);
    const second = await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "human-agent-02",
      capabilities: {},
      requestedConcurrency: 1,
      now: new Date("2026-08-23T08:00:10.000Z"),
      expiresAt: new Date("2026-08-23T09:00:10.000Z"),
    }, fixture.dependencies);
    fixture.sessions.get(second.sessionId)!.linuxRuns = [{ id: "agent_run_1" }];

    const [projection] = await listWorkerPools({ actorUserId: "user_owner", now: new Date("2026-08-23T08:00:20.000Z") }, fixture.dependencies);

    expect(projection?.instances).toEqual([
      expect.objectContaining({ instanceId: "human-agent-01", health: "idle", currentRuns: 0 }),
      expect.objectContaining({ instanceId: "human-agent-02", health: "running", currentRuns: 1 }),
    ]);
    expect(JSON.stringify(projection?.instances)).not.toContain(first.sessionToken);
    expect(JSON.stringify(projection?.instances)).not.toContain(second.sessionToken);
  });

  it("projects Kubernetes replicas as a live count and task group without historical instance names", async () => {
    const created = await createPool();
    await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "ht-agnet-7b9c5d6f8-abcde",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
      now: NOW,
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    }, fixture.dependencies);
    await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "ht-agnet-6a8b4c5d7-fghij",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
      now: new Date("2026-08-23T08:00:10.000Z"),
      expiresAt: new Date("2026-08-23T09:00:10.000Z"),
    }, fixture.dependencies);
    await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "ht-agnet-5f7a3b4c6-klmno",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
      now: new Date("2026-08-23T07:57:00.000Z"),
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    }, fixture.dependencies);

    const [projection] = await listWorkerPools({ actorUserId: "user_owner", now: new Date("2026-08-23T08:00:20.000Z") }, fixture.dependencies);

    expect(projection).toMatchObject({
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      aliveInstanceCount: 2,
      capacity: 2,
      instances: [],
    });
  });

  it("extends a valid session expiry while an idle Worker continues polling", async () => {
    const created = await createPool();
    const session = await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "human-agent-01",
      capabilities: {},
      requestedConcurrency: 1,
      now: NOW,
      expiresAt: new Date("2026-08-23T08:01:00.000Z"),
    }, fixture.dependencies);
    const refreshedAt = new Date("2026-08-23T08:00:30.000Z");

    await authenticateWorkerPoolSession({
      poolId: created.pool.id,
      sessionToken: session.sessionToken,
      now: refreshedAt,
    }, fixture.dependencies);

    expect(fixture.sessions.get(session.sessionId)?.expiresAt).toEqual(
      new Date(refreshedAt.getTime() + WORKER_POOL_SESSION_DURATION_MS),
    );
  });

  it("updates the pool last-seen time when an instance registers", async () => {
    const created = await createPool();
    const registeredAt = new Date("2026-08-23T08:02:00.000Z");

    await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "worker-disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
      now: registeredAt,
      expiresAt: new Date("2026-08-23T09:02:00.000Z"),
    }, fixture.dependencies);

    await expect(listWorkerPools({ actorUserId: "user_owner", now: registeredAt }, fixture.dependencies)).resolves.toEqual([
      expect.objectContaining({
        id: created.pool.id,
        lastSeenAt: registeredAt.toISOString(),
        health: "idle",
        capacity: 2,
        currentRuns: 0,
      }),
    ]);
  });

  it("rejects a deployment pool label that does not match the bootstrap-token-owned Pool", async () => {
    const created = await createPool();

    await expect(createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "worker-disaster-1",
      poolName: "standard-linux",
      capabilities: { gpu: true },
      requestedConcurrency: 1,
      now: NOW,
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_configuration_required" });
  });

  it("requires reauthentication and records a token reveal audit without exposing token material", async () => {
    const created = await createPool();

    await expect(revealWorkerPoolToken({
      poolId: created.pool.id,
      actorUserId: "user_owner",
      reauthenticated: false,
      now: NOW,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_reauthentication_required" });

    await expect(revealWorkerPoolToken({
      poolId: created.pool.id,
      actorUserId: "user_owner",
      reauthenticated: true,
      now: NOW,
    }, fixture.dependencies)).resolves.toEqual({ bootstrapToken: created.bootstrapToken });
    expect(fixture.audits).toContainEqual(expect.objectContaining({
      action: "token_revealed",
      actorUserId: "user_owner",
      metadata: { tokenVersion: 1 },
    }));
    expect(JSON.stringify(fixture.audits)).not.toContain(created.bootstrapToken);
  });

  it("invalidates the old bootstrap token and active sessions when the owner rotates it", async () => {
    const created = await createPool();
    const session = await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "worker-disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
      now: NOW,
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    }, fixture.dependencies);

    const rotated = await rotateWorkerPoolToken({
      poolId: created.pool.id,
      actorUserId: "user_owner",
      reauthenticated: true,
      now: new Date("2026-08-23T08:05:00.000Z"),
    }, fixture.dependencies);

    expect(rotated.bootstrapToken).toBe("htwp_rotated_token");
    await expect(authenticateWorkerPoolToken({
      ownerUserId: "user_owner",
      token: created.bootstrapToken,
      now: NOW,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_unauthorized" });
    await expect(authenticateWorkerPoolToken({
      ownerUserId: "user_owner",
      token: rotated.bootstrapToken,
      now: NOW,
    }, fixture.dependencies)).resolves.toMatchObject({ id: created.pool.id });
    await expect(authenticateWorkerPoolSession({
      poolId: created.pool.id,
      sessionToken: session.sessionToken,
      now: NOW,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_unauthorized" });
    expect(fixture.audits).toContainEqual(expect.objectContaining({
      action: "token_rotated",
      metadata: { tokenVersion: 2 },
    }));
  });

  it("revocation immediately disables bootstrap authentication and existing sessions", async () => {
    const created = await createPool();
    const session = await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "worker-disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
      now: NOW,
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    }, fixture.dependencies);

    await revokeWorkerPool({
      poolId: created.pool.id,
      actorUserId: "user_owner",
      now: new Date("2026-08-23T08:10:00.000Z"),
    }, fixture.dependencies);

    await expect(authenticateWorkerPoolToken({
      ownerUserId: "user_owner",
      token: created.bootstrapToken,
      now: NOW,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_unauthorized" });
    await expect(authenticateWorkerPoolSession({
      poolId: created.pool.id,
      sessionToken: session.sessionToken,
      now: NOW,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_unauthorized" });
    expect(fixture.audits).toContainEqual(expect.objectContaining({ action: "revoked" }));
  });

  it("refreshes a revoked instance session after token rotation without changing pool ownership", async () => {
    const created = await createPool();
    const first = await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "worker-disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
      now: NOW,
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    }, fixture.dependencies);
    await rotateWorkerPoolToken({
      poolId: created.pool.id,
      actorUserId: "user_owner",
      reauthenticated: true,
      now: new Date("2026-08-23T08:05:00.000Z"),
    }, fixture.dependencies);

    const refreshed = await createWorkerPoolSession({
      poolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "worker-disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
      now: new Date("2026-08-23T08:06:00.000Z"),
      expiresAt: new Date("2026-08-23T09:06:00.000Z"),
    }, fixture.dependencies);

    expect(refreshed.sessionId).toBe(first.sessionId);
    expect(refreshed.sessionToken).not.toBe(first.sessionToken);
    await expect(authenticateWorkerPoolSession({
      poolId: created.pool.id,
      sessionToken: first.sessionToken,
      now: NOW,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "worker_pool_unauthorized" });
    await expect(authenticateWorkerPoolSession({
      poolId: created.pool.id,
      sessionToken: refreshed.sessionToken,
      now: NOW,
    }, fixture.dependencies)).resolves.toMatchObject({
      workerPoolId: created.pool.id,
      ownerUserId: "user_owner",
      instanceId: "worker-disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
    });
  });

  async function createPool() {
    return createWorkerPool({
      actorUserId: "user_owner",
      displayName: "disaster-gpu",
      maxConcurrentRuns: 2,
      configuration: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
      now: NOW,
    }, fixture.dependencies);
  }
});

function createFixture() {
  const pools = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const audits: Array<Record<string, unknown>> = [];
  const tokens = ["htwp_first_token", "htwp_rotated_token"];
  const sessionTokens = ["htwps_initial_session_token", "htwps_refreshed_session_token"];
  let sequence = 0;

  const tx = {
    workerPool: {
      findUnique: async ({ where }: { where: {
        id?: string;
        ownerUserId_displayName?: { ownerUserId: string; displayName: string };
        companyId_displayName?: { companyId: string; displayName: string };
      } }) => {
        if (where.id) return pools.get(where.id) ?? null;
        const personal = where.ownerUserId_displayName;
        const company = where.companyId_displayName;
        return [...pools.values()].find((pool) => (
          (personal !== undefined && pool.ownerUserId === personal.ownerUserId && pool.displayName === personal.displayName)
          || (company !== undefined && pool.companyId === company.companyId && pool.displayName === company.displayName)
        )) ?? null;
      },
      findFirst: async ({ where }: { where: {
        id?: string; ownerType?: string; ownerUserId?: string | null; companyId?: string | null;
        status?: string; bootstrapTokenHash?: string; revokedAt?: null;
      } }) => {
        return [...pools.values()].find((pool) => (
          (!where.id || pool.id === where.id)
          && (where.ownerType === undefined || pool.ownerType === where.ownerType)
          && (where.ownerUserId === undefined || pool.ownerUserId === where.ownerUserId)
          && (where.companyId === undefined || pool.companyId === where.companyId)
          && (!where.status || pool.status === where.status)
          && (!where.bootstrapTokenHash || pool.bootstrapTokenHash === where.bootstrapTokenHash)
          && (where.revokedAt === undefined || pool.revokedAt === where.revokedAt)
        )) ?? null;
      },
      findMany: async ({ where }: { where: { ownerType: string; ownerUserId: string | null; companyId: string | null } }) => (
        [...pools.values()].filter((pool) => (
          pool.ownerType === where.ownerType
          && pool.ownerUserId === where.ownerUserId
          && pool.companyId === where.companyId
        )).map((pool) => ({
          ...pool,
          sessions: [...sessions.values()]
            .filter((session) => session.workerPoolId === pool.id)
            .map((session) => ({ ...session, linuxRuns: Array.isArray(session.linuxRuns) ? session.linuxRuns : [] })),
        }))
      ),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        pools.set(String(data.id), { ...data });
        return { ...data };
      },
      updateMany: async ({ where, data }: { where: {
        id: string; ownerType?: string; ownerUserId?: string | null; companyId?: string | null;
        status?: string; tokenVersion?: number; revokedAt?: null;
      }; data: Record<string, unknown> }) => {
        const pool = pools.get(where.id);
        if (!pool
          || (where.ownerType !== undefined && pool.ownerType !== where.ownerType)
          || (where.ownerUserId !== undefined && pool.ownerUserId !== where.ownerUserId)
          || (where.companyId !== undefined && pool.companyId !== where.companyId)
          || (where.status !== undefined && pool.status !== where.status)
          || (where.tokenVersion !== undefined && pool.tokenVersion !== where.tokenVersion)
          || (where.revokedAt !== undefined && pool.revokedAt !== where.revokedAt)
        ) return { count: 0 };
        pools.set(where.id, { ...pool, ...data });
        return { count: 1 };
      },
    },
    workerPoolSession: {
      findUnique: async ({ where }: { where: { id?: string; workerPoolId_instanceId?: { workerPoolId: string; instanceId: string } } }) => {
        if (where.id) return sessions.get(where.id) ?? null;
        const key = where.workerPoolId_instanceId;
        return [...sessions.values()].find((session) => session.workerPoolId === key?.workerPoolId && session.instanceId === key.instanceId) ?? null;
      },
      findFirst: async ({ where }: { where: { workerPoolId: string; tokenHash: string; status: string; expiresAt: { gt: Date } } }) => (
        [...sessions.values()].find((session) => session.workerPoolId === where.workerPoolId
          && session.tokenHash === where.tokenHash
          && session.status === where.status
          && (session.expiresAt as Date).getTime() > where.expiresAt.gt.getTime()) ?? null
      ),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        sessions.set(String(data.id), { ...data });
        return { ...data };
      },
      updateMany: async ({ where, data }: { where: { id?: string; workerPoolId?: string; status?: string }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, session] of sessions) {
          if ((where.id && session.id !== where.id)
            || (where.workerPoolId && session.workerPoolId !== where.workerPoolId)
            || (where.status && session.status !== where.status)) continue;
          sessions.set(id, { ...session, ...data });
          count += 1;
        }
        return { count };
      },
    },
    workerPoolAudit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push({ ...data });
        return { ...data };
      },
    },
  };

  return {
    pools,
    sessions,
    audits,
    dependencies: {
      db: { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) },
      createToken: () => tokens.shift() ?? "htwp_unexpected_token",
      createSessionToken: () => sessionTokens.shift() ?? "htwps_unexpected_session_token",
      tokenEncryptionKey: TOKEN_KEY,
      createId: (parts: readonly string[]) => `a${String(sequence++).padStart(31, "0")}`.replace(/^a/u, "a"),
    } satisfies WorkerPoolDependencies,
  };
}
