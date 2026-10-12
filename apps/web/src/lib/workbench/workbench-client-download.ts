/**
 * Kept local on purpose: `workbench-site-settings` pulls in the Prisma client,
 * and this module is reachable from client components. Importing it from there
 * dragged the database driver into the browser/edge graph and broke the build.
 */
export const OFFICIAL_SITE_BASE_URL = "https://www.humanthread.cn";

/**
 * Official release catalog. Private deployments do not ship a release catalog
 * of their own, so their download entry points send the user here instead of
 * rendering an empty or broken in-app catalog.
 */
export const OFFICIAL_CLIENT_DOWNLOAD_URL = `${OFFICIAL_SITE_BASE_URL}/downloads`;

export const OFFICIAL_SITE_HOST = new URL(OFFICIAL_SITE_BASE_URL).hostname;

function parseSiteHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * An unset or unparsable deployment address is treated as private: the safe
 * default is to hand the user to the official catalog rather than advertise a
 * download surface this deployment cannot guarantee.
 */
export function isPrivateDeploymentSite(siteBaseUrl: string | null | undefined): boolean {
  const host = parseSiteHost(siteBaseUrl);
  return host !== OFFICIAL_SITE_HOST;
}

export function resolveClientDownloadHref(siteBaseUrl: string | null | undefined): string {
  return isPrivateDeploymentSite(siteBaseUrl) ? OFFICIAL_CLIENT_DOWNLOAD_URL : "/downloads";
}

export function resolveClientDownloadHrefFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return resolveClientDownloadHref(
    env.HUMANTHREAD_SITE_BASE_URL ?? OFFICIAL_SITE_BASE_URL,
  );
}

/**
 * Guards the `/downloads` route itself. Entry points already link to the
 * official catalog on private deployments, but bookmarks and direct
 * navigation must not surface an empty local release catalog either.
 */
export function resolveClientDownloadRedirect(
  siteBaseUrl: string | null | undefined,
): string | null {
  return isPrivateDeploymentSite(siteBaseUrl) ? OFFICIAL_CLIENT_DOWNLOAD_URL : null;
}

export function resolveClientDownloadRedirectFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return resolveClientDownloadRedirect(
    env.HUMANTHREAD_SITE_BASE_URL ?? OFFICIAL_SITE_BASE_URL,
  );
}
