import { describe, expect, it, vi } from "vitest";
import {
  createProjectEnvironmentSecret,
  listProjectEnvironmentSecrets,
  resolveProjectEnvironmentSecrets,
  rotateProjectEnvironmentSecret,
} from "./project-environment-secrets";

const KEY = Buffer.alloc(32, 9).toString("base64");

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const tx = {
    projectEnvironmentSecret: {
      findUnique: vi.fn(async ({ where }: any) => rows.get(`${where.projectDigest_name.projectDigest}:${where.projectDigest_name.name}`) ?? null),
      findMany: vi.fn(async ({ where }: any = {}) => [...rows.values()].filter((row) => (!where.projectDigest || row.projectDigest === where.projectDigest) && (!where.name?.in || where.name.in.includes(row.name)) && (!where.status || row.status === where.status))),
      create: vi.fn(async ({ data }: any) => { rows.set(`${data.projectDigest}:${data.name}`, data); return data; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.projectDigest_name) throw new Error("Prisma updateMany does not accept composite unique selectors");
        const key = `${where.projectDigest}:${where.name}`;
        const row = rows.get(key);
        if (!row || (where.status && row.status !== where.status)) return { count: 0 };
        rows.set(key, { ...row, ...data });
        return { count: 1 };
      }),
    },
  };
  return { rows, dependencies: { db: { $transaction: async (callback: any) => callback(tx) }, encryptionKey: KEY, now: new Date("2026-09-15T00:00:00.000Z"), assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "owner" }), assertCanWriteProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "owner" }) } as any };
}

describe("project environment secrets", () => {
  it("stores encrypted material and never returns plaintext in management views", async () => {
    const fixtureState = fixture();
    const created = await createProjectEnvironmentSecret({ projectId: "project_1", name: "HT_GIT_TOKEN", value: "secret-value", actorUserId: "user_1" }, fixtureState.dependencies);
    expect(created).toMatchObject({ projectId: "project_1", name: "HT_GIT_TOKEN", status: "configured" });
    expect(created).not.toHaveProperty("value");
    expect(JSON.stringify(fixtureState.rows)).not.toContain("secret-value");
  });

  it("resolves only the requested project variables and decrypts at runtime", async () => {
    const fixtureState = fixture();
    await createProjectEnvironmentSecret({ projectId: "project_1", name: "HT_GIT_TOKEN", value: "secret-value", actorUserId: "user_1" }, fixtureState.dependencies);
    await createProjectEnvironmentSecret({ projectId: "project_2", name: "HT_GIT_TOKEN", value: "other-value", actorUserId: "user_1" }, fixtureState.dependencies);
    await expect(resolveProjectEnvironmentSecrets({ projectId: "project_1", names: ["HT_GIT_TOKEN"] }, fixtureState.dependencies)).resolves.toEqual({ HT_GIT_TOKEN: "secret-value" });
  });

  it("rotating a secret invalidates the old ciphertext and updates its fingerprint", async () => {
    const fixtureState = fixture();
    const first = await createProjectEnvironmentSecret({ projectId: "project_1", name: "HT_GIT_TOKEN", value: "old-value", actorUserId: "user_1" }, fixtureState.dependencies);
    const rotated = await rotateProjectEnvironmentSecret({ projectId: "project_1", name: "HT_GIT_TOKEN", value: "new-value", actorUserId: "user_1" }, fixtureState.dependencies);
    expect(rotated.fingerprint).not.toBe(first.fingerprint);
    await expect(resolveProjectEnvironmentSecrets({ projectId: "project_1", names: ["HT_GIT_TOKEN"] }, fixtureState.dependencies)).resolves.toEqual({ HT_GIT_TOKEN: "new-value" });
  });

  it("lists only metadata and fingerprints", async () => {
    const fixtureState = fixture();
    await createProjectEnvironmentSecret({ projectId: "project_1", name: "HT_GIT_TOKEN", value: "secret-value", actorUserId: "user_1" }, fixtureState.dependencies);
    const listed = await listProjectEnvironmentSecrets({ projectId: "project_1" }, fixtureState.dependencies);
    expect(listed[0]).toMatchObject({ name: "HT_GIT_TOKEN", status: "configured" });
    expect(listed[0]).not.toHaveProperty("encryptedValue");
  });
});
