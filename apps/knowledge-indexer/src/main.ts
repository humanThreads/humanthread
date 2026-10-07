import { QdrantClient } from "@qdrant/js-client-rest";

import {
  createOnnxEmbeddingProvider,
  createQdrantKnowledgeIndexEngine,
  knowledgeAliasName,
  knowledgeCollectionName,
  searchKnowledge,
  runKnowledgeIndexJob,
  type KnowledgeEmbeddingProfile,
} from "@humanthread/knowledge-indexer";

import { createKnowledgeIndexerServer } from "./http";
import { createPlatformKnowledgeIndexStore } from "./platform";

const qdrantUrl = process.env.HUMANTHREAD_QDRANT_URL?.trim();
const qdrantApiKey = process.env.HUMANTHREAD_QDRANT_API_KEY?.trim();
const modelPath = process.env.HUMANTHREAD_EMBEDDING_MODEL_PATH?.trim();
const profileId = process.env.HUMANTHREAD_EMBEDDING_PROFILE_ID?.trim();
if (!qdrantUrl || !modelPath || !profileId) {
  throw new Error("Knowledge indexer Qdrant URL, embedding profile ID, and model path are required");
}

const client = new QdrantClient({ url: qdrantUrl, ...(qdrantApiKey ? { apiKey: qdrantApiKey } : {}) });
const engine = createQdrantKnowledgeIndexEngine(client as never);
const store = createPlatformKnowledgeIndexStore();
const profile: KnowledgeEmbeddingProfile = {
  id: profileId,
  stableKey: process.env.HUMANTHREAD_EMBEDDING_PROFILE_KEY?.trim() || "bge-small-zh-v1.5-int8",
  provider: "onnx",
  modelId: process.env.HUMANTHREAD_EMBEDDING_MODEL_ID?.trim() || "BAAI/bge-small-zh-v1.5",
  modelRevision: process.env.HUMANTHREAD_EMBEDDING_MODEL_REVISION?.trim() || "main",
  modelDigest: process.env.HUMANTHREAD_EMBEDDING_MODEL_DIGEST?.trim() || "0".repeat(64),
  tokenizerVersion: process.env.HUMANTHREAD_EMBEDDING_TOKENIZER_VERSION?.trim() || "tokenizer/v1",
  dimensions: Number(process.env.HUMANTHREAD_EMBEDDING_DIMENSIONS ?? 512),
  maxSequenceLength: Number(process.env.HUMANTHREAD_EMBEDDING_MAX_LENGTH ?? 512),
  normalization: "l2",
  quantization: "int8",
  runtimeVersion: process.env.HUMANTHREAD_EMBEDDING_RUNTIME_VERSION?.trim() || "onnxruntime-node/1.30.0",
  threadLimit: Number(process.env.HUMANTHREAD_EMBEDDING_THREADS ?? 1),
  batchSize: Number(process.env.HUMANTHREAD_EMBEDDING_BATCH_SIZE ?? 4),
  localModelPath: modelPath,
};

const { pipeline, env } = await import("@huggingface/transformers");
env.allowRemoteModels = false;
env.allowLocalModels = true;
const featureExtractor = await pipeline("feature-extraction", profile.localModelPath, {
  dtype: profile.quantization === "int8" ? "q8" : "fp32",
  local_files_only: true,
});
const embedding = await createOnnxEmbeddingProvider(profile, {
  createFeatureExtractor: async () => (texts, options) => featureExtractor(texts, options) as never,
});

const port = Number(process.env.PORT ?? 3100);
const server = createKnowledgeIndexerServer({
  writer: store,
  runner: {
    run: ({ job, versions }) => runKnowledgeIndexJob({
      projectDigest: job.projectDigest,
      indexVersion: job.indexVersion,
      embeddingProfileId: job.embeddingProfileId,
      collectionName: knowledgeCollectionName({
        projectDigest: job.projectDigest,
        embeddingProfileId: job.embeddingProfileId,
        chunkerVersion: job.chunkerVersion,
        indexVersion: job.indexVersion,
      }),
      aliasName: knowledgeAliasName(job.projectDigest),
      versions,
      engine,
      embedding,
    }),
  },
  loadVersions: store.loadVersions,
  search: {
    search: (request) => searchKnowledge({
      request,
      engine,
      embedding,
    }),
  },
  health: async () => {
    try {
      await client.getCollections();
      return { ok: true, qdrant: true };
    } catch {
      return { ok: false, qdrant: false };
    }
  },
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "knowledge_indexer_started", port }));
});
