import { describe, expect, it } from "vitest";

import { resolveLocalModelExecution } from "./local-model-routing-runtime";
import type { ModelCatalog, ModelSitesDocument, LoopModelRouting } from "./local-model-configuration";

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
const sites: ModelSitesDocument = { schemaVersion: 2, sites: [site], accountDefault: { siteId: site.siteId, modelKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", reasoningEffort: "high" } };
const catalog: ModelCatalog = { schemaVersion: 1, sites: { [site.siteId]: { refreshedAt: "2026-08-15T08:00:00.000Z", models: [{ modelKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "coder-v3", label: "Coder V3", manual: false }] } } };
const routing: LoopModelRouting = { schemaVersion: 2, loops: {} };
const environmentSite = {
  siteId: "11111111111111111111111111111111",
  name: "Codex environment",
  adapter: "codex_environment" as const,
  baseUrl: null,
  credentialSource: "environment" as const,
  credentialRef: null,
  status: "ready" as const,
  lastValidatedAt: "2026-08-15T08:00:00.000Z",
};
const environmentSites: ModelSitesDocument = {
  schemaVersion: 2,
  sites: [environmentSite],
  accountDefault: { siteId: environmentSite.siteId, modelKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", reasoningEffort: "xhigh" },
};
const environmentCatalog: ModelCatalog = {
  schemaVersion: 1,
  sites: {
    [environmentSite.siteId]: {
      refreshedAt: "2026-08-15T08:00:00.000Z",
      models: [{ modelKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", name: "environment-model", label: "Environment model", manual: true }],
    },
  },
};

describe("local model execution routing", () => {
  it("returns frozen platform reasoning effort with no local model", async () => {
    const result = await resolveLocalModelExecution({
      loopDefinitionId: "loop_1",
      nodeId: "develop",
      provider: "codex",
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      platformReasoningEffort: "xhigh",
      sites: { schemaVersion: 2, sites: [], accountDefault: undefined },
      catalog: { schemaVersion: 1, sites: {} },
      routing,
    });
    expect(result).toEqual(expect.objectContaining({
      reasoningEffort: "xhigh",
      isolationContext: { deploymentOrigin: "http://localhost:3000", userId: "user-1" },
    }));
  });

  it("uses the product reasoning default when no local or platform effort is configured", async () => {
    const result = await resolveLocalModelExecution({
      loopDefinitionId: "loop_1",
      nodeId: "develop",
      provider: "codex",
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      sites: { schemaVersion: 2, sites: [], accountDefault: undefined },
      catalog: { schemaVersion: 1, sites: {} },
      routing,
    });
    expect(result).toEqual(expect.objectContaining({
      reasoningEffort: "high",
      isolationContext: { deploymentOrigin: "http://localhost:3000", userId: "user-1" },
    }));
  });

  it("projects a selected OpenAI-compatible site without exposing the API key", async () => {
    const result = await resolveLocalModelExecution({
      loopDefinitionId: "loop_1",
      nodeId: "develop",
      provider: "codex",
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      sites,
      catalog,
      routing,
    });
    expect(result).toEqual({
      model: "coder-v3",
      reasoningEffort: "high",
      environmentOverrides: { OPENAI_BASE_URL: "https://models.example.com/v1" },
      credentialContext: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user-1",
        credentialRef: site.credentialRef,
      },
      isolationContext: { deploymentOrigin: "http://localhost:3000", userId: "user-1" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("keeps the selected model when a local Codex environment site wins", async () => {
    const result = await resolveLocalModelExecution({
      loopDefinitionId: "loop_1",
      nodeId: "develop",
      provider: "codex",
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      sites: environmentSites,
      catalog: environmentCatalog,
      routing,
    });
    expect(result).toEqual({
      model: "environment-model",
      reasoningEffort: "xhigh",
      credentialContext: null,
      isolationContext: { deploymentOrigin: "http://localhost:3000", userId: "user-1" },
    });
  });

  it("fails closed when an explicit local model is stale", async () => {
    await expect(resolveLocalModelExecution({
      loopDefinitionId: "loop_1",
      nodeId: "develop",
      provider: "codex",
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      sites,
      catalog: { schemaVersion: 1, sites: {} },
      routing,
    })).rejects.toMatchObject({ code: "local_model_configuration_invalid" });
  });
});
