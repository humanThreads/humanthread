import { describe, expect, it } from "vitest";

import {
  evaluateKnowledgePublish,
  PLATFORM_SAFE_KNOWLEDGE_POLICY,
  resolveKnowledgePolicy,
} from "./knowledge-policy";

const policy = resolveKnowledgePolicy({
  autoPublishEnabled: true,
  minimumConfidence: 0.9,
  allowedSourceTypes: ["project_initialization", "task_completion"],
  allowedEntryTypes: ["rule", "decision"],
  allowAutomaticDelete: false,
  allowAutomaticExpire: false,
  allowAutomaticSupersede: true,
});

const clean = {
  sourceType: "task_completion" as const,
  entryType: "decision" as const,
  changeType: "create" as const,
  confidence: 0.95,
  provenanceComplete: true,
  redactionClean: true,
  conflictFree: true,
  sourceActive: true,
};

describe("knowledge publish policy", () => {
  it("resolves platform safe defaults when no project policy exists", () => {
    expect(resolveKnowledgePolicy(null, {
      sourceType: "task_completion",
      entryType: "rule",
    })).toEqual(PLATFORM_SAFE_KNOWLEDGE_POLICY);
  });

  it("prefers the project policy over platform safe defaults", () => {
    expect(resolveKnowledgePolicy({
      autoPublishEnabled: true,
      minimumConfidence: 0.91,
      allowedSourceTypes: ["task_completion"],
      allowedEntryTypes: ["rule"],
      allowAutomaticDelete: false,
      allowAutomaticExpire: false,
      allowAutomaticSupersede: false,
    }, {
      sourceType: "task_completion",
      entryType: "rule",
    })).toMatchObject({
      autoPublishEnabled: true,
      minimumConfidence: 0.91,
      allowedSourceTypes: ["task_completion"],
      allowedEntryTypes: ["rule"],
    });
  });

  it("prefers an exact source and type override over the project policy", () => {
    expect(resolveKnowledgePolicy(policy, {
      sourceType: "task_completion",
      entryType: "rule",
      overrides: [{
        sourceType: "task_completion",
        entryType: "rule",
        autoPublishEnabled: false,
        minimumConfidence: 0.99,
      }],
    })).toMatchObject({
      autoPublishEnabled: false,
      minimumConfidence: 0.99,
    });
  });

  it("keeps hard gates outside policy override control", () => {
    const resolved = resolveKnowledgePolicy(policy, {
      sourceType: "task_completion",
      entryType: "decision",
      overrides: [{
        sourceType: "task_completion",
        entryType: "decision",
        autoPublishEnabled: true,
      }],
    });

    expect(evaluateKnowledgePublish({ ...clean, redactionClean: false }, resolved)).toEqual({
      outcome: "review_required",
      reasons: ["sensitive_content"],
    });
  });

  it("auto-publishes only when every policy and hard gate passes", () => {
    expect(evaluateKnowledgePublish(clean, policy)).toEqual({ outcome: "auto_publish", reasons: [] });
  });

  it("cannot auto-publish sensitive content even when the project enables automation", () => {
    expect(evaluateKnowledgePublish({ ...clean, redactionClean: false }, policy)).toEqual({
      outcome: "review_required",
      reasons: ["sensitive_content"],
    });
  });

  it("routes disabled change types to review or rejection", () => {
    expect(evaluateKnowledgePublish({ ...clean, changeType: "delete" }, policy)).toEqual({
      outcome: "review_required",
      reasons: ["change_type_not_allowed"],
    });
  });
});
