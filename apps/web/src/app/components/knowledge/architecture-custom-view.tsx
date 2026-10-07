"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ArchitectureManifest } from "@humanthread/shared";

export const ARCHITECTURE_BUNDLE_IFRAME_SANDBOX = "allow-scripts";
export const ARCHITECTURE_BUNDLE_LOAD_TIMEOUT_MS = 5_000;

type BundleStatus = "loading" | "ready" | "fallback";

export function getArchitectureBundleStatus(input: { loaded: boolean; timedOut: boolean }): "ready" | "fallback" {
  return input.loaded && !input.timedOut ? "ready" : "fallback";
}

export function ArchitectureCustomView({
  projectId,
  viewId,
  bundleUrl,
  selectedKey,
  manifest,
  fallback,
  initialStatus = "fallback",
}: {
  projectId: string;
  viewId: string;
  bundleUrl: string;
  selectedKey: string;
  manifest: ArchitectureManifest;
  fallback: React.ReactNode;
  initialStatus?: BundleStatus;
}) {
  const [status, setStatus] = useState<BundleStatus>(initialStatus);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [nonce] = useState(() => createNonce());

  const postInit = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      { type: "humanthread:architecture:init", nonce, projectId, viewId, selectedKey, manifest },
      "*",
    );
  }, [manifest, nonce, projectId, selectedKey, viewId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus((current) => current === "ready" ? current : "fallback");
    }, ARCHITECTURE_BUNDLE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [bundleUrl, initialStatus]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: unknown; nonce?: unknown } | null;
      if (!data || data.nonce !== nonce) return;
      if (data.type === "humanthread:architecture:ready") {
        setStatus("ready");
        postInit();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce, postInit]);

  if (status === "fallback") return <>{fallback}</>;

  return (
    <div className="relative min-h-[620px] overflow-hidden rounded-lg border border-[#d0d7de] bg-white">
      {status === "loading" ? (
        <div className="absolute inset-x-0 top-0 z-10 border-b border-[#d8dee4] bg-[#f6f8fa] px-3 py-2 text-xs text-[#57606a]">正在加载架构视图…</div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={manifest.title}
        src={bundleUrl}
        sandbox={ARCHITECTURE_BUNDLE_IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        loading="eager"
        onLoad={postInit}
        className="min-h-[620px] w-full border-0 bg-white"
      />
    </div>
  );
}

function createNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `architecture-${Math.random().toString(36).slice(2)}`;
}
