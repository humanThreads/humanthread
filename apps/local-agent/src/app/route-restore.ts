const DESKTOP_DOMAIN_PATTERN = /^\/(dashboard|tasks|agents|notifications|team|projects|documents|reports|templates|settings|onboarding|loop-runs)(?:\/[^/?#]+)*$/u;

export function normalizeDesktopRoute(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(candidate, "https://desktop.humanthread.local");
    if (url.origin !== "https://desktop.humanthread.local") return null;
    if (!DESKTOP_DOMAIN_PATTERN.test(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function selectDesktopStartupRoute(input: {
  overrideRoute?: string | null;
  lastSuccessfulRoute?: string | null;
  onboardingRequired?: boolean;
}): string {
  if (input.onboardingRequired) return "/onboarding";
  return normalizeDesktopRoute(input.overrideRoute)
    ?? normalizeDesktopRoute(input.lastSuccessfulRoute)
    ?? "/dashboard";
}
