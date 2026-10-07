import {
  parseReleaseManifest,
  type ReleaseManifest,
} from "@humanthread/shared";

export const RELEASE_MANIFEST_OBJECT_KEY = "downloads/releases/latest.json";
export const MAX_RELEASE_MANIFEST_BYTES = 256 * 1024;

export interface EmptyReleaseCatalog {
  schemaVersion: 1;
  publishedAt: null;
  artifacts: Record<string, never>;
}

export type ReleaseCatalog = ReleaseManifest | EmptyReleaseCatalog;

export class ReleaseCatalogUnavailableError extends Error {
  readonly code = "release_catalog_unavailable" as const;
}

interface ReleaseCatalogClient {
  get(objectKey: string): Promise<{ content?: Buffer | Uint8Array | string }>;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  return candidate.status === 404
    || candidate.statusCode === 404
    || candidate.code === "NoSuchKey";
}

export async function readReleaseCatalog(
  client: ReleaseCatalogClient,
): Promise<ReleaseCatalog> {
  let result;
  try {
    result = await client.get(RELEASE_MANIFEST_OBJECT_KEY);
  } catch (error) {
    if (isNotFound(error)) {
      return { schemaVersion: 1, publishedAt: null, artifacts: {} };
    }
    throw new ReleaseCatalogUnavailableError("Release catalog could not be read");
  }

  if (result.content === undefined) {
    throw new ReleaseCatalogUnavailableError("Release catalog could not be read");
  }
  const content = Buffer.from(result.content);
  if (content.byteLength > MAX_RELEASE_MANIFEST_BYTES) {
    throw new ReleaseCatalogUnavailableError("Release catalog is too large");
  }
  try {
    return parseReleaseManifest(JSON.parse(content.toString("utf8")));
  } catch {
    throw new ReleaseCatalogUnavailableError("Release catalog is invalid");
  }
}
