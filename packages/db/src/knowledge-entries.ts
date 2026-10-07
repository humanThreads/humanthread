import {
  KNOWLEDGE_RELATION_TYPES,
  type KnowledgeChangeType,
  type KnowledgeEntryStatus,
  type KnowledgeRelationType,
} from "@humanthread/shared";

import { knowledgeDigest, knowledgeId } from "./knowledge-reference";
import { KNOWLEDGE_TRANSACTION_OPTIONS } from "./knowledge-jobs";
import { prisma } from "./prisma";

const PUBLISHABLE_BATCH_STATUSES = new Set(["policy_evaluating", "review_required", "archiving"]);
const RELATION_TYPES = new Set<string>(KNOWLEDGE_RELATION_TYPES);

interface KnowledgeBatchRow {
  id: string;
  projectDigest: string;
  status: string;
  version?: number;
}

interface KnowledgeBatchItemRow {
  id: string;
  batchId: string;
  ordinal: number;
  stableKey: string;
  changeType: string;
  sourceType: string;
  entryType: string;
  scope: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  confidence: number;
  tags: unknown;
  changeSummary: string;
  evidence: unknown;
  relations: unknown;
  baseVersion: number | null;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
  decision: string | null;
  decisionReason?: string | null;
  publishedVersion: number | null;
}

export interface KnowledgeEntryProjection {
  id: string;
  projectDigest: string;
  stableKey: string;
  entryType: string;
  scope: string;
  status: KnowledgeEntryStatus;
  latestVersion: number;
  publishedVersion: number | null;
  title: string;
  searchable: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeEntryVersionProjection {
  id: string;
  entryId: string;
  version: number;
  status: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  entryType: string;
  scope: string;
  tags: unknown;
  validFrom: Date | null;
  validUntil: Date | null;
  changeSummary: string;
  contentHash: string;
  sourceRefs: unknown;
  batchItemId: string;
  publishedByDigest: string;
  publishedAt: Date;
  createdAt: Date;
}

interface KnowledgeEntryRow extends Omit<KnowledgeEntryProjection, "status"> {
  status: string;
}

interface KnowledgeEntryVersionRow extends Omit<KnowledgeEntryVersionProjection, "status"> {
  status: string;
}

export interface PublishedKnowledgeEntry {
  entryId: string;
  stableKey: string;
  version: number;
  status: string;
}

export interface PublishKnowledgeBatchResult {
  batchId: string;
  entries: PublishedKnowledgeEntry[];
  unresolvedItemIds: string[];
}

export interface KnowledgeNeighborhoodRelation {
  id: string;
  direction: "incoming" | "outgoing";
  relationType: KnowledgeRelationType;
  origin: string;
  confidence: number;
  relatedEntryId: string;
  relatedStableKey: string;
  relatedVersion: number;
  fromVersion: number;
  toVersion: number | null;
}

export interface DecideKnowledgeBatchInput {
  batchId: string;
  actorDigest: string;
  commandId: string;
  decision: "approve" | "reject";
  itemIds?: string[];
  reason?: string;
}

interface KnowledgeEntryTx {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  knowledgeBatch: {
    findUnique(args: { where: { id: string } }): Promise<KnowledgeBatchRow | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  knowledgeBatchItem: {
    findMany(args: {
      where: { batchId: string };
      orderBy: { ordinal: "asc" };
    }): Promise<KnowledgeBatchItemRow[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  knowledgeEntry: {
    findUnique(args: {
      where: { id: string } | {
        projectDigest_stableKey: { projectDigest: string; stableKey: string };
      };
    }): Promise<KnowledgeEntryRow | null>;
    create(args: { data: KnowledgeEntryRow }): Promise<KnowledgeEntryRow>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  knowledgeEntryVersion: {
    create(args: { data: KnowledgeEntryVersionRow }): Promise<KnowledgeEntryVersionRow>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: { entryId: string };
      orderBy: { version: "desc" };
    }): Promise<KnowledgeEntryVersionRow[]>;
  };
  knowledgeRelation: {
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
    }): Promise<KnowledgeRelationRow[]>;
  };
  commandReceipt: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      status: string;
      result: unknown;
    } | null>;
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
}

interface KnowledgeRelationRow {
  id: string;
  projectDigest: string;
  fromEntryId: string;
  fromVersion: number;
  toStableKey: string;
  toEntryId: string | null;
  toVersion: number | null;
  relationType: string;
  origin: string;
  confidence: number;
  active: boolean;
}

export interface KnowledgeEntryDependencies {
  db: Omit<KnowledgeEntryTx, "$transaction"> & {
    $transaction<T>(
      callback: (tx: KnowledgeEntryTx) => Promise<T>,
      options?: { maxWait?: number; timeout?: number },
    ): Promise<T>;
  };
  now?: () => Date;
}

interface NormalizedRelation {
  targetKey: string;
  relationType: KnowledgeRelationType;
  origin: "explicit" | "inferred";
  confidence: number;
  evidence: unknown;
  validFrom: Date | null;
  validUntil: Date | null;
}

const DEFAULT_DEPENDENCIES: KnowledgeEntryDependencies = {
  db: prisma as unknown as KnowledgeEntryDependencies["db"],
};

export async function publishKnowledgeBatch(
  batchId: string,
  actorDigest: string,
  dependencies: KnowledgeEntryDependencies = DEFAULT_DEPENDENCIES,
): Promise<PublishKnowledgeBatchResult> {
  const normalizedBatchId = requiredId(batchId, "batchId");
  const normalizedActorDigest = normalizeActorDigest(actorDigest);
  const now = dependencies.now?.() ?? new Date();

  return dependencies.db.$transaction((tx) => (
    publishKnowledgeBatchInTx(tx, normalizedBatchId, normalizedActorDigest, now)
  ), KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function decideKnowledgeBatch(
  input: DecideKnowledgeBatchInput,
  dependencies: KnowledgeEntryDependencies = DEFAULT_DEPENDENCIES,
): Promise<PublishKnowledgeBatchResult> {
  const batchId = requiredId(input.batchId, "batchId");
  const actorDigest = normalizeActorDigest(input.actorDigest);
  const commandId = requiredId(input.commandId, "commandId");
  const receiptId = knowledgeId("knowledge-decision", batchId, commandId);
  const reason = input.reason?.trim() ?? "";
  const now = dependencies.now?.() ?? new Date();

  if (input.decision !== "approve" && input.decision !== "reject") {
    throw validationError("Knowledge decision must be approve or reject");
  }
  if (input.decision === "reject" && !reason) {
    throw validationError("Knowledge rejection reason is required");
  }

  return dependencies.db.$transaction(async (tx) => {
    if (!await lockKnowledgeBatchRow(tx, batchId)) {
      throw notFound("Knowledge batch not found");
    }

    const receipt = await tx.commandReceipt.findUnique({ where: { id: receiptId } });
    if (receipt) {
      if (receipt.status !== "completed") throw commandInProgress("Knowledge decision is not completed");
      return projectDecisionReceipt(receipt.result);
    }

    const batch = await tx.knowledgeBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw notFound("Knowledge batch not found");
    const allowed = input.decision === "approve"
      ? ["review_required"]
      : ["review_required", "policy_evaluating"];
    if (!allowed.includes(batch.status)) {
      throw conflict("Knowledge batch is no longer reviewable");
    }

    const items = await tx.knowledgeBatchItem.findMany({
      where: { batchId },
      orderBy: { ordinal: "asc" },
    });
    const selected = selectDecisionItems(items, input.decision, input.itemIds, batch.status);
    for (const item of selected) {
      const decision = input.decision === "approve" ? "approve" : "reject";
      if (item.decision === decision || (input.decision === "approve" && item.decision === "auto_publish")) {
        continue;
      }
      if (input.decision === "reject" && !isRejectableItem(item, batch.status)) {
        throw validationError("Knowledge rejection can only target rejectable items");
      }
      if (input.decision === "approve" && item.decision !== "review_required") {
        throw conflict("Knowledge batch item is no longer reviewable");
      }
      const updated = await tx.knowledgeBatchItem.updateMany({
        where: { id: item.id, decision: item.decision },
        data: {
          decision,
          decisionReason: reason || null,
        },
      });
      if (updated.count !== 1) throw versionConflict("Knowledge batch item changed while reviewing");
    }

    const result = await publishKnowledgeBatchInTx(tx, batchId, actorDigest, now);

    const claimed = await tx.commandReceipt.createMany({
      data: [{
        id: receiptId,
        aggregateType: "knowledge_batch",
        aggregateId: batchId,
        status: "completed",
        result,
        createdAt: now,
        completedAt: now,
      }],
      skipDuplicates: false,
    });
    if (claimed.count !== 1) throw versionConflict("Knowledge decision command conflicted");
    return result;
  }, KNOWLEDGE_TRANSACTION_OPTIONS);
}

export async function getKnowledgeEntry(
  entryId: string,
  dependencies: KnowledgeEntryDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeEntryProjection | null> {
  const row = await dependencies.db.knowledgeEntry.findUnique({
    where: { id: requiredId(entryId, "entryId") },
  });
  return row ? projectEntry(row) : null;
}

export async function listKnowledgeEntryVersions(
  entryId: string,
  dependencies: KnowledgeEntryDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeEntryVersionProjection[]> {
  const rows = await dependencies.db.knowledgeEntryVersion.findMany({
    where: { entryId: requiredId(entryId, "entryId") },
    orderBy: { version: "desc" },
  });
  return rows.map(projectVersion);
}

export async function listKnowledgeNeighborhood(
  entryId: string,
  dependencies: KnowledgeEntryDependencies = DEFAULT_DEPENDENCIES,
): Promise<KnowledgeNeighborhoodRelation[]> {
  const normalizedEntryId = requiredId(entryId, "entryId");
  const entry = await dependencies.db.knowledgeEntry.findUnique({ where: { id: normalizedEntryId } });
  if (!entry) throw notFound("Knowledge entry not found");
  const [outgoing, incoming] = await Promise.all([
    dependencies.db.knowledgeRelation.findMany({
      where: { projectDigest: entry.projectDigest, fromEntryId: entry.id, active: true },
      orderBy: { id: "asc" },
    }),
    dependencies.db.knowledgeRelation.findMany({
      where: { projectDigest: entry.projectDigest, toEntryId: entry.id, active: true },
      orderBy: { id: "asc" },
    }),
  ]);
  const outgoingResolved = await Promise.all(outgoing.map(async (relation) => {
    const related = await findRelationEndpoint(dependencies, entry.projectDigest, {
      entryId: relation.toEntryId,
      stableKey: relation.toStableKey,
    });
    if (!isPublishedRelationEndpoint(related)) return null;
    return projectNeighborhoodRelation("outgoing", relation, related);
  }));
  const incomingResolved = await Promise.all(incoming.map(async (relation) => {
    const related = await dependencies.db.knowledgeEntry.findUnique({ where: { id: relation.fromEntryId } });
    if (!isPublishedRelationEndpoint(related)) return null;
    return projectNeighborhoodRelation("incoming", relation, related);
  }));
  return [...incomingResolved, ...outgoingResolved]
    .filter((relation): relation is KnowledgeNeighborhoodRelation => relation !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function publishKnowledgeBatchInTx(
  tx: KnowledgeEntryTx,
  batchId: string,
  actorDigest: string,
  now: Date,
): Promise<PublishKnowledgeBatchResult> {
  const batch = await lockKnowledgeBatchRow(tx, batchId);
  if (!batch) throw notFound("Knowledge batch not found");
  if (batch.status !== "searchable" && !PUBLISHABLE_BATCH_STATUSES.has(batch.status)) {
    throw conflict("Knowledge batch is not publishable");
  }

  const items = await tx.knowledgeBatchItem.findMany({
    where: { batchId },
    orderBy: { ordinal: "asc" },
  });
  if (batch.status === "searchable") return projectPublishedBatch(batchId, batch.projectDigest, items);

  const lockKeys = Array.from(new Set(items
    .filter((item) => (
      item.publishedVersion === null
      && (item.decision === "auto_publish" || item.decision === "approve")
    ))
    .map((item) => item.stableKey))).sort((left, right) => left.localeCompare(right));
  const lockedEntries = new Map<string, KnowledgeEntryRow | null>();
  for (const stableKey of lockKeys) {
    lockedEntries.set(stableKey, await lockKnowledgeEntryRow(tx, batch.projectDigest, stableKey));
  }

  const published: PublishedKnowledgeEntry[] = [];
  const unresolvedItemIds: string[] = [];
  for (const item of items) {
    if (item.decision !== "auto_publish" && item.decision !== "approve" && item.decision !== "reject") {
      unresolvedItemIds.push(item.id);
      continue;
    }
    if (item.decision === "reject") {
      if (item.publishedVersion !== null) {
        throw versionConflict("Rejected knowledge item cannot retain a published version");
      }
      continue;
    }
    if (item.publishedVersion !== null) {
      published.push(projectPublishedItem(batch.projectDigest, item, item.publishedVersion));
      continue;
    }
    const entry = await applyKnowledgeItem(
      tx,
      batch,
      item,
      lockedEntries.get(item.stableKey) ?? null,
      actorDigest,
      now,
    );
    const marked = await tx.knowledgeBatchItem.updateMany({
      where: { id: item.id, publishedVersion: null },
      data: { publishedVersion: entry.version },
    });
    if (marked.count !== 1) throw versionConflict("Knowledge batch item changed while publishing");
    published.push(entry);
  }

  // Partial reviews are non-terminal. Resolved items may publish immediately, but the
  // batch remains reviewable until every item is explicitly approved or rejected.
  if (unresolvedItemIds.length > 0) {
    if (batch.status === "archiving") {
      throw conflict("Knowledge batch has unresolved items while archiving");
    }
    if (batch.status !== "review_required") {
      const updated = await tx.knowledgeBatch.updateMany({
        where: {
          id: batchId,
          status: batch.status,
          ...(batch.version === undefined ? {} : { version: batch.version }),
        },
        data: {
          status: "review_required",
          progress: 30,
          completedAt: null,
          version: { increment: 1 },
          updatedAt: now,
        },
      });
      if (updated.count !== 1) throw versionConflict("Knowledge batch changed while reviewing");
    }
    return { batchId, entries: published, unresolvedItemIds };
  }

  if (published.length === 0) return rejectKnowledgeBatchInTx(tx, batch, now);

  if (batch.status !== "archiving") {
    const updated = await tx.knowledgeBatch.updateMany({
      where: {
        id: batchId,
        status: batch.status,
        ...(batch.version === undefined ? {} : { version: batch.version }),
      },
      data: {
        status: "archiving",
        progress: 45,
        completedAt: null,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (updated.count !== 1) throw versionConflict("Knowledge batch changed while publishing");
  }

  return { batchId, entries: published, unresolvedItemIds: [] };
}

async function rejectKnowledgeBatchInTx(
  tx: KnowledgeEntryTx,
  batch: KnowledgeBatchRow,
  now: Date,
): Promise<PublishKnowledgeBatchResult> {
  const updated = await tx.knowledgeBatch.updateMany({
    where: {
      id: batch.id,
      status: batch.status,
      ...(batch.version === undefined ? {} : { version: batch.version }),
    },
    data: {
      status: "rejected",
      progress: 100,
      completedAt: now,
      version: { increment: 1 },
      updatedAt: now,
    },
  });
  if (updated.count !== 1) throw versionConflict("Knowledge batch changed while rejecting");
  return { batchId: batch.id, entries: [], unresolvedItemIds: [] };
}

async function applyKnowledgeItem(
  tx: KnowledgeEntryTx,
  batch: KnowledgeBatchRow,
  item: KnowledgeBatchItemRow,
  current: KnowledgeEntryRow | null,
  actorDigest: string,
  now: Date,
): Promise<PublishedKnowledgeEntry> {
  const changeType = parseChangeType(item.changeType);
  const relations = normalizeRelations(item.relations);

  if (changeType === "create") {
    if (item.baseVersion !== null) {
      throw versionConflict("Knowledge create requires a null base version");
    }
    if (current) throw versionConflict("Knowledge entry already exists");
    const entryId = knowledgeId("knowledge-entry", batch.projectDigest, item.stableKey);
    const entry = await tx.knowledgeEntry.create({
      data: {
        id: entryId,
        projectDigest: batch.projectDigest,
        stableKey: item.stableKey,
        entryType: requiredText(item.entryType, "entryType"),
        scope: requiredText(item.scope, "scope"),
        status: "draft",
        latestVersion: 0,
        publishedVersion: null,
        title: requiredText(item.title, "title"),
        searchable: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    const version = 1;
    await createEntryVersion(tx, entry.id, version, item, actorDigest, now, "published", true);
    await updateEntry(tx, entry, 0, {
      status: "published",
      latestVersion: version,
      publishedVersion: version,
      title: item.title,
      entryType: item.entryType,
      scope: item.scope,
      // Stage 2 owns index activation. Publication does not claim that a new index exists.
      searchable: false,
    }, now);
    await createRelations(tx, batch.projectDigest, entry.id, version, item, relations, now);
    return projectPublishedItem(batch.projectDigest, item, version, "published");
  }

  if (!current) throw notFound("Knowledge entry not found");
  if (item.baseVersion !== current.latestVersion) {
    throw versionConflict("Knowledge entry base version is stale");
  }
  assertLifecycleTransition(changeType, current.status);

  let versionStatus: string;
  let entryStatus: KnowledgeEntryStatus;
  let searchable: boolean;
  let publishedVersion: number | null;
  let includeContent = true;

  switch (changeType) {
    case "update":
      versionStatus = "published";
      entryStatus = "published";
      // The active version remains searchable until Stage 2 verifies the new index.
      searchable = current.searchable;
      publishedVersion = current.latestVersion + 1;
      break;
    case "supersede": {
      await requirePublishedSupersedeTarget(tx, batch.projectDigest, item.stableKey, relations);
      versionStatus = "superseded";
      entryStatus = "superseded";
      searchable = false;
      publishedVersion = null;
      includeContent = false;
      break;
    }
    case "expire":
      versionStatus = "expired";
      entryStatus = "expired";
      searchable = false;
      publishedVersion = null;
      includeContent = false;
      break;
    case "delete":
      versionStatus = "deleted";
      entryStatus = "deleted";
      searchable = false;
      publishedVersion = null;
      includeContent = false;
      break;
    default:
      throw validationError("Knowledge change type is invalid");
  }

  const version = current.latestVersion + 1;
  await tx.knowledgeEntryVersion.updateMany({
    where: { entryId: current.id, version: current.latestVersion, status: "published" },
    data: { status: "superseded" },
  });
  await createEntryVersion(tx, current.id, version, item, actorDigest, now, versionStatus, includeContent);
  await updateEntry(tx, current, current.latestVersion, {
    status: entryStatus,
    latestVersion: version,
    publishedVersion,
    title: includeContent ? item.title : current.title,
    entryType: includeContent ? item.entryType : current.entryType,
    scope: includeContent ? item.scope : current.scope,
    searchable,
  }, now);
  if (entryStatus !== "published") {
    await tx.knowledgeRelation.updateMany({
      where: {
        projectDigest: batch.projectDigest,
        toEntryId: current.id,
        active: true,
      },
      data: { active: false, updatedAt: now },
    });
  }
  await createRelations(tx, batch.projectDigest, current.id, version, item, relations, now);
  return projectPublishedItem(batch.projectDigest, item, version, versionStatus);
}

async function createEntryVersion(
  tx: KnowledgeEntryTx,
  entryId: string,
  version: number,
  item: KnowledgeBatchItemRow,
  actorDigest: string,
  now: Date,
  status: string,
  includeContent: boolean,
): Promise<void> {
  const summary = includeContent ? item.summary : "";
  const bodyMarkdown = includeContent ? item.bodyMarkdown : "";
  const tags = item.tags ?? [];
  const changeSummary = includeContent
    ? requiredText(item.changeSummary?.trim() || item.summary, "changeSummary")
    : item.changeSummary?.trim() || item.decisionReason?.trim() || "知识条目生命周期变更";
  const validFrom = optionalDate(item.validFrom, "validFrom");
  const validUntil = optionalDate(item.validUntil, "validUntil");
  const contentHash = knowledgeDigest(
    "knowledge-entry-version-content",
    digestPart(requiredText(item.title, "title")),
    digestPart(summary),
    digestPart(bodyMarkdown),
    digestPart(requiredText(item.entryType, "entryType")),
    digestPart(requiredText(item.scope, "scope")),
    canonicalJson(tags),
    validFrom?.toISOString() ?? "none",
    validUntil?.toISOString() ?? "none",
    digestPart(changeSummary),
  );

  await tx.knowledgeEntryVersion.create({
    data: {
      id: knowledgeId("knowledge-entry-version", entryId, String(version)),
      entryId,
      version,
      status,
      title: requiredText(item.title, "title"),
      summary,
      bodyMarkdown,
      entryType: requiredText(item.entryType, "entryType"),
      scope: requiredText(item.scope, "scope"),
      tags,
      validFrom,
      validUntil,
      changeSummary,
      contentHash,
      sourceRefs: item.evidence ?? [],
      batchItemId: item.id,
      publishedByDigest: actorDigest,
      publishedAt: now,
      createdAt: now,
    },
  });
}

async function updateEntry(
  tx: KnowledgeEntryTx,
  current: KnowledgeEntryRow,
  expectedLatestVersion: number,
  data: {
    status: KnowledgeEntryStatus;
    latestVersion: number;
    publishedVersion: number | null;
    title: string;
    entryType: string;
    scope: string;
    searchable: boolean;
  },
  now: Date,
): Promise<void> {
  const updated = await tx.knowledgeEntry.updateMany({
    where: {
      id: current.id,
      latestVersion: expectedLatestVersion,
      ...(current.version === undefined ? {} : { version: current.version }),
    },
    data: {
      ...data,
      version: { increment: 1 },
      updatedAt: now,
    },
  });
  if (updated.count !== 1) throw versionConflict("Knowledge entry changed while publishing");
}

async function createRelations(
  tx: KnowledgeEntryTx,
  projectDigest: string,
  entryId: string,
  fromVersion: number,
  item: KnowledgeBatchItemRow,
  relations: NormalizedRelation[],
  now: Date,
): Promise<void> {
  await tx.knowledgeRelation.updateMany({
    where: { projectDigest, fromEntryId: entryId, active: true },
    data: { active: false, updatedAt: now },
  });
  if (relations.length === 0) return;
  const rows: Array<Record<string, unknown>> = [];
  for (const relation of relations) {
    const target = await tx.knowledgeEntry.findUnique({
      where: {
        projectDigest_stableKey: {
          projectDigest,
          stableKey: relation.targetKey,
        },
      },
    });
    rows.push({
      id: knowledgeId(
        "knowledge-relation",
        projectDigest,
        entryId,
        String(fromVersion),
        relation.targetKey,
        relation.relationType,
      ),
      projectDigest,
      fromEntryId: entryId,
      fromVersion,
      toStableKey: relation.targetKey,
      toEntryId: target?.id ?? null,
      toVersion: target?.latestVersion ?? null,
      relationType: relation.relationType,
      origin: relation.origin,
      confidence: relation.confidence,
      evidence: relation.evidence,
      active: true,
      validFrom: relation.validFrom ?? optionalDate(item.validFrom, "validFrom"),
      validUntil: relation.validUntil ?? optionalDate(item.validUntil, "validUntil"),
      createdAt: now,
      updatedAt: now,
    });
  }
  await tx.knowledgeRelation.createMany({ data: rows, skipDuplicates: true });
}

async function requirePublishedSupersedeTarget(
  tx: KnowledgeEntryTx,
  projectDigest: string,
  stableKey: string,
  relations: NormalizedRelation[],
): Promise<void> {
  const replacement = relations.find((relation) => (
    relation.relationType === "supersedes" && relation.targetKey !== stableKey
  ));
  if (!replacement) {
    throw validationError("Knowledge supersede requires a replacement relation");
  }
  const target = await tx.knowledgeEntry.findUnique({
    where: {
      projectDigest_stableKey: {
        projectDigest,
        stableKey: replacement.targetKey,
      },
    },
  });
  if (!target || target.status !== "published" || target.publishedVersion === null) {
    throw validationError("Knowledge supersede target must be a published entry");
  }
}

function assertLifecycleTransition(changeType: KnowledgeChangeType, currentStatus: string): void {
  if (changeType === "update" && currentStatus !== "published") {
    throw versionConflict("Knowledge update requires a published entry");
  }
  if (changeType === "expire" && currentStatus !== "published") {
    throw versionConflict("Knowledge expire requires a published entry");
  }
  if (changeType === "delete" && currentStatus !== "published" && currentStatus !== "expired") {
    throw versionConflict("Knowledge delete requires a published or expired entry");
  }
  if (changeType === "supersede" && currentStatus !== "published") {
    throw versionConflict("Knowledge supersede requires a published entry");
  }
}

async function findRelationEndpoint(
  dependencies: KnowledgeEntryDependencies,
  projectDigest: string,
  input: { entryId: string | null; stableKey: string },
): Promise<KnowledgeEntryRow | null> {
  if (input.entryId) {
    return dependencies.db.knowledgeEntry.findUnique({ where: { id: input.entryId } });
  }
  return dependencies.db.knowledgeEntry.findUnique({
    where: { projectDigest_stableKey: { projectDigest, stableKey: input.stableKey } },
  });
}

function isPublishedRelationEndpoint(entry: KnowledgeEntryRow | null): entry is KnowledgeEntryRow {
  return Boolean(entry && entry.status === "published" && entry.publishedVersion !== null);
}

function projectNeighborhoodRelation(
  direction: "incoming" | "outgoing",
  relation: KnowledgeRelationRow,
  related: KnowledgeEntryRow,
): KnowledgeNeighborhoodRelation {
  return {
    id: relation.id,
    direction,
    relationType: parseRelationType(relation.relationType),
    origin: relation.origin,
    confidence: relation.confidence,
    relatedEntryId: related.id,
    relatedStableKey: related.stableKey,
    relatedVersion: related.publishedVersion ?? related.latestVersion,
    fromVersion: relation.fromVersion,
    toVersion: relation.toVersion,
  };
}

function parseRelationType(value: string): KnowledgeRelationType {
  if (RELATION_TYPES.has(value)) return value as KnowledgeRelationType;
  throw invalidReceipt("Knowledge relation type is invalid");
}

function selectDecisionItems(
  items: KnowledgeBatchItemRow[],
  decision: "approve" | "reject",
  itemIds: string[] | undefined,
  batchStatus: string,
): KnowledgeBatchItemRow[] {
  if (decision === "reject") {
    const rejectable = items.filter((item) => isRejectableItem(item, batchStatus));
    if (itemIds === undefined) {
      if (rejectable.length === 0) {
        throw validationError("Knowledge batch has no rejectable items");
      }
      return rejectable;
    }
    if (itemIds.length === 0) throw validationError("Knowledge decision item selection is required");
    const requested = new Set(itemIds.map((itemId) => requiredId(itemId, "itemId")));
    const selected = items.filter((item) => requested.has(item.id));
    if (selected.length !== requested.size) {
      throw validationError("Knowledge decision contains an unknown batch item");
    }
    if (selected.some((item) => !isRejectableItem(item, batchStatus))) {
      throw validationError("Knowledge rejection can only target rejectable items");
    }
    return selected;
  }

  // Omitted approvals resolve only unresolved items. Existing terminal decisions are
  // never overwritten by a later bulk approval.
  if (itemIds === undefined) return items.filter((item) => item.decision === "review_required");
  if (itemIds.length === 0) throw validationError("Knowledge decision item selection is required");
  const requested = new Set(itemIds.map((itemId) => requiredId(itemId, "itemId")));
  const selected = items.filter((item) => requested.has(item.id));
  if (selected.length !== requested.size) {
    throw validationError("Knowledge decision contains an unknown batch item");
  }
  return selected;
}

function isRejectableItem(item: KnowledgeBatchItemRow, batchStatus: string): boolean {
  if (item.publishedVersion !== null || item.decision === "reject" || item.decision === "approve") {
    return false;
  }
  if (batchStatus === "policy_evaluating") return item.decision === "auto_publish";
  if (batchStatus === "review_required") return item.decision === "review_required";
  return false;
}

function normalizeRelations(value: unknown): NormalizedRelation[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw validationError("Knowledge relations must be an array");
  return value.map((entry) => {
    const relation = asRecord(entry);
    const targetKey = requiredText(
      String(relation.targetKey ?? relation.toStableKey ?? relation.target ?? ""),
      "relation.targetKey",
    );
    const relationType = String(relation.type ?? relation.relationType ?? "");
    if (!RELATION_TYPES.has(relationType)) throw validationError("Knowledge relation type is invalid");
    const origin = relation.origin === "inferred" ? "inferred" : "explicit";
    const confidence = relation.confidence === undefined ? 1 : Number(relation.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw validationError("Knowledge relation confidence must be between 0 and 1");
    }
    return {
      targetKey,
      relationType: relationType as KnowledgeRelationType,
      origin,
      confidence,
      evidence: relation.evidence ?? relation.evidenceRefs ?? [],
      validFrom: optionalDate(relation.validFrom, "relation.validFrom"),
      validUntil: optionalDate(relation.validUntil, "relation.validUntil"),
    };
  });
}

async function lockKnowledgeBatchRow(
  tx: KnowledgeEntryTx,
  batchId: string,
): Promise<KnowledgeBatchRow | null> {
  const rows = await tx.$queryRaw<KnowledgeBatchRow[]>`
    SELECT id, projectDigest, status, version
    FROM KnowledgeBatch
    WHERE id = ${batchId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function lockKnowledgeEntryRow(
  tx: KnowledgeEntryTx,
  projectDigest: string,
  stableKey: string,
): Promise<KnowledgeEntryRow | null> {
  const rows = await tx.$queryRaw<KnowledgeEntryRow[]>`
    SELECT id, projectDigest, stableKey, entryType, scope, status, latestVersion,
           publishedVersion, title, searchable, version, createdAt, updatedAt
    FROM KnowledgeEntry
    WHERE projectDigest = ${projectDigest} AND stableKey = ${stableKey}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function projectDecisionReceipt(value: unknown): PublishKnowledgeBatchResult {
  const result = asRecord(value);
  if (
    typeof result.batchId !== "string"
    || !Array.isArray(result.entries)
    || !Array.isArray(result.unresolvedItemIds)
    || !result.unresolvedItemIds.every((itemId) => typeof itemId === "string")
  ) {
    throw invalidReceipt("Knowledge decision receipt result is invalid");
  }
  return {
    batchId: result.batchId,
    unresolvedItemIds: result.unresolvedItemIds,
    entries: result.entries.map((entry) => {
      const projected = asRecord(entry);
      if (
        typeof projected.entryId !== "string"
        || typeof projected.stableKey !== "string"
        || typeof projected.version !== "number"
        || typeof projected.status !== "string"
      ) {
        throw invalidReceipt("Knowledge decision receipt entry is invalid");
      }
      return {
        entryId: projected.entryId,
        stableKey: projected.stableKey,
        version: projected.version,
        status: projected.status,
      };
    }),
  };
}

function projectPublishedBatch(
  batchId: string,
  projectDigest: string,
  items: KnowledgeBatchItemRow[],
): PublishKnowledgeBatchResult {
  return {
    batchId,
    unresolvedItemIds: [],
    entries: items.flatMap((item) => (
      item.publishedVersion === null
        ? []
        : [projectPublishedItem(projectDigest, item, item.publishedVersion)]
    )),
  };
}

function projectPublishedItem(
  projectDigest: string,
  item: KnowledgeBatchItemRow,
  version: number,
  status = statusForChangeType(item.changeType),
): PublishedKnowledgeEntry {
  return {
    entryId: knowledgeId("knowledge-entry", projectDigest, item.stableKey),
    stableKey: item.stableKey,
    version,
    status,
  };
}

function projectEntry(row: KnowledgeEntryRow): KnowledgeEntryProjection {
  return {
    id: row.id,
    projectDigest: row.projectDigest,
    stableKey: row.stableKey,
    entryType: row.entryType,
    scope: row.scope,
    status: parseEntryStatus(row.status),
    latestVersion: row.latestVersion,
    publishedVersion: row.publishedVersion,
    title: row.title,
    searchable: row.searchable,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function projectVersion(row: KnowledgeEntryVersionRow): KnowledgeEntryVersionProjection {
  return {
    id: row.id,
    entryId: row.entryId,
    version: row.version,
    status: row.status,
    title: row.title,
    summary: row.summary,
    bodyMarkdown: row.bodyMarkdown,
    entryType: row.entryType,
    scope: row.scope,
    tags: row.tags,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    changeSummary: row.changeSummary,
    contentHash: row.contentHash,
    sourceRefs: row.sourceRefs,
    batchItemId: row.batchItemId,
    publishedByDigest: row.publishedByDigest,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function statusForChangeType(changeType: string): string {
  if (changeType === "expire") return "expired";
  if (changeType === "delete") return "deleted";
  if (changeType === "supersede") return "superseded";
  return "published";
}

function parseChangeType(value: string): KnowledgeChangeType {
  if (value === "create" || value === "update" || value === "supersede" || value === "expire" || value === "delete") {
    return value;
  }
  throw validationError("Knowledge change type is invalid");
}

function parseEntryStatus(value: string): KnowledgeEntryStatus {
  if (
    value === "draft"
    || value === "review_required"
    || value === "published"
    || value === "superseded"
    || value === "expired"
    || value === "deleted"
    || value === "rejected"
  ) {
    return value;
  }
  throw new Error("Knowledge entry status is invalid");
}

function normalizeActorDigest(value: string): string {
  const normalized = requiredId(value, "actorDigest");
  return /^[a-f0-9]{32}$/u.test(normalized)
    ? normalized
    : knowledgeDigest("knowledge-actor", normalized);
}

function optionalDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (!(value instanceof Date) && typeof value !== "string") {
    throw validationError(`${field} is invalid`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError(`${field} is invalid`);
  return date;
}

function requiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`${field} is required`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(",")}}`;
}

function digestPart(value: string): string {
  return value.trim() ? value : "<empty>";
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { code: "conflict" });
}

function versionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "version_conflict" });
}

function commandInProgress(message: string): Error {
  return Object.assign(new Error(message), { code: "command_in_progress" });
}

function invalidReceipt(message: string): Error {
  return Object.assign(new Error(message), { code: "invalid_command_receipt" });
}
