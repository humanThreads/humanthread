import { resolveReleaseArtifactByDownloadPath } from "@humanthread/shared";

import {
  consumeDownloadRateLimit,
  normalizeDownloadClientKey,
  readDownloadRateLimitConfig,
} from "../../../../lib/downloads/download-rate-limit";
import {
  createOssClient,
  readOssDownloadConfig,
  signReleaseArtifactDownloadUrl,
} from "../../../../lib/downloads/oss-client";
import { readReleaseCatalog } from "../../../../lib/downloads/release-catalog";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ artifact: string[] }> };

function textResponse(message: string, status: number, headers?: HeadersInit) {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { artifact: pathSegments } = await context.params;
  const downloadPath = pathSegments.join("/");
  const requestedPath = `/downloads/artifacts/${downloadPath}`;
  await requireWorkbenchSession(requestedPath);

  const definition = resolveReleaseArtifactByDownloadPath(downloadPath);
  if (!definition) return textResponse("Download not found", 404);

  let rateLimit;
  try {
    rateLimit = consumeDownloadRateLimit(
      normalizeDownloadClientKey(request),
      readDownloadRateLimitConfig(),
    );
  } catch {
    return textResponse("Download service unavailable", 503);
  }
  if (!rateLimit.allowed) {
    return textResponse("Too many download requests", 429, {
      "retry-after": String(rateLimit.retryAfterSeconds),
    });
  }

  try {
    const config = readOssDownloadConfig();
    const client = createOssClient(config);
    const catalog = await readReleaseCatalog(client);
    const entry = catalog.artifacts[definition.id];
    if (!entry) return textResponse("Download not published", 404);
    const signedUrl = signReleaseArtifactDownloadUrl(client, config, entry);
    return new Response(null, {
      status: 302,
      headers: {
        location: signedUrl,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-download-rate-limit-remaining": String(rateLimit.remaining),
      },
    });
  } catch (error) {
    const code = error instanceof Error && error.name
      ? error.name
      : "release_download_failed";
    console.error("Release download failed", { code });
    return textResponse("Download service unavailable", 503);
  }
}
