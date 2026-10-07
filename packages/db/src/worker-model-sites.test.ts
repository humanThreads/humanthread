import { describe, expect, it } from "vitest";

import {
  createWorkerModelSite,
  listWorkerModelSites,
  revokeWorkerModelSite,
  resolveWorkerModelSiteSecret,
  updateWorkerModelSiteModels,
  type WorkerModelSiteDependencies,
} from "./worker-model-sites";

const TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");

describe("Worker model site repository", () => {
  it("rejects model endpoints that can alter the configured provider route", async () => {
    const dependencies = {
      db: {
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
          workerModelSite: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [], create: async () => { throw new Error("unused"); } },
        }),
      },
      encryptionKey: TOKEN_KEY,
      createId: () => "a".repeat(32),
    } satisfies WorkerModelSiteDependencies;

    for (const endpoint of [
      "https://username:password@codex.example.com/v1",
      "https://codex.example.com/v1?tenant=other",
      "https://codex.example.com/v1#alternate-route",
    ]) {
      await expect(createWorkerModelSite({
        actorUserId: "user_owner",
        name: "credential-url",
        endpoint,
        apiKey: "configured-key",
        now: new Date("2026-08-23T08:00:00.000Z"),
      }, dependencies)).rejects.toMatchObject({ code: "configuration_required" });
    }
  });

  it("updates only the model catalogue and leaves credentials untouched", async () => {
    const row = {
      id: "a".repeat(32),
      ownerType: "personal",
      ownerUserId: "user_owner",
      companyId: null,
      name: "mc",
      provider: "codex",
      endpoint: "https://codex.example.com/v1",
      models: [],
      apiKeyEncrypted: "unchanged-ciphertext",
      status: "active",
      createdAt: new Date("2026-08-23T08:00:00.000Z"),
      updatedAt: new Date("2026-08-23T08:00:00.000Z"),
    };
    const updates: Record<string, unknown>[] = [];
    const dependencies = {
      db: {
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
          workerModelSite: {
            findUnique: async () => null,
            findFirst: async () => row,
            findMany: async () => [row],
            create: async () => { throw new Error("unused"); },
            updateMany: async ({ data }: { data: Record<string, unknown> }) => {
              updates.push(data);
              return { count: 1 };
            },
          },
        }),
      },
      encryptionKey: TOKEN_KEY,
      createId: () => "a".repeat(32),
    } satisfies WorkerModelSiteDependencies;

    const updated = await updateWorkerModelSiteModels({
      actorUserId: "user_owner",
      siteId: row.id,
      models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }],
      now: new Date("2026-09-28T00:00:00.000Z"),
    }, dependencies);

    expect(updated.models).toEqual([{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }]);
    // The catalogue write must not touch the encrypted key or the endpoint.
    expect(updates[0]).toMatchObject({ models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }] });
    expect(updates[0]).not.toHaveProperty("apiKeyEncrypted");
    expect(updates[0]).not.toHaveProperty("endpoint");
  });

  it("rejects an invalid catalogue and an unavailable site on update", async () => {
    const makeDependencies = (found: unknown) => ({
      db: {
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
          workerModelSite: {
            findUnique: async () => null,
            findFirst: async () => found,
            findMany: async () => [],
            create: async () => { throw new Error("unused"); },
            updateMany: async () => ({ count: 1 }),
          },
        }),
      },
      encryptionKey: TOKEN_KEY,
      createId: () => "a".repeat(32),
    }) satisfies WorkerModelSiteDependencies;

    const row = {
      id: "a".repeat(32), ownerType: "personal", ownerUserId: "user_owner", companyId: null,
      name: "mc", provider: "codex", endpoint: "https://codex.example.com/v1", models: [],
      apiKeyEncrypted: "cipher", status: "active",
      createdAt: new Date(), updatedAt: new Date(),
    };

    await expect(updateWorkerModelSiteModels({
      actorUserId: "user_owner",
      siteId: row.id,
      models: [{ name: "bad\u001bmodel", label: "Bad" }],
      now: new Date(),
    }, makeDependencies(row))).rejects.toMatchObject({ code: "configuration_required" });

    await expect(updateWorkerModelSiteModels({
      actorUserId: "user_owner",
      siteId: row.id,
      models: [],
      now: new Date(),
    }, makeDependencies(null))).rejects.toMatchObject({ code: "configuration_required" });
  });

  it("stores the API key encrypted and returns a secret-free model site", async () => {
    const sites = new Map<string, Record<string, unknown>>();
    const dependencies = {
      db: {
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
          workerModelSite: {
            findUnique: async () => null,
            findFirst: async ({ where }: { where: { id: string; ownerUserId: string; provider: string; status: string } }) => {
              const row = sites.get(where.id);
              return row
                && row.ownerUserId === where.ownerUserId
                && row.provider === where.provider
                && row.status === where.status
                ? row
                : null;
            },
            findMany: async ({ where }: { where: { ownerUserId: string } }) => (
              [...sites.values()].filter((site) => site.ownerUserId === where.ownerUserId)
            ),
            create: async ({ data }: { data: Record<string, unknown> }) => {
              sites.set(String(data.id), { ...data });
              return { ...data };
            },
          },
        }),
      },
      encryptionKey: TOKEN_KEY,
      createId: () => "a".repeat(32),
    } satisfies WorkerModelSiteDependencies;

    const created = await createWorkerModelSite({
      actorUserId: "user_owner",
      name: "codex-proxy",
      endpoint: "https://codex.example.com/v1",
      apiKey: "configured-key",
      now: new Date("2026-08-23T08:00:00.000Z"),
    }, dependencies);

    expect(created).toEqual(expect.objectContaining({
      id: "a".repeat(32), ownerUserId: "user_owner", name: "codex-proxy", provider: "codex",
    }));
    expect(created).not.toHaveProperty("apiKey");
    expect(JSON.stringify(sites.get(created.id))).not.toContain("configured-key");
    expect(sites.get(created.id)).toHaveProperty("apiKeyEncrypted");

    await expect(listWorkerModelSites({ actorUserId: "user_owner" }, dependencies)).resolves.toEqual([
      expect.objectContaining({ id: created.id, apiKeyReference: created.id }),
    ]);

    await expect(resolveWorkerModelSiteSecret({
      actorUserId: "user_owner",
      siteId: created.id,
    }, dependencies)).resolves.toEqual({
      id: created.id,
      endpoint: "https://codex.example.com/v1",
      apiKeyReference: created.id,
      apiKey: "configured-key",
    });
  });

  it("refuses to decrypt a model site for another user", async () => {
    const dependencies = {
      db: {
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
          workerModelSite: { findUnique: async () => null, findFirst: async () => null, create: async () => { throw new Error("unused"); } },
        }),
      },
      encryptionKey: TOKEN_KEY,
      createId: () => "a".repeat(32),
    } satisfies WorkerModelSiteDependencies;

    await expect(resolveWorkerModelSiteSecret({
      actorUserId: "user_other",
      siteId: "a".repeat(32),
    }, dependencies)).rejects.toMatchObject({ code: "configuration_required" });
  });

  it("resolves a company model-site key only for the exact company scope", async () => {
    const sites = new Map<string, Record<string, unknown>>();
    const dependencies = createModelSiteFixture(sites);
    const created = await createWorkerModelSite({
      actorUserId: "user_admin",
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
      companyRole: "admin",
      name: "company-codex",
      endpoint: "https://codex.example.com/v1",
      apiKey: "company-configured-key",
      now: new Date("2026-08-23T08:00:00.000Z"),
    }, dependencies);

    await expect(resolveWorkerModelSiteSecret({
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
      siteId: created.id,
    }, dependencies)).resolves.toMatchObject({ apiKey: "company-configured-key" });
    await expect(resolveWorkerModelSiteSecret({
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_2" },
      siteId: created.id,
    }, dependencies)).rejects.toMatchObject({ code: "configuration_required" });
  });

  it("revokes a model site only within the owning scope", async () => {
    const sites = new Map<string, Record<string, unknown>>([
      ["a".repeat(32), {
        id: "a".repeat(32), ownerType: "personal", ownerUserId: "user_owner", companyId: null,
        provider: "codex", status: "active", name: "proxy", endpoint: "https://codex.example.com/v1",
        apiKeyEncrypted: "encrypted", createdAt: new Date("2026-08-23T08:00:00.000Z"), updatedAt: new Date("2026-08-23T08:00:00.000Z"),
      }],
    ]);
    const dependencies = createModelSiteFixture(sites);

    await expect(revokeWorkerModelSite({
      siteId: "a".repeat(32), actorUserId: "user_owner", now: new Date("2026-08-23T08:10:00.000Z"),
    }, dependencies)).resolves.toBeUndefined();
    expect(sites.get("a".repeat(32))).toMatchObject({ status: "revoked" });

    await expect(revokeWorkerModelSite({
      siteId: "a".repeat(32), actorUserId: "user_other", now: new Date("2026-08-23T08:11:00.000Z"),
    }, dependencies)).rejects.toMatchObject({ code: "configuration_required" });
  });
});

function createModelSiteFixture(sites: Map<string, Record<string, unknown>>) {
  return {
    db: {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        workerModelSite: {
          findUnique: async () => null,
          findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            const row = sites.get(String(where.id));
            return row
              && Object.entries(where).every(([key, value]) => row[key] === value)
              ? row
              : null;
          },
          findMany: async ({ where }: { where: Record<string, unknown> }) => (
            [...sites.values()].filter((site) => Object.entries(where).every(([key, value]) => site[key] === value))
          ),
          create: async ({ data }: { data: Record<string, unknown> }) => {
            sites.set(String(data.id), { ...data });
            return { ...data };
          },
          updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const row = sites.get(String(where.id));
            if (!row || !Object.entries(where).every(([key, value]) => row[key] === value)) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          },
        },
      }),
    },
    encryptionKey: TOKEN_KEY,
    createId: () => "a".repeat(32),
  } satisfies WorkerModelSiteDependencies;
}

describe("Worker model site model catalogue", () => {
  it("rejects duplicate model names, control characters and oversized labels", async () => {
    const { normalizeWorkerModelEntries } = await import("./worker-model-sites");

    // A positive assertion first: calling an undefined function would throw for
    // the wrong reason and make the negative assertions below vacuous.
    expect(normalizeWorkerModelEntries([
      { name: "  gpt-5.6-terra  ", label: "  Terra  " },
    ])).toEqual([{ name: "gpt-5.6-terra", label: "Terra" }]);

    expect(() => normalizeWorkerModelEntries([
      { name: "gpt-5.6-terra", label: "Terra" },
      { name: "gpt-5.6-terra", label: "Duplicate" },
    ])).toThrow(/duplicate/iu);

    expect(() => normalizeWorkerModelEntries([
      { name: "bad\u001bmodel", label: "Escape" },
    ])).toThrow(/name is invalid/iu);

    expect(() => normalizeWorkerModelEntries([
      { name: "ok-model", label: "x".repeat(257) },
    ])).toThrow(/label is invalid/iu);
  });

  it("returns an empty catalogue for absent or empty input", async () => {
    const { normalizeWorkerModelEntries } = await import("./worker-model-sites");
    expect(normalizeWorkerModelEntries(undefined)).toEqual([]);
    expect(normalizeWorkerModelEntries([])).toEqual([]);
    expect(normalizeWorkerModelEntries(null)).toEqual([]);
  });

  it("caps the catalogue at 256 entries", async () => {
    const { normalizeWorkerModelEntries } = await import("./worker-model-sites");
    const entries = Array.from({ length: 257 }, (_, index) => ({
      name: `model-${index}`,
      label: `Model ${index}`,
    }));

    // The boundary case must actually return a catalogue; without this the
    // rejection assertion would also pass on a missing implementation.
    expect(normalizeWorkerModelEntries(entries.slice(0, 256))).toHaveLength(256);
    expect(() => normalizeWorkerModelEntries(entries)).toThrow(/too large/iu);
  });
});
