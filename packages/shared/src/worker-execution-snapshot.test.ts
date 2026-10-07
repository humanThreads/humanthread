import { describe, expect, it } from "vitest";

import { workerExecutionSnapshotSchema } from "./worker-execution-snapshot";

const snapshot = {
  version: 1,
  workerPoolId: "a".repeat(32),
  repository: {
    url: "https://github.com/humanthread/disaster.git",
    branch: "main",
    branchPolicy: { allowedBranches: ["main", "2026-HUMANTHR1100008"] },
  },
  model: {
    provider: "codex",
    siteId: "b".repeat(32),
    endpoint: "https://codex.example.com/v1",
    apiKeyReference: "c".repeat(32),
    model: "gpt-5.2-codex",
    reasoningEffort: "high",
  },
  resources: { gpu: true, unityBuild: true },
  deliveryPolicy: { requireGitDelivery: true },
  grants: [],
  logPolicy: { redactCredentials: true },
};

describe("worker execution snapshot", () => {
  it("requires a configured endpoint, key reference, model, and reasoning effort", () => {
    expect(workerExecutionSnapshotSchema.parse(snapshot)).toMatchObject({
      workerPoolId: "a".repeat(32),
      model: {
        endpoint: "https://codex.example.com/v1",
        model: "gpt-5.2-codex",
        reasoningEffort: "high",
      },
    });
    expect(workerExecutionSnapshotSchema.parse({ ...snapshot, workerInstanceId: "worker-01" })).toMatchObject({
      workerInstanceId: "worker-01",
    });
    expect(workerExecutionSnapshotSchema.safeParse({
      ...snapshot,
      model: { ...snapshot.model, reasoningEffort: undefined },
    }).success).toBe(false);
  });

  it("rejects raw model credentials from an immutable persisted snapshot", () => {
    expect(workerExecutionSnapshotSchema.safeParse({
      ...snapshot,
      model: { ...snapshot.model, apiKey: "sk-not-persisted" },
    }).success).toBe(false);
  });

  it("rejects model endpoints that can alter the configured provider route", () => {
    for (const endpoint of [
      "https://key@codex.example.com/v1",
      "https://codex.example.com/v1?tenant=other",
      "https://codex.example.com/v1#alternate-route",
    ]) {
      expect(workerExecutionSnapshotSchema.safeParse({
        ...snapshot,
        model: { ...snapshot.model, endpoint },
      }).success).toBe(false);
    }
  });

  it("rejects invalid branch policy patterns", () => {
    expect(workerExecutionSnapshotSchema.safeParse({
      ...snapshot,
      repository: {
        ...snapshot.repository,
        branchPolicy: { allowedBranches: ["feature name"] },
      },
    }).success).toBe(false);
  });

  it("requires immutable GPU and Unity resource declarations", () => {
    expect(workerExecutionSnapshotSchema.safeParse({
      ...snapshot,
      resources: { gpu: true },
    }).success).toBe(false);
  });
});
