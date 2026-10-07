import {
  findKnowledgeCandidateConflicts,
  persistKnowledgeCandidate,
  publishKnowledgeCandidate,
  scanKnowledgeSensitiveText,
} from "@humanthread/db";

export interface KnowledgeSourceReference {
  loopRunId: string;
  nodeRunId?: string;
  eventId?: string;
  artifactId?: string;
}

export interface ExtractedKnowledge {
  projectId: string;
  title: string;
  content: string;
  confidence: number;
  policyAllowsAutoPublish: boolean;
  extractorVersion: string;
  sourceRefs: KnowledgeSourceReference[];
}

export interface EvaluatedKnowledge extends ExtractedKnowledge {
  safeContent: string;
  redactionResult: {
    status: "clean" | "sensitive_content_detected";
    redactionCount: number;
  };
  conflictResult: {
    status: "clear" | "conflicts_detected";
    conflicts: Array<{ documentId: string; reason: string }>;
  };
  status: "candidate" | "review_required";
}

export interface KnowledgeEvaluationDependencies {
  findConflicts(
    projectId: string,
    safeContent: string,
    title?: string,
  ): Promise<Array<{ documentId: string; reason: string }>>;
  persistCandidate(candidate: EvaluatedKnowledge): Promise<{
    id: string;
    status: string;
  }>;
  publishCandidate(candidate: { id: string; status: string }): Promise<unknown>;
  scanAndRedact?(content: string): {
    safeContent: string;
    redactionResult: EvaluatedKnowledge["redactionResult"];
  } | Promise<{
    safeContent: string;
    redactionResult: EvaluatedKnowledge["redactionResult"];
  }>;
}

interface KnowledgeExtractionInput {
  run: {
    id: string;
    projectId: string;
    status: string;
  };
  outputs: Array<{
    declaredKnowledge: boolean;
    title: string;
    content: string;
    confidence: number;
    policyAllowsAutoPublish: boolean;
    nodeRunId?: string;
    eventId?: string;
    artifactId?: string;
  }>;
  extractorVersion: string;
}

const AUTO_PUBLISH_CONFIDENCE = 0.85;

export function extractKnowledgeCandidates(input: KnowledgeExtractionInput): ExtractedKnowledge[] {
  if (input.run.status !== "completed") return [];

  return input.outputs.flatMap((output) => {
    const title = output.title.trim();
    const content = output.content.trim();
    if (!output.declaredKnowledge || !title || !content) return [];
    if (!Number.isFinite(output.confidence) || output.confidence < 0 || output.confidence > 1) {
      throw new Error("Knowledge confidence must be between 0 and 1");
    }

    return [{
      projectId: requiredId(input.run.projectId, "projectId"),
      title,
      content,
      confidence: output.confidence,
      policyAllowsAutoPublish: output.policyAllowsAutoPublish,
      extractorVersion: requiredId(input.extractorVersion, "extractorVersion"),
      sourceRefs: [{
        loopRunId: requiredId(input.run.id, "loopRunId"),
        ...(output.nodeRunId ? { nodeRunId: output.nodeRunId } : {}),
        ...(output.eventId ? { eventId: output.eventId } : {}),
        ...(output.artifactId ? { artifactId: output.artifactId } : {}),
      }],
    }];
  });
}

export async function evaluateKnowledgeCandidate(
  input: ExtractedKnowledge,
  dependencies: KnowledgeEvaluationDependencies,
): Promise<unknown> {
  if (input.sourceRefs.length === 0 || input.sourceRefs.some((source) => !source.loopRunId.trim())) {
    throw new Error("Knowledge candidate provenance is required");
  }
  const scan = await (dependencies.scanAndRedact ?? scanAndRedactKnowledge)(input.content);
  const conflicts = await dependencies.findConflicts(input.projectId, scan.safeContent, input.title);
  const requiresReview = scan.redactionResult.status !== "clean"
    || conflicts.length > 0
    || input.confidence < AUTO_PUBLISH_CONFIDENCE
    || !input.policyAllowsAutoPublish;
  const evaluated: EvaluatedKnowledge = {
    ...input,
    safeContent: scan.safeContent,
    redactionResult: scan.redactionResult,
    conflictResult: {
      status: conflicts.length > 0 ? "conflicts_detected" : "clear",
      conflicts,
    },
    status: requiresReview ? "review_required" : "candidate",
  };
  const persisted = await dependencies.persistCandidate(evaluated);
  return requiresReview ? persisted : dependencies.publishCandidate(persisted);
}

export function createKnowledgeEvaluationDependencies(input: {
  publicationActorUserId: string;
}): KnowledgeEvaluationDependencies {
  const publicationActorUserId = requiredId(input.publicationActorUserId, "publicationActorUserId");
  return {
    findConflicts: (projectId, safeContent, title = "Loop 知识候选") =>
      findKnowledgeCandidateConflicts({ projectId, safeContent, title }),
    persistCandidate: (candidate) => persistKnowledgeCandidate({
      projectId: candidate.projectId,
      title: candidate.title,
      safeContent: candidate.safeContent,
      sourceRefs: candidate.sourceRefs,
      confidence: candidate.confidence,
      redactionResult: candidate.redactionResult,
      conflictResult: candidate.conflictResult,
      extractorVersion: candidate.extractorVersion,
      status: candidate.status,
    }),
    publishCandidate: (candidate) => {
      const candidateId = typeof candidate.id === "string" ? candidate.id : "";
      return publishKnowledgeCandidate({
        candidateId: requiredId(candidateId, "candidateId"),
        actorUserId: publicationActorUserId,
      });
    },
  };
}

function scanAndRedactKnowledge(content: string): {
  safeContent: string;
  redactionResult: EvaluatedKnowledge["redactionResult"];
} {
  return scanKnowledgeSensitiveText(content);
}

function requiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}
