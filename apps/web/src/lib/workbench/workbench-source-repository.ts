/**
 * AGPL-3.0 section 13 requires that users interacting with this service over a
 * network can obtain the corresponding source code. A modified deployment must
 * point this at its own published source; unset falls back to the upstream
 * repository so the default deployment stays compliant.
 */
export const SOURCE_REPOSITORY_ENV_KEY = "HUMANTHREAD_SOURCE_REPOSITORY";

export const DEFAULT_SOURCE_REPOSITORY_URL =
  "https://github.com/humanThreads/humanthread";

export function resolveSourceRepositoryUrl(
  value: string | undefined = process.env.HUMANTHREAD_SOURCE_REPOSITORY
    ?? DEFAULT_SOURCE_REPOSITORY_URL,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
