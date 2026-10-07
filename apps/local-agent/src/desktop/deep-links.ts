import { normalizeDesktopRoute } from "../app/route-restore";

const ALLOWED_DEEP_LINK_PATH = /^\/(dashboard|tasks(?:\/[A-Za-z0-9_-]+)?|agents(?:\/[A-Za-z0-9_-]+)?|notifications|team|projects(?:\/[A-Za-z0-9_-]+)?|documents(?:\/[A-Za-z0-9_-]+)?|reports|templates|settings|loop-runs\/[A-Za-z0-9_-]+)$/u;
const HANDOFF_PATH = "/api/desktop/web-handoff/consume";

export function resolveDesktopDeepLink(value: string): string | null {
  const raw = value.trim();
  if (/\.{2}|%2e/iu.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "humanthread:" ||
      url.hostname !== "open" ||
      url.username ||
      url.password ||
      url.hash ||
      !ALLOWED_DEEP_LINK_PATH.test(url.pathname)
    ) return null;
    for (const key of url.searchParams.keys()) {
      const allowed = url.pathname === "/notifications" ? key === "item" : url.pathname.startsWith("/loop-runs/") && (key === "interaction" || key === "message");
      if (!allowed) return null;
    }
    return normalizeDesktopRoute(`${url.pathname}${url.search}`);
  } catch {
    return null;
  }
}

export function isAllowedWebHandoffUrl(value: string, deploymentUrl: string): boolean {
  try {
    const target = new URL(value.trim());
    const deployment = new URL(deploymentUrl.trim());
    const code = target.searchParams.get("code")?.trim() ?? "";
    return target.origin === deployment.origin &&
      target.pathname === HANDOFF_PATH &&
      !target.username &&
      !target.password &&
      !target.hash &&
      target.searchParams.size === 1 &&
      code.length > 0 &&
      code.length <= 256;
  } catch {
    return false;
  }
}

export async function subscribeDesktopDeepLinks(input: {
  onOpenUrl(handler: (urls: string[]) => void): Promise<() => void>;
  navigate(route: string): void;
}): Promise<() => void> {
  return input.onOpenUrl((urls) => routeDesktopDeepLinks(urls, input.navigate));
}

export function routeDesktopDeepLinks(
  urls: string[],
  navigate: (route: string) => void,
): void {
  for (const url of urls) {
    const route = resolveDesktopDeepLink(url);
    if (route) navigate(route);
  }
}

export async function openWebHandoff(input: {
  url: string;
  deploymentUrl: string;
  openUrl(url: string): Promise<void>;
}): Promise<void> {
  if (!isAllowedWebHandoffUrl(input.url, input.deploymentUrl)) {
    throw new Error("Web handoff URL is not allowed");
  }
  await input.openUrl(input.url);
}
