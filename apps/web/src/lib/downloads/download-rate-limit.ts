export interface DownloadRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface DownloadRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

interface Bucket {
  startedAt: number;
  count: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10000;

function pruneBuckets(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= windowMs) buckets.delete(key);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (typeof oldestKey !== "string") break;
    buckets.delete(oldestKey);
  }
}

export function readDownloadRateLimitConfig(
  env: Record<string, string | undefined> = process.env,
): DownloadRateLimitConfig {
  const maxRequests = Number(env.HUMANTHREAD_DOWNLOAD_RATE_LIMIT_MAX ?? "5");
  const windowSeconds = Number(
    env.HUMANTHREAD_DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS ?? "60",
  );
  if (!Number.isInteger(maxRequests) || maxRequests <= 0 || maxRequests > 100) {
    throw new Error("HUMANTHREAD_DOWNLOAD_RATE_LIMIT_MAX must be between 1 and 100");
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0 || windowSeconds > 3600) {
    throw new Error(
      "HUMANTHREAD_DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS must be between 1 and 3600",
    );
  }
  return { maxRequests, windowMs: windowSeconds * 1000 };
}

export function consumeDownloadRateLimit(
  key: string,
  config: DownloadRateLimitConfig = readDownloadRateLimitConfig(),
  now = Date.now(),
): DownloadRateLimitResult {
  if (!buckets.has(key)) pruneBuckets(now, config.windowMs);
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= config.windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(config.windowMs / 1000),
      remaining: Math.max(0, config.maxRequests - 1),
    };
  }
  if (current.count >= config.maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((config.windowMs - (now - current.startedAt)) / 1000),
      ),
      remaining: 0,
    };
  }
  current.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((config.windowMs - (now - current.startedAt)) / 1000),
    ),
    remaining: Math.max(0, config.maxRequests - current.count),
  };
}

export function resetDownloadRateLimitForTests(): void {
  buckets.clear();
}

export function normalizeDownloadClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const address = forwarded || realIp || "unknown";
  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "unknown";
  const family = userAgent.includes("mac")
    ? "mac"
    : userAgent.includes("windows")
      ? "windows"
      : userAgent.includes("linux")
        ? "linux"
        : "other";
  return `${address}:${family}`;
}
