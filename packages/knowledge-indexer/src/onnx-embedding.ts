import type { EmbeddingProvider, KnowledgeEmbeddingProfile } from "./embedding";
import { assertEmbeddingVector, validateKnowledgeEmbeddingProfile } from "./embedding";

export interface OnnxFeatureExtractor {
  (texts: string[], options: {
    pooling: "mean";
    normalize: false;
    max_length: number;
  }): Promise<{ data: Float32Array | number[]; dims: number[] }>;
}

export interface OnnxEmbeddingDependencies {
  createFeatureExtractor(profile: KnowledgeEmbeddingProfile): Promise<OnnxFeatureExtractor>;
}

export async function createOnnxEmbeddingProvider(
  input: KnowledgeEmbeddingProfile,
  dependencies: OnnxEmbeddingDependencies,
): Promise<EmbeddingProvider> {
  const profile = validateKnowledgeEmbeddingProfile(input);
  const extractor = await dependencies.createFeatureExtractor(profile);
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = async () => {
    if (active >= profile.threadLimit) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
  };
  const release = () => {
    active -= 1;
    queue.shift()?.();
  };
  return {
    profile,
    async embed(texts) {
      const vectors: Float32Array[] = [];
      for (let offset = 0; offset < texts.length; offset += profile.batchSize) {
        const batch = texts.slice(offset, offset + profile.batchSize);
        await acquire();
        try {
          const output = await extractor(batch, {
            pooling: "mean",
            normalize: false,
            max_length: profile.maxSequenceLength,
          });
          const raw = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
          for (let index = 0; index < batch.length; index += 1) {
            const start = index * profile.dimensions;
            vectors.push(assertEmbeddingVector({
              vector: raw.slice(start, start + profile.dimensions),
              dimensions: profile.dimensions,
              index: offset + index,
            }));
          }
        } finally {
          release();
        }
      }
      return vectors;
    },
  };
}
