import { createHash } from "node:crypto";

const ENTRY_TYPES = new Set(["rule", "decision", "experience", "interface", "term", "risk", "procedure"]);
const DEFAULT_ENTRY_TYPE = "experience";
const LEGACY_SOURCE_TYPE = "legacy_candidate";
const LEGACY_ACTOR = "legacy-backfill";

function requiredPart(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error("Backfill digest part is required");
  return normalized;
}

function digest(...parts) {
  return createHash("md5").update(parts.map(requiredPart).join("\0")).digest("hex");
}

function projectDigest(projectId) {
  return digest("project", projectId);
}

function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value, fallback = new Date(0)) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function confidenceValue(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

function candidateSource(candidate) {
  if (Array.isArray(candidate.sourceReferences)) {
    return { references: candidate.sourceReferences };
  }
  return asRecord(candidate.sourceReferences);
}

function candidateTitle(candidate) {
  const source = candidateSource(candidate);
  return text(candidate.title)
    ?? text(source.title)
    ?? "Loop 知识候选";
}

function candidateEntryType(candidate) {
  const source = candidateSource(candidate);
  const value = text(candidate.entryType) ?? text(source.entryType);
  return value && ENTRY_TYPES.has(value) ? value : DEFAULT_ENTRY_TYPE;
}

function candidateScope(candidate) {
  const source = candidateSource(candidate);
  const value = text(candidate.scope) ?? text(source.scope);
  return value === "space" ? "space" : "project";
}

function candidateStableKey(candidate) {
  const source = candidateSource(candidate);
  return text(candidate.stableKey)
    ?? text(source.stableKey)
    ?? `legacy.candidate.${digest("knowledge-candidate-stable-key", candidate.id)}`;
}

function explicitReplacement(candidate) {
  const source = candidateSource(candidate);
  return {
    stableKey: text(candidate.replacementStableKey)
      ?? text(source.replacementStableKey)
      ?? text(source.replacementTargetStableKey),
    candidateId: text(candidate.replacementCandidateId)
      ?? text(source.replacementCandidateId),
  };
}

function provenanceReferences(candidate) {
  if (Array.isArray(candidate.sourceReferences)) return candidate.sourceReferences;
  if (candidate.sourceReferences && typeof candidate.sourceReferences === "object") {
    const references = candidate.sourceReferences.references;
    if (Array.isArray(references)) return references;
  }
  return null;
}

function validateProvenance(candidate) {
  const errors = [];
  if (!text(candidate.loopRunId)) {
    errors.push({
      code: "candidate_loop_run_missing",
      candidateId: candidate.id,
    });
  }

  const references = provenanceReferences(candidate);
  if (!references) {
    errors.push({
      code: "provenance_shape_invalid",
      candidateId: candidate.id,
    });
  } else if (references.length === 0) {
    errors.push({
      code: "provenance_references_empty",
      candidateId: candidate.id,
    });
  } else {
    for (const [referenceIndex, reference] of references.entries()) {
      if (!reference || typeof reference !== "object" || Array.isArray(reference) || !text(reference.loopRunId)) {
        errors.push({
          code: "provenance_loop_run_missing",
          candidateId: candidate.id,
          referenceIndex,
        });
      }
    }
  }

  return { errors, references: references ?? [] };
}

function validateDestinationLengths(candidate) {
  const title = candidateTitle(candidate);
  const stableKey = candidateStableKey(candidate);
  const errors = [];
  if (title.length > 191) {
    errors.push({
      code: "destination_title_too_long",
      candidateId: candidate.id,
      field: "title",
      length: title.length,
      maxLength: 191,
    });
  }
  if (stableKey.length > 191) {
    errors.push({
      code: "destination_stable_key_too_long",
      candidateId: candidate.id,
      field: "stableKey",
      length: stableKey.length,
      maxLength: 191,
    });
  }
  return { errors, title, stableKey };
}

function buildEvidence(candidate, document, revision, sourceReferences) {
  const evidence = {
    legacyCandidateDigest: digest("knowledge-candidate", candidate.id),
    legacyStatus: candidate.status,
    ...(text(candidate.loopRunId)
      ? { loopRunDigest: digest("knowledge-loop-run", candidate.loopRunId) }
      : {}),
    ...(text(candidate.loopNodeRunId)
      ? { loopNodeRunDigest: digest("knowledge-loop-node-run", candidate.loopNodeRunId) }
      : {}),
    ...(text(candidate.sourceEventId)
      ? { sourceEventDigest: digest("knowledge-source-event", candidate.sourceEventId) }
      : {}),
    ...(text(candidate.sourceArtifactId)
      ? { sourceArtifactDigest: digest("knowledge-source-artifact", candidate.sourceArtifactId) }
      : {}),
  };

  if (document) {
    const revisionVersion = Number(candidate.publishedDocumentVersion ?? document.version);
    evidence.documentDigest = digest("knowledge-document", document.id);
    evidence.documentVersion = revisionVersion;
    if (document.version !== revisionVersion) evidence.currentDocumentVersion = document.version;
    evidence.documentRevisionDigest = revision
      ? digest("knowledge-document-revision", revision.id)
      : digest("knowledge-document-revision", document.id, String(revisionVersion));
  }

  if (sourceReferences.length > 0) {
    evidence.sourceReferenceCount = sourceReferences.length;
    evidence.sourceReferenceDigests = sourceReferences.map((reference) => {
      const row = asRecord(reference);
      return {
        ...(text(row.loopRunId)
          ? { loopRunDigest: digest("knowledge-loop-run", row.loopRunId) }
          : {}),
        ...(text(row.nodeRunId)
          ? { loopNodeRunDigest: digest("knowledge-loop-node-run", row.nodeRunId) }
          : {}),
        ...(text(row.eventId)
          ? { sourceEventDigest: digest("knowledge-source-event", row.eventId) }
          : {}),
        ...(text(row.artifactId)
          ? { sourceArtifactDigest: digest("knowledge-source-artifact", row.artifactId) }
          : {}),
      };
    });
  }

  return evidence;
}

function resolveReplacement(candidate, stableKey, stableKeyGroups, candidatesById) {
  if (candidate.status !== "superseded") {
    return { errors: [], candidate: null, stableKey: null };
  }

  const replacement = explicitReplacement(candidate);
  if (!replacement.candidateId && !replacement.stableKey) {
    return {
      errors: [],
      candidate: null,
      stableKey: null,
    };
  }

  const errors = [];
  let replacementCandidate = replacement.candidateId
    ? candidatesById.get(replacement.candidateId) ?? null
    : null;
  if (replacement.candidateId && !replacementCandidate) {
    errors.push({
      code: "replacement_candidate_missing",
      candidateId: candidate.id,
      replacementCandidateId: replacement.candidateId,
    });
  }

  if (replacementCandidate && replacement.stableKey) {
    const resolvedStableKey = candidateStableKey(replacementCandidate);
    if (resolvedStableKey !== replacement.stableKey) {
      errors.push({
        code: "replacement_target_contradiction",
        candidateId: candidate.id,
        replacementCandidateId: replacement.candidateId,
        replacementStableKey: replacement.stableKey,
        candidateStableKey: resolvedStableKey,
      });
    }
  }

  if (!replacement.candidateId && replacement.stableKey) {
    const group = stableKeyGroups.get(`${candidate.projectId}\0${replacement.stableKey}`);
    if (!group || group.candidates.length === 0) {
      errors.push({
        code: "replacement_stable_key_missing",
        candidateId: candidate.id,
        replacementStableKey: replacement.stableKey,
      });
    } else if (group.candidates.length === 1) {
      replacementCandidate = group.candidates[0];
    } else {
      errors.push({
        code: "replacement_stable_key_ambiguous",
        candidateId: candidate.id,
        replacementStableKey: replacement.stableKey,
      });
    }
  }

  if (replacement.stableKey && replacement.stableKey.length > 191) {
    errors.push({
      code: "replacement_stable_key_too_long",
      candidateId: candidate.id,
      field: "replacementStableKey",
      length: replacement.stableKey.length,
      maxLength: 191,
    });
  }

  if (replacementCandidate) {
    const resolvedStableKey = candidateStableKey(replacementCandidate);
    if (replacementCandidate.projectId !== candidate.projectId) {
      errors.push({
        code: "replacement_project_mismatch",
        candidateId: candidate.id,
        replacementCandidateId: replacementCandidate.id,
        stableKey: resolvedStableKey,
        projectId: candidate.projectId,
        replacementProjectId: replacementCandidate.projectId,
      });
    }
    if (replacementCandidate.id === candidate.id || resolvedStableKey === stableKey) {
      errors.push({
        code: "replacement_self",
        candidateId: candidate.id,
        replacementCandidateId: replacementCandidate.id,
        stableKey: resolvedStableKey,
      });
    }
    if (
      errors.length === 0
      && !candidateProducesEntry(replacementCandidate, candidatesById, stableKeyGroups, new Set([candidate.id]))
    ) {
      errors.push({
        code: "replacement_target_not_publishable",
        candidateId: candidate.id,
        replacementCandidateId: replacementCandidate.id,
        replacementStatus: replacementCandidate.status,
      });
    }
  }

  if (errors.length > 0) {
    return { errors, candidate: null, stableKey: null };
  }
  return {
    errors: [],
    candidate: replacementCandidate,
    stableKey: replacement.stableKey ?? candidateStableKey(replacementCandidate),
  };
}

function candidateProducesEntry(candidate, candidatesById, stableKeyGroups, seen) {
  if (!candidate || seen.has(candidate.id)) return false;
  if (candidate.status === "published") return true;
  if (candidate.status !== "superseded") return false;
  const replacement = explicitReplacement(candidate);
  if (!replacement.candidateId && !replacement.stableKey) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(candidate.id);
  if (replacement.candidateId) {
    return candidateProducesEntry(candidatesById.get(replacement.candidateId), candidatesById, stableKeyGroups, nextSeen);
  }
  const group = stableKeyGroups.get(`${candidate.projectId}\0${replacement.stableKey}`);
  if (!group || group.candidates.length !== 1) return false;
  return candidateProducesEntry(group.candidates[0], candidatesById, stableKeyGroups, nextSeen);
}

function buildPolicy(project) {
  const digestValue = projectDigest(project.id);
  return {
    id: digest("knowledge-policy", digestValue),
    projectDigest: digestValue,
    autoPublishEnabled: false,
    minimumConfidence: 0.9,
    allowedSourceTypes: [],
    allowedEntryTypes: [],
    sourceTypeOverrides: [],
    allowAutomaticDelete: false,
    allowAutomaticExpire: false,
    allowAutomaticSupersede: false,
    scheduleTimezone: "Asia/Shanghai",
    scheduleRule: null,
    fullRebuildEvery: 10,
    subscribeSpaceKnowledge: false,
    version: 1,
  };
}

function batchState(candidate, replacementStableKey) {
  if (candidate.status === "candidate" || candidate.status === "review_required") {
    return { batchStatus: "review_required", decision: "review_required", changeType: "create", terminal: false };
  }
  if (candidate.status === "published") {
    return { batchStatus: "archiving", decision: "auto_publish", changeType: "create", terminal: false };
  }
  if (candidate.status === "rejected") {
    return { batchStatus: "rejected", decision: "reject", changeType: "create", terminal: true };
  }
  if (candidate.status === "superseded" && replacementStableKey) {
    return { batchStatus: "archiving", decision: "auto_publish", changeType: "supersede", terminal: false };
  }
  return { batchStatus: "rejected", decision: "reject", changeType: "create", terminal: true };
}

function buildBatch(candidate, projectDigestValue, state) {
  const receivedAt = dateValue(candidate.createdAt ?? candidate.updatedAt);
  const completedAt = state.terminal && state.batchStatus !== "archiving"
    ? dateValue(candidate.publishedAt ?? candidate.reviewedAt ?? candidate.updatedAt ?? candidate.createdAt)
    : null;
  const batchId = digest("knowledge-batch", "legacy-candidate", projectDigestValue, candidate.id);
  return {
    id: batchId,
    jobId: digest("knowledge-job", projectDigestValue, "legacy_backfill", candidate.id),
    projectDigest: projectDigestValue,
    submissionId: digest("knowledge-submission", "legacy-candidate", candidate.id),
    templateDigest: digest("knowledge-template", "legacy-candidate-backfill"),
    status: state.batchStatus,
    failedStage: null,
    failureClass: null,
    failureMessage: null,
    progress: state.batchStatus === "archiving" ? 45 : state.terminal ? 100 : 0,
    processedChunks: 0,
    totalChunks: 0,
    retryCount: 0,
    receivedAt,
    completedAt,
    version: 1,
    createdAt: receivedAt,
    updatedAt: completedAt ?? receivedAt,
  };
}

function buildJob(candidate, batch, state, evidence) {
  const observedAt = dateValue(candidate.updatedAt ?? candidate.createdAt);
  const sourceSnapshot = {
    observedAt: observedAt.toISOString(),
    legacyCandidateDigest: digest("knowledge-candidate", candidate.id),
    sourceRefs: (evidence.sourceReferenceDigests ?? []).map((reference) => ({
      kind: "legacy_candidate",
      sourceType: "legacy_candidate",
      ref: reference.loopRunDigest ?? evidence.legacyCandidateDigest,
    })),
  };
  return {
    id: batch.jobId,
    projectDigest: batch.projectDigest,
    taskId: digest("knowledge-task", "legacy-candidate", candidate.id),
    mode: "legacy_backfill",
    status: state.batchStatus === "review_required" ? "awaiting_submission" : "ingesting",
    templateVersionId: digest("knowledge-template-version", "legacy-candidate-backfill"),
    policyVersion: 1,
    dedupeKey: `knowledge-job:${batch.jobId}`,
    sourceSnapshot,
    sourceSnapshotDigest: digest("knowledge-job-snapshot", canonicalJson(sourceSnapshot)),
    failureCode: null,
    failureMessage: null,
    version: 1,
    createdAt: dateValue(candidate.createdAt ?? candidate.updatedAt),
    updatedAt: dateValue(candidate.updatedAt ?? candidate.createdAt),
  };
}

function decisionReason(candidate, replacementStableKey) {
  if (candidate.status === "rejected") return text(candidate.reviewReason);
  if (candidate.status === "superseded" && !replacementStableKey) {
    return text(candidate.reviewReason) ?? "legacy_superseded_without_explicit_replacement";
  }
  return null;
}

function buildItem(
  candidate,
  batch,
  stableKey,
  state,
  document,
  evidence,
  replacementStableKey,
) {
  const publishedVersion = candidate.status === "published"
    || (candidate.status === "superseded" && state.changeType === "supersede")
    ? 1
    : null;
  const createdAt = dateValue(candidate.createdAt ?? candidate.updatedAt);
  return {
    id: digest("knowledge-batch-item", batch.id, stableKey, state.changeType),
    batchId: batch.id,
    ordinal: 0,
    stableKey,
    changeType: state.changeType,
    sourceType: LEGACY_SOURCE_TYPE,
    entryType: candidateEntryType(candidate),
    title: candidateTitle(candidate),
    scope: candidateScope(candidate),
    summary: candidate.contentSummary ?? "",
    bodyMarkdown: document?.contentMarkdown ?? candidate.contentSummary ?? "",
    confidence: confidenceValue(candidate.confidence),
    tags: [],
    changeSummary: text(candidate.changeSummary)
      ?? text(candidate.reviewReason)
      ?? "旧 KnowledgeCandidate 回填",
    evidence,
    relations: [],
    baseVersion: null,
    validFrom: null,
    validUntil: null,
    decision: state.decision,
    decisionReason: decisionReason(candidate, replacementStableKey),
    publishedVersion,
    createdAt,
  };
}

function buildEntry(candidate, projectDigestValue, stableKey, status) {
  const createdAt = dateValue(candidate.createdAt ?? candidate.updatedAt);
  const updatedAt = dateValue(
    candidate.publishedAt ?? candidate.reviewedAt ?? candidate.updatedAt ?? candidate.createdAt,
  );
  return {
    id: digest("knowledge-entry", projectDigestValue, stableKey),
    projectDigest: projectDigestValue,
    stableKey,
    entryType: candidateEntryType(candidate),
    scope: candidateScope(candidate),
    status,
    latestVersion: 1,
    publishedVersion: status === "published" ? 1 : null,
    title: candidateTitle(candidate),
    searchable: false,
    version: 1,
    createdAt,
    updatedAt,
  };
}

function buildVersion(candidate, entry, batchItem, document, evidence, status) {
  const publishedAt = dateValue(
    candidate.publishedAt ?? candidate.reviewedAt ?? candidate.updatedAt ?? candidate.createdAt,
  );
  const summary = candidate.contentSummary ?? "";
  const bodyMarkdown = document?.contentMarkdown ?? summary;
  const changeSummary = status === "superseded"
    ? text(candidate.reviewReason) ?? "旧 KnowledgeCandidate 已由明确替代目标取代"
    : "旧 KnowledgeCandidate 回填";
  const tags = [];
  return {
    id: digest("knowledge-entry-version", entry.id, "1"),
    entryId: entry.id,
    version: 1,
    status,
    title: entry.title,
    summary,
    bodyMarkdown,
    entryType: entry.entryType,
    scope: entry.scope,
    tags,
    validFrom: null,
    validUntil: null,
    changeSummary,
    contentHash: digest(
      "knowledge-entry-version-content",
      entry.title,
      summary,
      bodyMarkdown,
      entry.entryType,
      entry.scope,
      "[]",
      "none",
      "none",
      changeSummary,
    ),
    sourceRefs: evidence,
    batchItemId: batchItem.id,
    publishedByDigest: text(candidate.reviewedByUserId)
      ? digest("knowledge-actor", candidate.reviewedByUserId)
      : digest("knowledge-actor", LEGACY_ACTOR),
    publishedAt,
    createdAt: publishedAt,
  };
}

function buildRelation(candidate, entry, replacementStableKey, replacementCandidate, evidence) {
  const createdAt = dateValue(candidate.reviewedAt ?? candidate.updatedAt ?? candidate.createdAt);
  return {
    id: digest(
      "knowledge-relation",
      entry.projectDigest,
      entry.id,
      "1",
      replacementStableKey,
      "supersedes",
    ),
    projectDigest: entry.projectDigest,
    fromEntryId: entry.id,
    fromVersion: 1,
    toStableKey: replacementStableKey,
    toEntryId: replacementCandidate
      ? digest("knowledge-entry", entry.projectDigest, replacementStableKey)
      : null,
    toVersion: replacementCandidate ? 1 : null,
    relationType: "supersedes",
    origin: "explicit",
    confidence: confidenceValue(candidate.confidence),
    evidence: {
      ...evidence,
      ...(replacementCandidate
        ? { replacementCandidateDigest: digest("knowledge-candidate", replacementCandidate.id) }
        : {}),
    },
    active: true,
    validFrom: null,
    validUntil: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function summarizeKnowledgeDomainBackfill(plan) {
  return {
    projects: new Set(plan.policies.map((policy) => policy.projectDigest)).size,
    candidates: plan.batches.length,
    policies: plan.policies.length,
    batches: plan.batches.length,
    jobs: plan.jobs.length,
    items: plan.items.length,
    entries: plan.entries.length,
    versions: plan.versions.length,
    relations: plan.relations.length,
    errors: plan.errors.length,
  };
}

export function planKnowledgeDomainBackfill(input) {
  const projects = input.projects ?? [];
  const candidates = input.candidates ?? [];
  const documents = input.documents ?? [];
  const documentRevisions = input.documentRevisions ?? input.revisions ?? [];
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const revisionsByDocumentAndVersion = new Map(
    documentRevisions.map((revision) => [
      `${revision.documentId}:${revision.version}`,
      revision,
    ]),
  );
  const policies = projects.map(buildPolicy);
  const jobs = [];
  const batches = [];
  const items = [];
  const entries = [];
  const versions = [];
  const relations = [];
  const errors = [];
  const invalidCandidateIds = new Set();

  const stableKeyGroups = new Map();
  for (const candidate of candidates) {
    const stableKey = candidateStableKey(candidate);
    const groupKey = `${candidate.projectId}\0${stableKey}`;
    const group = stableKeyGroups.get(groupKey) ?? { projectId: candidate.projectId, stableKey, candidates: [] };
    group.candidates.push(candidate);
    stableKeyGroups.set(groupKey, group);
  }
  for (const group of stableKeyGroups.values()) {
    if (group.candidates.length < 2) continue;
    for (const candidate of group.candidates) invalidCandidateIds.add(candidate.id);
    errors.push({
      code: "duplicate_stable_key",
      projectId: group.projectId,
      stableKey: group.stableKey,
      candidateIds: group.candidates.map((candidate) => candidate.id),
    });
  }

  for (const candidate of candidates) {
    if (invalidCandidateIds.has(candidate.id)) continue;
    const project = projectsById.get(candidate.projectId);
    if (!project) {
      errors.push({
        code: "project_missing",
        candidateId: candidate.id,
        projectId: candidate.projectId,
      });
      continue;
    }

    const lengths = validateDestinationLengths(candidate);
    const provenance = validateProvenance(candidate);
    if (lengths.errors.length > 0 || provenance.errors.length > 0) {
      errors.push(...lengths.errors, ...provenance.errors);
      continue;
    }

    const replacement = resolveReplacement(candidate, lengths.stableKey, stableKeyGroups, candidatesById);
    if (replacement.errors.length > 0) {
      errors.push(...replacement.errors);
      continue;
    }

    let document = null;
    let revision = null;
    if (candidate.status === "published") {
      document = candidate.publishedDocumentId
        ? documentsById.get(candidate.publishedDocumentId) ?? null
        : null;
      if (!document) {
        errors.push({
          code: "published_document_missing",
          candidateId: candidate.id,
          documentId: candidate.publishedDocumentId ?? null,
        });
        continue;
      }
      revision = revisionsByDocumentAndVersion.get(
        `${document.id}:${candidate.publishedDocumentVersion}`,
      ) ?? null;
      let documentError = false;
      if (document.projectId !== candidate.projectId) {
        errors.push({
          code: "published_document_project_mismatch",
          candidateId: candidate.id,
          documentId: document.id,
          projectId: candidate.projectId,
          documentProjectId: document.projectId,
        });
        documentError = true;
      }
      if (candidate.publishedDocumentVersion !== document.version && !revision) {
        errors.push({
          code: "published_document_version_mismatch",
          candidateId: candidate.id,
          documentId: document.id,
          expectedVersion: candidate.publishedDocumentVersion,
          actualVersion: document.version,
        });
        documentError = true;
      }
      if (documentError) continue;
    }

    if (!["candidate", "review_required", "published", "rejected", "superseded"].includes(candidate.status)) {
      errors.push({ code: "candidate_status_invalid", candidateId: candidate.id, status: candidate.status });
      continue;
    }

    const projectDigestValue = projectDigest(project.id);
    const stableKey = lengths.stableKey;
    const state = batchState(candidate, replacement.stableKey);
    const contentDocument = document && revision
      ? { ...document, contentMarkdown: revision.contentMarkdown }
      : document;
    const evidence = buildEvidence(candidate, document, revision, provenance.references);
    const batch = buildBatch(candidate, projectDigestValue, state);
    const job = buildJob(candidate, batch, state, evidence);
    const item = buildItem(candidate, batch, stableKey, state, contentDocument, evidence, replacement.stableKey);
    jobs.push(job);
    batches.push(batch);
    items.push(item);

    if (candidate.status !== "published" && !(candidate.status === "superseded" && replacement.stableKey)) {
      continue;
    }

    const entryStatus = candidate.status === "published" ? "published" : "superseded";
    const entry = buildEntry(candidate, projectDigestValue, stableKey, entryStatus);
    const version = buildVersion(candidate, entry, item, contentDocument, evidence, entryStatus);
    entries.push(entry);
    versions.push(version);
    if (candidate.status === "superseded" && replacement.stableKey) {
      relations.push(buildRelation(candidate, entry, replacement.stableKey, replacement.candidate, evidence));
    }
  }

  return { policies, jobs, batches, items, entries, versions, relations, errors };
}
