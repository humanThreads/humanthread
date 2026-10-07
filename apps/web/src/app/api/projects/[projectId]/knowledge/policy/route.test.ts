import { beforeEach, describe, expect, it, vi } from "vitest";

import { readKnowledgePolicySettings, updateKnowledgePolicySettings } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET, PATCH } from "./route";

vi.mock("@humanthread/db", () => ({
  readKnowledgePolicySettings: vi.fn(),
  updateKnowledgePolicySettings: vi.fn(),
}));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const policy = {
  projectId: "project_1",
  projectDigest: "a".repeat(32),
  autoPublishEnabled: false,
  minimumConfidence: 0.9,
  allowedSourceTypes: [],
  allowedEntryTypes: [],
  allowAutomaticDelete: false,
  allowAutomaticExpire: false,
  allowAutomaticSupersede: false,
  scheduleTimezone: "Asia/Shanghai",
  scheduleRule: null,
  fullRebuildEvery: 10,
  subscribeSpaceKnowledge: false,
  version: 1,
  updatedAt: new Date("2026-09-23T00:00:00.000Z"),
};

describe("/api/projects/:projectId/knowledge/policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "web_session",
      webSessionId: "a".repeat(32),
    });
  });

  it("reads the policy through the authenticated actor", async () => {
    vi.mocked(readKnowledgePolicySettings).mockResolvedValue(policy);

    const response = await GET(new Request("http://localhost/api/projects/project_1/knowledge/policy"), {
      params: Promise.resolve({ projectId: "project_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, policy: { version: 1 } });
    expect(readKnowledgePolicySettings).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
  });

  it("updates automatic review settings", async () => {
    vi.mocked(updateKnowledgePolicySettings).mockResolvedValue({
      ...policy,
      autoPublishEnabled: true,
      allowedSourceTypes: ["knowledge_architecture"],
      allowedEntryTypes: ["rule"],
      version: 2,
    });

    const response = await PATCH(new Request("http://localhost/api/projects/project_1/knowledge/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 1,
        autoPublishEnabled: true,
        minimumConfidence: 0.95,
        allowedSourceTypes: ["knowledge_architecture"],
        allowedEntryTypes: ["rule"],
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(200);
    expect(updateKnowledgePolicySettings).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      expectedVersion: 1,
      autoPublishEnabled: true,
      minimumConfidence: 0.95,
      allowedSourceTypes: ["knowledge_architecture"],
      allowedEntryTypes: ["rule"],
    });
    await expect(response.json()).resolves.toMatchObject({ ok: true, policy: { autoPublishEnabled: true } });
  });

  it("maps a concurrent policy change to 409", async () => {
    vi.mocked(updateKnowledgePolicySettings).mockRejectedValue(
      Object.assign(new Error("Knowledge policy changed while updating"), { code: "version_conflict" }),
    );

    const response = await PATCH(new Request("http://localhost/api/projects/project_1/knowledge/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 1,
        autoPublishEnabled: false,
        minimumConfidence: 0.9,
        allowedSourceTypes: [],
        allowedEntryTypes: [],
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(409);
  });

  it("rejects an invalid confidence before dispatch", async () => {
    const response = await PATCH(new Request("http://localhost/api/projects/project_1/knowledge/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 1,
        autoPublishEnabled: true,
        minimumConfidence: 2,
        allowedSourceTypes: ["knowledge_architecture"],
        allowedEntryTypes: ["rule"],
      }),
    }), { params: Promise.resolve({ projectId: "project_1" }) });

    expect(response.status).toBe(400);
    expect(updateKnowledgePolicySettings).not.toHaveBeenCalled();
  });
});
