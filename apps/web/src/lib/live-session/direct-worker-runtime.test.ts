import { describe, expect, it, vi } from "vitest";

import { resolveDirectWorkerRuntime } from "./direct-worker-runtime";

describe("direct Worker runtime", () => {
  it("resolves the project task-development Worker model configuration", async () => {
    const loadProject = vi.fn().mockResolvedValue({
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
    });
    const loadBinding = vi.fn().mockResolvedValue({
      workerStageConfigurations: {
        develop: {
          siteId: "a".repeat(32),
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
        },
      },
    });
    const resolveModelSiteSecret = vi.fn().mockResolvedValue({
      id: "a".repeat(32),
      endpoint: "https://model.example.com/v1",
      apiKeyReference: "a".repeat(32),
      apiKey: "model-key",
    });

    await expect(resolveDirectWorkerRuntime("project_1", {
      loadProject,
      loadBinding,
      resolveModelSiteSecret,
    })).resolves.toEqual({
      endpoint: "https://model.example.com/v1",
      apiKey: "model-key",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    expect(loadBinding).toHaveBeenCalledWith("project_1");
    expect(resolveModelSiteSecret).toHaveBeenCalledWith({
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
      siteId: "a".repeat(32),
    });
  });

  it("fails with a stable reason when the project has no Worker model configuration", async () => {
    await expect(resolveDirectWorkerRuntime("project_1", {
      loadProject: vi.fn().mockResolvedValue({
        ownerType: "company",
        ownerUserId: null,
        companyId: "company_1",
      }),
      loadBinding: vi.fn().mockResolvedValue(null),
      resolveModelSiteSecret: vi.fn(),
    })).rejects.toMatchObject({ code: "worker_direct_runtime_missing" });
  });
});

describe("Direct worker runtime model selection", () => {
  it("prefers the session-level selection over the project default", async () => {
    const resolveModelSiteSecret = vi.fn(async () => ({
      id: "b".repeat(32),
      endpoint: "https://selected.example.com",
      apiKeyReference: "b".repeat(32),
      apiKey: "selected-key",
    }));

    const runtime = await resolveDirectWorkerRuntime(
      "project_1",
      {
        loadProject: async () => ({ ownerType: "company", ownerUserId: null, companyId: "company_1" }),
        loadBinding: async () => ({
          workerStageConfigurations: {
            "agent-action-6": { siteId: "a".repeat(32), model: "default-model", reasoningEffort: "high" },
          },
        }),
        resolveModelSiteSecret,
      },
      { siteId: "b".repeat(32), model: "selected-model", reasoningEffort: "medium" },
    );

    expect(runtime).toEqual({
      endpoint: "https://selected.example.com",
      apiKey: "selected-key",
      model: "selected-model",
      reasoningEffort: "medium",
    });
    expect(resolveModelSiteSecret).toHaveBeenCalledWith(expect.objectContaining({ siteId: "b".repeat(32) }));
  });

  it("falls back to the project default when no selection is given", async () => {
    const runtime = await resolveDirectWorkerRuntime("project_1", {
      loadProject: async () => ({ ownerType: "company", ownerUserId: null, companyId: "company_1" }),
      loadBinding: async () => ({
        workerStageConfigurations: {
          "agent-action-6": { siteId: "a".repeat(32), model: "default-model", reasoningEffort: "high" },
        },
      }),
      resolveModelSiteSecret: async () => ({
        id: "a".repeat(32),
        endpoint: "https://default.example.com",
        apiKeyReference: "a".repeat(32),
        apiKey: "default-key",
      }),
    }, null);

    expect(runtime.model).toBe("default-model");
  });

  it("orders stages by key so the default does not depend on object iteration order", async () => {
    const runtime = await resolveDirectWorkerRuntime("project_1", {
      loadProject: async () => ({ ownerType: "company", ownerUserId: null, companyId: "company_1" }),
      loadBinding: async () => ({
        workerStageConfigurations: {
          zeta: { siteId: "a".repeat(32), model: "later", reasoningEffort: "low" },
          alpha: { siteId: "a".repeat(32), model: "earlier", reasoningEffort: "high" },
        },
      }),
      resolveModelSiteSecret: async () => ({
        id: "a".repeat(32),
        endpoint: "https://default.example.com",
        apiKeyReference: "a".repeat(32),
        apiKey: "key",
      }),
    }, null);

    expect(runtime.model).toBe("earlier");
  });
});

describe("Direct worker runtime with an explicit selection and no stage config", () => {
  it("resolves the selection without consulting the project stages", async () => {
    const loadBinding = vi.fn().mockResolvedValue({ workerStageConfigurations: null });
    const runtime = await resolveDirectWorkerRuntime("project_1", {
      loadProject: async () => ({ ownerType: "company", ownerUserId: null, companyId: "company_1" }),
      loadBinding,
      resolveModelSiteSecret: async () => ({
        id: "b".repeat(32),
        endpoint: "https://selected.example.com",
        apiKeyReference: "b".repeat(32),
        apiKey: "selected-key",
      }),
    }, { siteId: "b".repeat(32), model: "picked", reasoningEffort: "low" });

    expect(runtime.model).toBe("picked");
    expect(loadBinding).toHaveBeenCalled();
  });
});
