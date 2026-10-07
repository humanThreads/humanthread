import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  assertProjectRepositoryReady,
  enqueueProjectRepositoryVerification,
  getProjectRepository,
  getProjectRepositoryVerificationTarget,
  saveProjectRepositoryConfiguration,
  saveProjectRepositoryCredentials,
  saveProjectRepositoryVerification,
} from "./project-repositories";
import { replaceProjectEnvironmentSecrets } from "./project-environment-secrets";

const KEY = Buffer.alloc(32, 7).toString("base64");
const PROJECT_ID = "project_1";
const PROJECT_DIGEST = createHash("md5").update(PROJECT_ID).digest("hex");

function fixture(initial?: Partial<Record<string, unknown>>) {
  const project = {
    id: PROJECT_ID,
    version: 3,
    workerRepositoryUrl: "https://github.com/acme/repo.git",
    workerBranchPolicy: { allowedBranches: ["main"] },
    repositoryConfiguration: null,
    ...initial,
  };
  const secrets = new Map<string, Record<string, unknown>>();
  const outboxMessages: Array<Record<string, unknown>> = [];
  const operations: Array<{ type: string; name?: string }> = [];
  const tx = {
    project: {
      findUnique: vi.fn(async () => project),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== project.id || where.version !== project.version) return { count: 0 };
        const nextVersion = typeof data.version === "object" && data.version?.increment
          ? project.version + data.version.increment
          : project.version;
        Object.assign(project, data);
        project.version = nextVersion;
        return { count: 1 };
      }),
    },
    projectEnvironmentSecret: {
      findUnique: vi.fn(async ({ where }: any) => secrets.get(`${where.projectDigest_name.projectDigest}:${where.projectDigest_name.name}`) ?? null),
      findMany: vi.fn(async ({ where }: any = {}) => [...secrets.values()].filter((row) => (!where.projectDigest || row.projectDigest === where.projectDigest) && (!where.name?.in || where.name.in.includes(row.name)) && (!where.status || row.status === where.status))),
      create: vi.fn(async ({ data }: any) => {
        secrets.set(`${data.projectDigest}:${data.name}`, data);
        operations.push({ type: "upsert", name: data.name });
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.projectDigest_name) throw new Error("composite selector is unsupported");
        const key = `${where.projectDigest}:${where.name}`;
        const row = secrets.get(key);
        if (!row || (where.status && row.status !== where.status)) return { count: 0 };
        secrets.set(key, { ...row, ...data });
        operations.push({ type: data.status === "revoked" ? "revoke" : "upsert", name: row.name as string });
        return { count: 1 };
      }),
    },
    outboxMessage: {
      create: vi.fn(async ({ data }: any) => {
        outboxMessages.push(data);
        return data;
      }),
    },
  };
  return {
    project,
    secrets,
    operations,
    outboxMessages,
    dependencies: {
      db: { $transaction: async (callback: any) => callback(tx) },
      encryptionKey: KEY,
      now: new Date("2026-09-28T12:00:00.000Z"),
      createId: (parts: readonly string[]) => createHash("md5").update(parts.join("\0")).digest("hex"),
      assertCanReadProject: vi.fn().mockResolvedValue({ projectId: PROJECT_ID, role: "owner" }),
      assertCanWriteProject: vi.fn().mockResolvedValue({ projectId: PROJECT_ID, role: "owner" }),
    } as any,
  };
}

const baseConfiguration = {
  actorUserId: "user_1",
  projectId: PROJECT_ID,
  expectedVersion: 3,
  repositoryUrl: "https://github.com/acme/repo.git",
  allowedBranches: ["main", "feature/*"],
  provider: "github" as const,
  creationMode: "existing" as const,
  authMode: "project_token" as const,
};

describe("project repository persistence", () => {
  it("saves non-sensitive provider metadata and starts verification pending", async () => {
    const state = fixture();
    await expect(saveProjectRepositoryConfiguration(baseConfiguration, state.dependencies)).resolves.toEqual({ projectId: PROJECT_ID, version: 4 });
    expect(state.project).toMatchObject({
      workerRepositoryUrl: "https://github.com/acme/repo.git",
      workerBranchPolicy: { allowedBranches: ["main", "feature/*"] },
      repositoryConfiguration: {
        schemaVersion: 1,
        provider: "github",
        creationMode: "existing",
        authMode: "project_token",
        verification: { status: "pending_verification", failureCode: null },
      },
    });
    expect(JSON.stringify(state.project)).not.toContain("token-value");
  });

  it("rejects private repository hosts outside the configured allowlist before persistence", async () => {
    const state = fixture();
    await expect(saveProjectRepositoryConfiguration({
      ...baseConfiguration,
      repositoryUrl: "https://git.internal.example/acme/repo.git",
      provider: "private",
      privateBaseUrl: "https://git.internal.example",
    }, { ...state.dependencies, privateHostAllowlist: ["git.allowed.example"] })).rejects.toMatchObject({ code: "private_host_not_allowed" });
    expect(state.project.version).toBe(3);
  });

  it("surfaces project version conflicts", async () => {
    const state = fixture({ version: 4 });
    await expect(saveProjectRepositoryConfiguration(baseConfiguration, state.dependencies)).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("stores encrypted token credentials and revokes the password slot after a mode switch", async () => {
    const state = fixture({
      repositoryConfiguration: {
        schemaVersion: 1,
        provider: "private",
        creationMode: "existing",
        privateBaseUrl: "https://git.example.com",
        privateWebUrl: null,
        privateTokenHelpUrl: null,
        authMode: "account_password",
        verification: { status: "passed", verifiedAt: null, defaultBranch: "main", headSha: null, failureCode: null, apiChecked: false },
      },
    });
    await replaceProjectEnvironmentSecrets({
      projectId: PROJECT_ID,
      actorUserId: "user_1",
      values: { HT_GIT_USERNAME: "deploy", HT_GIT_PASSWORD: "old-password" },
      namesToRevoke: [],
    }, state.dependencies);
    state.project.repositoryConfiguration = { ...(state.project.repositoryConfiguration as object), authMode: "project_token", verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false } };

    await expect(saveProjectRepositoryCredentials({
      actorUserId: "user_1",
      projectId: PROJECT_ID,
      authMode: "project_token",
      username: "",
      secret: "new-token",
    }, state.dependencies)).resolves.toMatchObject({ credentialNames: ["HT_GIT_TOKEN", "HT_GIT_USERNAME"] });

    expect([...state.secrets.values()].map((row) => ({ name: row.name, status: row.status }))).toEqual(expect.arrayContaining([
      { name: "HT_GIT_PASSWORD", status: "revoked" },
      { name: "HT_GIT_TOKEN", status: "active" },
      { name: "HT_GIT_USERNAME", status: "active" },
    ]));
    expect(state.operations.findIndex((operation) => operation.name === "HT_GIT_TOKEN")).toBeLessThan(state.operations.findIndex((operation) => operation.name === "HT_GIT_PASSWORD" && operation.type === "revoke"));
    expect(JSON.stringify(state.secrets.values())).not.toContain("new-token");
    expect(JSON.stringify(state.secrets.values())).not.toContain("old-password");
  });

  it("returns metadata without plaintext credentials", async () => {
    const state = fixture();
    await saveProjectRepositoryConfiguration(baseConfiguration, state.dependencies);
    await saveProjectRepositoryCredentials({ actorUserId: "user_1", projectId: PROJECT_ID, authMode: "project_token", username: "", secret: "secret-token" }, state.dependencies);
    const result = await getProjectRepository({ projectId: PROJECT_ID, actorUserId: "user_1" }, state.dependencies);
    expect(result).toMatchObject({ repositoryUrl: "https://github.com/acme/repo.git", branchPolicy: { allowedBranches: ["main", "feature/*"] }, credentials: expect.any(Array) });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("updates verification state with optimistic concurrency and refuses unverified Worker readiness", async () => {
    const state = fixture({
      repositoryConfiguration: {
        schemaVersion: 1,
        provider: "github",
        creationMode: "existing",
        privateBaseUrl: null,
        privateWebUrl: null,
        privateTokenHelpUrl: null,
        authMode: "project_token",
        verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false },
      },
    });
    await replaceProjectEnvironmentSecrets({
      projectId: PROJECT_ID,
      actorUserId: "user_1",
      values: { HT_GIT_USERNAME: "x-access-token", HT_GIT_TOKEN: "token-value" },
      namesToRevoke: [],
    }, state.dependencies);
    await expect(assertProjectRepositoryReady({ projectId: PROJECT_ID }, state.dependencies)).rejects.toMatchObject({ code: "repository_credential_unverified" });

    await expect(saveProjectRepositoryVerification({
      projectId: PROJECT_ID,
      expectedVersion: 3,
      verification: { status: "passed", verifiedAt: "2026-09-28T12:00:00.000Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
    }, state.dependencies)).resolves.toEqual({ projectId: PROJECT_ID, version: 4 });
    await expect(assertProjectRepositoryReady({ projectId: PROJECT_ID }, state.dependencies)).resolves.toMatchObject({ legacy: false, secretNames: ["HT_GIT_TOKEN", "HT_GIT_USERNAME"] });
  });

  it("queues an asynchronous verification job without persisting credentials in the payload", async () => {
    const repositoryConfiguration = {
      schemaVersion: 1,
      provider: "github",
      creationMode: "existing",
      privateBaseUrl: null,
      privateWebUrl: null,
      privateTokenHelpUrl: null,
      authMode: "project_token",
      verification: { status: "passed", verifiedAt: "2026-09-28T11:00:00.000Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
    };
    const state = fixture({ repositoryConfiguration });

    await expect(enqueueProjectRepositoryVerification({
      actorUserId: "user_1",
      projectId: PROJECT_ID,
      expectedDefaultBranch: "main",
    }, state.dependencies)).resolves.toEqual({ projectId: PROJECT_ID, version: 4, status: "pending_verification" });

    expect(state.project).toMatchObject({
      version: 4,
      repositoryConfiguration: {
        ...repositoryConfiguration,
        verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false },
      },
    });
    expect(state.outboxMessages).toEqual([
      expect.objectContaining({
        topic: "repository.verification.requested",
        aggregateType: "project",
        aggregateId: PROJECT_ID,
        payload: { projectId: PROJECT_ID, expectedVersion: 4, expectedDefaultBranch: "main" },
      }),
    ]);
    expect(JSON.stringify(state.outboxMessages)).not.toContain("token");
    expect(JSON.stringify(state.outboxMessages)).not.toContain("password");
  });

  it("resets verification to pending before credential rotation", async () => {
    const repositoryConfiguration = {
      schemaVersion: 1,
      provider: "github",
      creationMode: "existing",
      privateBaseUrl: null,
      privateWebUrl: null,
      privateTokenHelpUrl: null,
      authMode: "project_token",
      verification: { status: "passed", verifiedAt: "2026-09-28T11:00:00.000Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
    };
    const state = fixture({ repositoryConfiguration });

    await saveProjectRepositoryCredentials({
      actorUserId: "user_1",
      projectId: PROJECT_ID,
      authMode: "project_token",
      username: "",
      secret: "replacement-token",
    }, state.dependencies);

    expect(state.project).toMatchObject({
      version: 4,
      repositoryConfiguration: {
        verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false },
      },
    });
  });

  it("does not reset the verified state when credential replacement fails", async () => {
    const repositoryConfiguration = {
      schemaVersion: 1,
      provider: "github",
      creationMode: "existing",
      privateBaseUrl: null,
      privateWebUrl: null,
      privateTokenHelpUrl: null,
      authMode: "project_token",
      verification: { status: "passed", verifiedAt: "2026-09-28T11:00:00.000Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
    };
    const state = fixture({ repositoryConfiguration });
    const originalCreate = state.dependencies.db.$transaction;
    state.dependencies.db.$transaction = async (callback: any) => callback({
      ...await (async () => {
        const tx = await originalCreate((value: any) => Promise.resolve(value));
        return tx;
      })(),
      projectEnvironmentSecret: {
        findUnique: async () => null,
        findMany: async () => [],
        create: async () => { throw new Error("credential write failed"); },
        updateMany: async () => ({ count: 0 }),
      },
    });

    await expect(saveProjectRepositoryCredentials({
      actorUserId: "user_1",
      projectId: PROJECT_ID,
      authMode: "project_token",
      username: "",
      secret: "replacement-token",
    }, state.dependencies)).rejects.toThrow("credential write failed");

    expect(state.project).toMatchObject({
      version: 3,
      repositoryConfiguration: { verification: { status: "passed" } },
    });
  });

  it("loads only the exact version and non-sensitive verification target", async () => {
    const repositoryConfiguration = {
      schemaVersion: 1,
      provider: "github",
      creationMode: "existing",
      privateBaseUrl: null,
      privateWebUrl: null,
      privateTokenHelpUrl: null,
      authMode: "project_token",
      verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false },
    };
    const state = fixture({ version: 4, repositoryConfiguration });

    await expect(getProjectRepositoryVerificationTarget({ projectId: PROJECT_ID, expectedVersion: 4 }, state.dependencies)).resolves.toEqual({
      projectId: PROJECT_ID,
      version: 4,
      repositoryUrl: "https://github.com/acme/repo.git",
      configuration: repositoryConfiguration,
    });
    await expect(getProjectRepositoryVerificationTarget({ projectId: PROJECT_ID, expectedVersion: 3 }, state.dependencies)).resolves.toBeNull();
    expect(state.dependencies.assertCanWriteProject).not.toHaveBeenCalled();
  });

  it("keeps legacy projects without the new configuration usable", async () => {
    const state = fixture({ repositoryConfiguration: null });
    await expect(assertProjectRepositoryReady({ projectId: PROJECT_ID }, state.dependencies)).resolves.toEqual({ legacy: true, repositoryUrl: "https://github.com/acme/repo.git", branchPolicy: { allowedBranches: ["main"] }, secretNames: [] });
  });
});
