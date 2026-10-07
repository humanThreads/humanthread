"use client";

import type {
  ReleaseArtifactId,
  ReleaseManifestEntry,
} from "@humanthread/shared";
import { Check, ChevronDown, Copy, Download, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { ReleaseCatalog } from "../../lib/downloads/release-catalog";

interface DownloadCatalogProps {
  catalog: ReleaseCatalog;
  error?: boolean;
}

interface DownloadSlot {
  id: ReleaseArtifactId;
  label: string;
  architecture: string;
  href: string;
}

const DESKTOP_GROUPS: Array<{ platform: string; description: string; slots: DownloadSlot[] }> = [
  {
    platform: "macOS",
    description: "HumanThread Desktop for Mac",
    slots: [
      { id: "desktop.macos.arm64", label: "Apple Silicon", architecture: "arm64", href: "/downloads/artifacts/desktop/macos/arm64" },
      { id: "desktop.macos.x64", label: "Intel", architecture: "x64", href: "/downloads/artifacts/desktop/macos/x64" },
    ],
  },
  {
    platform: "Windows",
    description: "专用 Windows 构建机发布 MSI",
    slots: [
      { id: "desktop.windows.x64", label: "Windows x64", architecture: "x64", href: "/downloads/artifacts/desktop/windows/x64" },
    ],
  },
  {
    platform: "Linux",
    description: "Linux x64 AppImage",
    slots: [
      { id: "desktop.linux.x64", label: "Linux x64", architecture: "x64", href: "/downloads/artifacts/desktop/linux/x64" },
    ],
  },
];

function formatBytes(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  return `${megabytes >= 10 ? megabytes.toFixed(1) : megabytes.toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function ArtifactAction({ slot, entry }: { slot: DownloadSlot; entry: ReleaseManifestEntry | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!entry) {
    return <span className="text-sm font-medium text-[#8c959f]">尚未发布</span>;
  }

  async function copySha256() {
    await navigator.clipboard.writeText(entry!.sha256);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="grid min-w-0 grid-cols-3 gap-3 text-sm">
        <span><span className="block text-xs text-[#8c959f]">版本</span>{entry.version}</span>
        <span><span className="block text-xs text-[#8c959f]">大小</span>{formatBytes(entry.size)}</span>
        <span><span className="block text-xs text-[#8c959f]">发布</span>{formatDate(entry.publishedAt)}</span>
      </div>
      <a
        href={slot.href}
        className="inline-flex h-10 items-center justify-center gap-2 rounded border border-[#1f883d] bg-[#1f883d] px-4 text-sm font-semibold text-white hover:bg-[#1a7f37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f883d] active:translate-y-px"
      >
        <Download aria-hidden="true" size={16} />
        下载 {slot.label}
      </a>
      <details className="col-span-full min-w-0 border-t border-[#d8dee4] pt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-[#57606a]">
          <ChevronDown aria-hidden="true" size={14} />
          SHA256
        </summary>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-[#f6f8fa] px-2 py-1.5 text-xs text-[#24292f]" title={entry.sha256}>
            {entry.sha256}
          </code>
          <button
            type="button"
            onClick={copySha256}
            title={`复制 ${slot.label} SHA256`}
            aria-label={`复制 ${slot.label} SHA256`}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded border border-[#d0d7de] bg-white text-[#24292f] hover:bg-[#f6f8fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f883d] active:translate-y-px"
          >
            {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
          </button>
          <span aria-live="polite" className="w-10 text-xs text-[#1f883d]">{copied ? "已复制" : ""}</span>
        </div>
      </details>
    </div>
  );
}

export function DownloadCatalog({ catalog, error = false }: DownloadCatalogProps) {
  const [activeDesktopPlatform, setActiveDesktopPlatform] = useState(DESKTOP_GROUPS[0]!.platform);
  if (error) {
    return (
      <div className="border border-[#d0d7de] bg-white p-5">
        <h2 className="text-base font-semibold text-[#24292f]">当前无法读取发行信息</h2>
        <p className="mt-1 text-sm text-[#57606a]">下载服务未返回有效目录，请稍后重试。</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded border border-[#d0d7de] bg-white px-3 text-sm font-semibold text-[#24292f] hover:bg-[#f6f8fa] active:translate-y-px"
        >
          <RefreshCw aria-hidden="true" size={15} />
          重试
        </button>
      </div>
    );
  }

  const activeDesktopGroup = DESKTOP_GROUPS.find(
    (group) => group.platform === activeDesktopPlatform,
  ) ?? DESKTOP_GROUPS[0]!;

  function selectDesktopPlatform(index: number) {
    const group = DESKTOP_GROUPS[index];
    if (!group) return;
    setActiveDesktopPlatform(group.platform);
    document.getElementById(`desktop-tab-${group.platform.toLowerCase()}`)?.focus();
  }

  function handleDesktopTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % DESKTOP_GROUPS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + DESKTOP_GROUPS.length) % DESKTOP_GROUPS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = DESKTOP_GROUPS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectDesktopPlatform(nextIndex);
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="desktop-downloads-title">
        <div className="mb-3">
          <h2 id="desktop-downloads-title" className="text-lg font-semibold text-[#24292f]">Desktop</h2>
          <p className="mt-1 text-sm text-[#57606a]">选择目标系统。未发布的安装包不会生成下载链接。</p>
        </div>
        <div className="border-y border-[#d8dee4] bg-white">
          <div
            role="tablist"
            aria-label="Desktop 平台"
            className="grid grid-cols-3 border-b border-[#d8dee4] bg-[#f6f8fa]"
          >
            {DESKTOP_GROUPS.map((group, index) => {
              const selected = group.platform === activeDesktopGroup.platform;
              return (
                <button
                  key={group.platform}
                  id={`desktop-tab-${group.platform.toLowerCase()}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`desktop-panel-${group.platform.toLowerCase()}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveDesktopPlatform(group.platform)}
                  onKeyDown={(event) => handleDesktopTabKeyDown(event, index)}
                  className={`min-h-11 border-b-2 px-3 py-2 text-sm font-semibold transition focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1f883d] ${selected ? "border-[#1f883d] bg-white text-[#24292f]" : "border-transparent text-[#57606a] hover:bg-white hover:text-[#24292f]"}`}
                >
                  {group.platform}
                </button>
              );
            })}
          </div>
          <div
            id={`desktop-panel-${activeDesktopGroup.platform.toLowerCase()}`}
            role="tabpanel"
            aria-labelledby={`desktop-tab-${activeDesktopGroup.platform.toLowerCase()}`}
            className="grid gap-5 px-4 py-5 lg:grid-cols-[180px_minmax(0,1fr)]"
          >
            <div>
              <h3 className="font-semibold text-[#24292f]">{activeDesktopGroup.platform}</h3>
              <p className="mt-1 text-sm text-[#57606a]">{activeDesktopGroup.description}</p>
            </div>
            <div className="grid gap-5">
              {activeDesktopGroup.slots.map((slot) => (
                <div key={slot.id} className="grid min-h-20 gap-3 border-l border-[#d8dee4] pl-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start">
                  <div>
                    <p className="text-sm font-semibold text-[#24292f]">{slot.label}</p>
                    <p className="text-xs text-[#8c959f]">{slot.architecture}</p>
                  </div>
                  <ArtifactAction slot={slot} entry={catalog.artifacts[slot.id]} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="android-download-title" className="grid gap-4 border-y border-[#d8dee4] bg-white px-4 py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div>
          <h2 id="android-download-title" className="text-lg font-semibold text-[#24292f]">Android 手机客户端</h2>
          <p className="mt-1 text-sm text-[#57606a]">由配置 Android 工具链和签名材料的构建机发布通用 APK。</p>
        </div>
        <ArtifactAction
          slot={{ id: "mobile.android.universal", label: "Android APK", architecture: "universal", href: "/downloads/artifacts/mobile/android" }}
          entry={catalog.artifacts["mobile.android.universal"]}
        />
      </section>

      <section aria-labelledby="cli-download-title" className="border-y border-[#d8dee4] bg-white px-4 py-5">
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div>
            <h2 id="cli-download-title" className="text-lg font-semibold text-[#24292f]">Agent CLI</h2>
            <p className="mt-1 text-sm text-[#57606a]">单一跨平台包。安装前需要 Node.js 22+ 和 npm。</p>
          </div>
          <ArtifactAction
            slot={{ id: "cli.node", label: "Agent CLI", architecture: "Node.js", href: "/downloads/artifacts/cli" }}
            entry={catalog.artifacts["cli.node"]}
          />
        </div>
        <div className="mt-5 grid gap-3 border-t border-[#d8dee4] pt-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-[#24292f]">Unix Shell</h3>
            <code className="mt-2 block overflow-x-auto rounded bg-[#f6f8fa] px-3 py-2 text-xs">npm install -g ./humanthread-cli.tgz</code>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#24292f]">Windows</h3>
            <code className="mt-2 block overflow-x-auto rounded bg-[#f6f8fa] px-3 py-2 text-xs">npm install -g .\humanthread-cli.tgz</code>
          </div>
          <p className="text-sm text-[#57606a] md:col-span-2">安装完成后运行 <code className="rounded bg-[#f6f8fa] px-1.5 py-0.5 text-xs text-[#24292f]">ht --help</code> 验证。</p>
        </div>
      </section>
    </div>
  );
}
