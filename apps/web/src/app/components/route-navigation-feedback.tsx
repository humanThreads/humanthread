"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavigationPhase = "idle" | "active" | "completing";

const MINIMUM_VISIBLE_MS = 220;
const COMPLETION_FADE_MS = 180;
const MAXIMUM_PENDING_MS = 12_000;

function routeKey(pathname: string, searchParams: ReturnType<typeof useSearchParams>) {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function navigationTarget(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!target || target.target && target.target !== "_self" || target.hasAttribute("download") || target.dataset.noRouteProgress === "true") return null;
  const href = target.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  const url = new URL(target.href, window.location.href);
  if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol)) return null;
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash === window.location.hash) return null;
  return target;
}

export function RouteNavigationFeedback() {
  const searchParams = useSearchParams();
  const currentRouteKey = routeKey(usePathname(), searchParams);
  const observedRouteKey = useRef(currentRouteKey);
  const activeSince = useRef<number | null>(null);
  const completionTimer = useRef<number | null>(null);
  const maximumTimer = useRef<number | null>(null);
  const [phase, setPhase] = useState<NavigationPhase>("idle");

  useEffect(() => {
    function clearTimers() {
      if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
      if (maximumTimer.current !== null) window.clearTimeout(maximumTimer.current);
      completionTimer.current = null;
      maximumTimer.current = null;
    }

    function finishNavigation() {
      clearTimers();
      const elapsed = activeSince.current === null ? MINIMUM_VISIBLE_MS : performance.now() - activeSince.current;
      const remaining = Math.max(0, MINIMUM_VISIBLE_MS - elapsed);
      setPhase("completing");
      completionTimer.current = window.setTimeout(() => {
        setPhase("idle");
        document.querySelectorAll<HTMLAnchorElement>('[data-route-pending="true"]').forEach((link) => link.removeAttribute("data-route-pending"));
        activeSince.current = null;
        completionTimer.current = null;
      }, remaining + COMPLETION_FADE_MS);
    }

    function handleClick(event: MouseEvent) {
      const target = navigationTarget(event);
      if (!target) return;
      clearTimers();
      document.querySelectorAll<HTMLAnchorElement>('[data-route-pending="true"]').forEach((link) => link.removeAttribute("data-route-pending"));
      target.dataset.routePending = "true";
      activeSince.current = performance.now();
      setPhase("active");
      maximumTimer.current = window.setTimeout(finishNavigation, MAXIMUM_PENDING_MS);
    }

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (observedRouteKey.current === currentRouteKey) return;
    observedRouteKey.current = currentRouteKey;
    if (activeSince.current === null) return;
    if (maximumTimer.current !== null) window.clearTimeout(maximumTimer.current);
    maximumTimer.current = null;
    const elapsed = performance.now() - activeSince.current;
    const remaining = Math.max(0, MINIMUM_VISIBLE_MS - elapsed);
    setPhase("completing");
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
    completionTimer.current = window.setTimeout(() => {
      setPhase("idle");
      document.querySelectorAll<HTMLAnchorElement>('[data-route-pending="true"]').forEach((link) => link.removeAttribute("data-route-pending"));
      activeSince.current = null;
      completionTimer.current = null;
    }, remaining + COMPLETION_FADE_MS);
  }, [currentRouteKey]);

  return (
    <div
      data-route-progress="true"
      data-state={phase}
      aria-hidden={phase === "idle" ? "true" : undefined}
      aria-label={phase === "idle" ? undefined : "正在切换页面"}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden transition-opacity duration-150 motion-reduce:transition-none ${phase === "idle" ? "opacity-0" : "opacity-100"}`}
    >
      <div className={`h-full rounded-r-full bg-[#0969da] shadow-[0_0_8px_rgba(9,105,218,0.45)] motion-reduce:animate-none ${phase === "active" ? "animate-[route-progress_1.1s_ease-in-out_infinite]" : "w-full"}`} />
    </div>
  );
}
