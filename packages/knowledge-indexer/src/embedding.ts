export interface KnowledgeEmbeddingProfile {
  id: string;
  stableKey: string;
  provider: "onnx";
  modelId: string;
  modelRevision: string;
  modelDigest: string;
  tokenizerVersion: string;
  dimensions: number;
  maxSequenceLength: number;
  normalization: "l2";
  quantization: "int8" | "none";
  runtimeVersion: string;
  threadLimit: number;
  batchSize: number;
  localModelPath: string;
}

export interface EmbeddingProvider {
  readonly profile: KnowledgeEmbeddingProfile;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function validateKnowledgeEmbeddingProfile(input: KnowledgeEmbeddingProfile): KnowledgeEmbeddingProfile {
  if (!/^[a-f0-9]{32}$/u.test(input.id)) throw validationError("Embedding profile id must be a lowercase MD5 digest");
  if (input.provider !== "onnx") throw validationError("Embedding provider must be onnx");
  if (!Number.isInteger(input.dimensions) || input.dimensions < 64 || input.dimensions > 4_096) {
    throw validationError("Embedding dimensions are invalid");
  }
  if (!Number.isInteger(input.maxSequenceLength) || input.maxSequenceLength < 32 || input.maxSequenceLength > 8_192) {
    throw validationError("Embedding max sequence length is invalid");
  }
  if (!Number.isInteger(input.threadLimit) || input.threadLimit < 1 || input.threadLimit > 2) {
    throw validationError("Embedding thread limit must be 1 or 2");
  }
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 32) {
    throw validationError("Embedding batch size must be between 1 and 32");
  }
  if (input.normalization !== "l2") throw validationError("Embedding normalization must be l2");
  if (!input.modelId.trim() || !input.modelRevision.trim() || !input.localModelPath.trim()) {
    throw validationError("Embedding model identity is incomplete");
  }
  return { ...input };
}

export function normalizeEmbedding(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) return new Float32Array(vector.length);
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) normalized[index] = vector[index]! / norm;
  return normalized;
}

export function assertEmbeddingVector(input: {
  vector: Float32Array;
  dimensions: number;
  index: number;
}): Float32Array {
  if (input.vector.length !== input.dimensions) {
    throw validationError(`Embedding vector ${input.index} has ${input.vector.length} dimensions, expected ${input.dimensions}`);
  }
  return normalizeEmbedding(input.vector);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
