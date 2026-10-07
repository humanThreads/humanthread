const SAFE_REVISION = /^[0-9a-f]{7,64}$/u;

export function formatBuildVersion(product: string, version: string, revision?: string): string {
  const normalizedVersion = version.trim().replace(/^v/iu, "") || "unknown";
  const normalizedRevision = revision?.trim().toLowerCase() ?? "";
  const prefix = `${product.trim()} v${normalizedVersion}`;
  return SAFE_REVISION.test(normalizedRevision) ? `${prefix} · ${normalizedRevision.slice(0, 8)}` : prefix;
}
