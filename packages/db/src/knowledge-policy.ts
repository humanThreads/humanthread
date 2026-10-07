import type { KnowledgeChangeType, KnowledgeEntryType } from "@humanthread/shared";

export interface KnowledgePolicySnapshot {
  autoPublishEnabled: boolean;
  minimumConfidence: number;
  allowedSourceTypes: string[];
  allowedEntryTypes: string[];
  allowAutomaticDelete: boolean;
  allowAutomaticExpire: boolean;
  allowAutomaticSupersede: boolean;
}

export const PLATFORM_SAFE_KNOWLEDGE_POLICY: Readonly<KnowledgePolicySnapshot> = Object.freeze({
  autoPublishEnabled: false,
  minimumConfidence: 1,
  allowedSourceTypes: [],
  allowedEntryTypes: [],
  allowAutomaticDelete: false,
  allowAutomaticExpire: false,
  allowAutomaticSupersede: false,
});

export interface KnowledgePolicyOverride {
  sourceType: string;
  entryType: KnowledgeEntryType;
  autoPublishEnabled?: boolean;
  minimumConfidence?: number;
  allowedSourceTypes?: string[];
  allowedEntryTypes?: string[];
  allowAutomaticDelete?: boolean;
  allowAutomaticExpire?: boolean;
  allowAutomaticSupersede?: boolean;
}

export interface KnowledgePolicyResolutionOptions {
  sourceType: string;
  entryType: KnowledgeEntryType;
  overrides?: KnowledgePolicyOverride[];
}

export interface KnowledgePublishInput {
  sourceType: string;
  entryType: KnowledgeEntryType;
  changeType: KnowledgeChangeType;
  confidence: number;
  provenanceComplete: boolean;
  redactionClean: boolean;
  conflictFree: boolean;
  sourceActive: boolean;
}

export interface KnowledgePublishDecision {
  outcome: "auto_publish" | "review_required";
  reasons: string[];
}

export function resolveKnowledgePolicy(
  input: KnowledgePolicySnapshot | null,
  options?: KnowledgePolicyResolutionOptions,
): KnowledgePolicySnapshot {
  const projectPolicy = input
    ? { ...PLATFORM_SAFE_KNOWLEDGE_POLICY, ...definedValues(input) }
    : { ...PLATFORM_SAFE_KNOWLEDGE_POLICY };
  const override = options?.overrides?.find((candidate) => (
    candidate.sourceType === options.sourceType
    && candidate.entryType === options.entryType
  ));
  const policy = override
    ? { ...projectPolicy, ...definedValues(override) }
    : projectPolicy;
  if (!Number.isFinite(policy.minimumConfidence) || policy.minimumConfidence < 0 || policy.minimumConfidence > 1) {
    throw new Error("Knowledge minimum confidence must be between 0 and 1");
  }
  return policy;
}

function definedValues<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as Partial<T>;
}

export function evaluateKnowledgePublish(
  input: KnowledgePublishInput,
  policy: KnowledgePolicySnapshot,
): KnowledgePublishDecision {
  const reasons: string[] = [];
  if (!policy.autoPublishEnabled) reasons.push("automation_disabled");
  if (!input.provenanceComplete) reasons.push("provenance_incomplete");
  if (!input.redactionClean) reasons.push("sensitive_content");
  if (!input.conflictFree) reasons.push("conflict_detected");
  if (!input.sourceActive) reasons.push("source_inactive");
  if (!policy.allowedSourceTypes.includes(input.sourceType)) reasons.push("source_type_not_allowed");
  if (!policy.allowedEntryTypes.includes(input.entryType)) reasons.push("entry_type_not_allowed");
  if (input.confidence < policy.minimumConfidence) reasons.push("confidence_below_threshold");
  if (input.changeType === "delete" && !policy.allowAutomaticDelete) reasons.push("change_type_not_allowed");
  if (input.changeType === "expire" && !policy.allowAutomaticExpire) reasons.push("change_type_not_allowed");
  if (input.changeType === "supersede" && !policy.allowAutomaticSupersede) reasons.push("change_type_not_allowed");
  return {
    outcome: reasons.length === 0 ? "auto_publish" : "review_required",
    reasons,
  };
}
