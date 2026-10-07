import { describe, expect, it, vi } from "vitest";

import {
  discoverModelCatalog,
  manualModelEntry,
  normalizeModelCatalog,
} from "./model-site-adapters";
import type { ModelSite } from "./local-model-configuration";

const openAiSite: ModelSite = {
  siteId: "0123456789abcdef0123456789abcdef",
  name: "OpenAI compatible",
  adapter: "openai_compatible",
  baseUrl: "https://models.example.com/v1/",
  credentialSource: "environment",
  credentialRef: null,
  status: "untested",
  lastValidatedAt: null,
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("model site adapters", () => {
  it("discovers and normalizes OpenAI-compatible models", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe("https://models.example.com/v1/models");
      return response({ data: [{ id: "coder-v3" }, { id: "coder-v3" }, { id: "reasoner-v2", name: "Reasoner V2" }] });
    });
    const result = await discoverModelCatalog(openAiSite, { fetch });
    expect(result.models).toEqual([
      { modelKey: expect.stringMatching(/^[0-9a-f]{32}$/u), name: "coder-v3", label: "coder-v3", manual: false },
      { modelKey: expect.stringMatching(/^[0-9a-f]{32}$/u), name: "reasoner-v2", label: "Reasoner V2", manual: false },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the Ollama tags protocol and preserves an empty successful directory", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:11434/api/tags");
      return response({ models: [] });
    });
    await expect(discoverModelCatalog({ ...openAiSite, adapter: "ollama", baseUrl: "http://127.0.0.1:11434" }, { fetch })).resolves.toMatchObject({ models: [] });
  });

  it("rejects unsupported discovery and bounded/invalid responses", async () => {
    await expect(discoverModelCatalog({ ...openAiSite, adapter: "codex_environment", baseUrl: null }, { fetch: vi.fn() })).rejects.toThrow(/discovery is not supported/u);
    await expect(discoverModelCatalog(openAiSite, { fetch: vi.fn(async () => response({ data: "bad" })) })).rejects.toThrow(/invalid/u);
    await expect(discoverModelCatalog(openAiSite, { fetch: vi.fn(async () => new Response("x".repeat(2_000_001), { status: 200 })) })).rejects.toThrow(/too large/u);
  });

  it("adds a manual entry for sites without discovery", () => {
    const entry = manualModelEntry(openAiSite, "custom/model");
    expect(entry).toMatchObject({ name: "custom/model", label: "custom/model", manual: true });
    expect(normalizeModelCatalog(openAiSite, [entry, entry]).models).toHaveLength(1);
  });
});
