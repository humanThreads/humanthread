import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  assertCanReadProject,
  prisma,
} from "../../../../../packages/db/src/index";

export const LOOP_REVIEW_ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;
export const LOOP_REVIEW_ARTIFACT_MIME_TYPE = "text/html";

type ReviewArtifactRecord = {
  id: string;
  projectId: string;
  storageKey: string;
  mimeType: string;
  byteSize: bigint | number;
  type: string;
  metadata: unknown;
};

type ReviewArtifactDb = {
  artifact: {
    findUnique(args: unknown): Promise<ReviewArtifactRecord | null>;
    create(args: unknown): Promise<ReviewArtifactRecord>;
  };
};

export type LoopReviewArtifactReference = {
  artifactId: string;
  storageKey: string;
  fileName: string;
  mimeType: typeof LOOP_REVIEW_ARTIFACT_MIME_TYPE;
  byteSize: number;
  checksum: string;
  relativePath: string;
  href: string;
};

export function resolveLoopReviewArtifactStorageRoot(cwd = process.cwd()) {
  const normalized = resolve(cwd);
  return basename(normalized) === "web" && basename(dirname(normalized)) === "apps"
    ? join(normalized, "storage", "loop-review-artifacts")
    : join(normalized, "apps", "web", "storage", "loop-review-artifacts");
}

export function normalizeLoopReviewArtifactPath(value: string): string {
  const relativePath = value.trim().replace(/^\.\/+/u, "");
  const segments = relativePath.split("/");
  if (
    !relativePath.startsWith("generated/reviews/")
    || !/\.html?$/iu.test(relativePath)
    || relativePath.startsWith("/")
    || relativePath.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(relativePath)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw artifactError("invalid_review_artifact_path", "Review Artifact path must be a relative HTML file under generated/reviews");
  }
  return relativePath;
}

export async function saveLoopReviewArtifact(input: {
  projectId: string;
  taskId: string | null;
  agentRunId: string;
  loopNodeRunId: string;
  relativePath: string;
  content: string;
  now?: Date;
}, dependencies: {
  db?: ReviewArtifactDb;
  storageRoot?: string;
} = {}): Promise<LoopReviewArtifactReference> {
  const relativePath = normalizeLoopReviewArtifactPath(input.relativePath);
  const bytes = Buffer.from(input.content, "utf8");
  if (bytes.byteLength === 0 || bytes.byteLength > LOOP_REVIEW_ARTIFACT_MAX_BYTES) {
    throw artifactError("invalid_review_artifact_content", "Review Artifact content is empty or too large");
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const artifactId = createHash("md5").update([
    "loop-review-artifact",
    input.loopNodeRunId,
    relativePath,
    checksum,
  ].join("\0")).digest("hex");
  const projectDigest = createHash("md5").update(["loop-review-project", input.projectId].join("\0")).digest("hex");
  const storageKey = `loop-review-artifacts/${projectDigest}/${artifactId}.html`;
  const storageRoot = dependencies.storageRoot ?? resolveLoopReviewArtifactStorageRoot();
  const filePath = join(storageRoot, storageKey);
  const metadata = {
    fileName: basename(relativePath),
    relativePath,
    checksum,
    source: "agent_review",
  };
  const db = dependencies.db ?? prisma as unknown as ReviewArtifactDb;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  const existing = await db.artifact.findUnique({
    where: { id: artifactId },
    select: {
      id: true,
      projectId: true,
      storageKey: true,
      mimeType: true,
      byteSize: true,
      type: true,
      metadata: true,
    },
  });
  if (existing) {
    assertMatchingReviewArtifact(existing, { projectId: input.projectId, storageKey, checksum });
    return projectReviewArtifactReference(existing, relativePath, checksum);
  }

  try {
    const created = await db.artifact.create({
      data: {
        id: artifactId,
        projectId: input.projectId,
        taskId: input.taskId,
        agentRunId: input.agentRunId,
        loopNodeRunId: input.loopNodeRunId,
        type: "review_html",
        storageKey,
        checksum,
        mimeType: LOOP_REVIEW_ARTIFACT_MIME_TYPE,
        byteSize: BigInt(bytes.byteLength),
        metadata,
        createdAt: input.now ?? new Date(),
      },
      select: {
        id: true,
        projectId: true,
        storageKey: true,
        mimeType: true,
        byteSize: true,
        type: true,
        metadata: true,
      },
    });
    return projectReviewArtifactReference(created, relativePath, checksum);
  } catch (error) {
    const raced = await db.artifact.findUnique({
      where: { id: artifactId },
      select: {
        id: true,
        projectId: true,
        storageKey: true,
        mimeType: true,
        byteSize: true,
        type: true,
        metadata: true,
      },
    });
    if (raced) {
      assertMatchingReviewArtifact(raced, { projectId: input.projectId, storageKey, checksum });
      return projectReviewArtifactReference(raced, relativePath, checksum);
    }
    await rm(filePath, { force: true });
    throw error;
  }
}

export async function readLoopReviewArtifact(input: {
  userId: string;
  artifactId: string;
}, dependencies: {
  db?: Pick<ReviewArtifactDb, "artifact">;
  storageRoot?: string;
  assertCanReadProject?: typeof assertCanReadProject;
} = {}) {
  const db = dependencies.db ?? prisma as unknown as ReviewArtifactDb;
  const artifact = await db.artifact.findUnique({
    where: { id: input.artifactId },
    select: {
      id: true,
      projectId: true,
      storageKey: true,
      mimeType: true,
      byteSize: true,
      type: true,
      metadata: true,
    },
  });
  if (!artifact || artifact.type !== "review_html" || artifact.mimeType !== LOOP_REVIEW_ARTIFACT_MIME_TYPE) {
    throw artifactError("not_found", "Review Artifact not found");
  }
  await (dependencies.assertCanReadProject ?? assertCanReadProject)({
    userId: input.userId,
    projectId: artifact.projectId,
  });
  const metadata = readRecord(artifact.metadata);
  const relativePath = normalizeLoopReviewArtifactPath(readText(metadata?.relativePath) ?? "");
  const checksum = readText(metadata?.checksum) ?? "";
  const fileName = readText(metadata?.fileName) ?? basename(relativePath);
  const filePath = join(
    dependencies.storageRoot ?? resolveLoopReviewArtifactStorageRoot(),
    assertStorageKey(artifact.storageKey),
  );
  const bytes = new Uint8Array(await readFile(filePath));
  return {
    artifactId: artifact.id,
    storageKey: artifact.storageKey,
    projectId: artifact.projectId,
    fileName,
    relativePath,
    mimeType: LOOP_REVIEW_ARTIFACT_MIME_TYPE,
    byteSize: Number(artifact.byteSize),
    checksum,
    href: `/api/loop-artifacts/${artifact.id}`,
    bytes,
  };
}

function projectReviewArtifactReference(
  artifact: ReviewArtifactRecord,
  relativePath: string,
  checksum: string,
): LoopReviewArtifactReference {
  const metadata = readRecord(artifact.metadata);
  return {
    artifactId: artifact.id,
    storageKey: artifact.storageKey,
    fileName: readText(metadata?.fileName) ?? basename(relativePath),
    mimeType: LOOP_REVIEW_ARTIFACT_MIME_TYPE,
    byteSize: Number(artifact.byteSize),
    checksum,
    relativePath,
    href: `/api/loop-artifacts/${artifact.id}`,
  };
}

function assertMatchingReviewArtifact(
  artifact: ReviewArtifactRecord,
  expected: { projectId: string; storageKey: string; checksum: string },
): void {
  const metadata = readRecord(artifact.metadata);
  if (
    artifact.projectId !== expected.projectId
    || artifact.storageKey !== expected.storageKey
    || artifact.mimeType !== LOOP_REVIEW_ARTIFACT_MIME_TYPE
    || readText(metadata?.checksum) !== expected.checksum
  ) {
    throw artifactError("version_conflict", "Review Artifact identity changed");
  }
}

function assertStorageKey(value: string): string {
  if (!/^loop-review-artifacts\/[a-f0-9]{32}\/[a-f0-9]{32}\.html$/u.test(value)) {
    throw artifactError("invalid_review_artifact_storage", "Review Artifact storage key is invalid");
  }
  return value;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function artifactError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
