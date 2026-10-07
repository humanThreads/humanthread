export const KNOWLEDGE_ENTRY_TYPES = ["rule", "decision", "experience", "interface", "term", "risk", "procedure"] as const;
export type KnowledgeEntryType = (typeof KNOWLEDGE_ENTRY_TYPES)[number];

export const KNOWLEDGE_CHANGE_TYPES = ["create", "update", "supersede", "expire", "delete"] as const;
export type KnowledgeChangeType = (typeof KNOWLEDGE_CHANGE_TYPES)[number];

export const KNOWLEDGE_BATCH_STATUSES = [
  "received", "validating", "policy_evaluating", "review_required", "archiving",
  "chunking", "embedding", "indexing", "activating", "searchable", "rejected", "cancelled", "failed",
] as const;
export type KnowledgeBatchStatus = (typeof KNOWLEDGE_BATCH_STATUSES)[number];
export const KNOWLEDGE_BATCH_ITEM_LIMIT = 500;

export const KNOWLEDGE_RELATION_TYPES = [
  "depends_on", "contains", "calls", "publishes", "consumes", "evolves_to",
  "supersedes", "constrains", "related_to",
] as const;
export type KnowledgeRelationType = (typeof KNOWLEDGE_RELATION_TYPES)[number];
export type KnowledgeEntryStatus = "draft" | "review_required" | "published" | "superseded" | "expired" | "deleted" | "rejected";
