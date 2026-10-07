import { describe, expect, it } from "vitest";

import {
  agentCredentialStatusSchema,
  computeAccountScopeHash,
  computeLocalMd5,
  loopModelRoutingSchema,
  modelCatalogSchema,
  modelSelectionSchema,
  modelSiteSchema,
  resolveLocalModel,
} from "./local-model-configuration";

const site = {
  siteId: "0123456789abcdef0123456789abcdef",
  name: "Company models",
  adapter: "openai_compatible" as const,
  baseUrl: "https://models.example.com/v1",
  credentialSource: "independent" as const,
  credentialRef: "fedcba9876543210fedcba9876543210",
  status: "ready" as const,
  lastValidatedAt: "2026-08-15T08:00:00.000Z",
};

const catalog = {
  schemaVersion: 1 as const,
  sites: {
    [site.siteId]: {
      refreshedAt: "2026-08-15T08:00:00.000Z",
      models: [{
        modelKey: "fedcba9876543210fedcba9876543210",
        name: "custom-coder-v3",
        label: "Custom Coder V3",
      }],
    },
  },
};

describe("local model configuration", () => {
  it("uses fixed-width lowercase MD5 identifiers", () => {
    expect(computeLocalMd5("hello")).toBe("5d41402abc4b2a76b9719d911017c592");
    expect(computeLocalMd5("hello")).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("separates account scopes by deployment origin and user", async () => {
    const first = await computeAccountScopeHash("https://humanthread.example.com/", "user-1");
    const second = await computeAccountScopeHash("https://humanthread.example.com/", "user-2");
    const otherDeployment = await computeAccountScopeHash("https://other.example.com", "user-1");
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).not.toBe(first);
    expect(otherDeployment).not.toBe(first);
  });

  it("rejects unknown fields and malformed local identifiers", () => {
    expect(() => modelSiteSchema.parse({ ...site, siteId: "site_1" })).toThrow();
    expect(() => modelSiteSchema.parse({ ...site, unexpected: true })).toThrow();
    expect(() => modelSiteSchema.parse({
      ...site,
      adapter: "codex_environment",
      baseUrl: null,
    })).toThrow(/must use environment credentials/u);
    expect(() => modelCatalogSchema.parse({ ...catalog, schemaVersion: 2 })).toThrow();
    expect(() => loopModelRoutingSchema.parse({ schemaVersion: 2, loops: {}, unexpected: true })).toThrow();
    expect(() => agentCredentialStatusSchema.parse({
      credentialRef: site.credentialRef,
      kind: "openai_api_key",
      configured: true,
      updatedAt: "not-a-date",
    })).toThrow();
  });

  it("requires a complete local model selection tuple", () => {
    const modelKey = catalog.sites[site.siteId]!.models[0]!.modelKey;
    expect(modelSelectionSchema.parse({ siteId: site.siteId, modelKey, reasoningEffort: "ultra" }))
      .toEqual({ siteId: site.siteId, modelKey, reasoningEffort: "ultra" });
    expect(modelSelectionSchema.safeParse({ siteId: site.siteId, modelKey }).success).toBe(false);
    expect(modelSelectionSchema.safeParse({ siteId: site.siteId, modelKey, reasoningEffort: "HIGH" }).success).toBe(false);
  });

  it("resolves the selected local tuple atomically by precedence", () => {
    const modelKey = catalog.sites[site.siteId]!.models[0]!.modelKey;
    const baseInput = {
      loopDefinitionId: "loop_1",
      nodeId: "develop",
      sites: [site],
      catalog: modelCatalogSchema.parse(catalog),
      accountDefault: { siteId: site.siteId, modelKey, reasoningEffort: "high" as const },
    };

    const nodeRouting = loopModelRoutingSchema.parse({
      schemaVersion: 2,
      loops: {
        loop_1: {
          default: { siteId: site.siteId, modelKey, reasoningEffort: "max" },
          nodes: { develop: { siteId: site.siteId, modelKey, reasoningEffort: "ultra" } },
        },
      },
    });
    const loopRouting = loopModelRoutingSchema.parse({
      schemaVersion: 2,
      loops: { loop_1: { default: { siteId: site.siteId, modelKey, reasoningEffort: "max" }, nodes: {} } },
    });
    const emptyRouting = loopModelRoutingSchema.parse({ schemaVersion: 2, loops: {} });

    expect(resolveLocalModel({ ...baseInput, routing: nodeRouting }).reasoningEffort).toBe("ultra");
    expect(resolveLocalModel({ ...baseInput, routing: loopRouting }).reasoningEffort).toBe("max");
    expect(resolveLocalModel({ ...baseInput, routing: emptyRouting }).reasoningEffort).toBe("high");
    expect(resolveLocalModel({ ...baseInput, accountDefault: undefined, routing: emptyRouting })).toEqual({ source: "provider" });
  });

  it("fails closed for a configured but missing model", () => {
    expect(() => resolveLocalModel({
      loopDefinitionId: "loop_1",
      nodeId: "develop",
      sites: [site],
      catalog: modelCatalogSchema.parse(catalog),
      routing: loopModelRoutingSchema.parse({
        schemaVersion: 2,
        loops: { loop_1: { nodes: { develop: { siteId: site.siteId, modelKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", reasoningEffort: "high" } } } },
      }),
    })).toThrowError(/configured model is unavailable/u);
  });
});
