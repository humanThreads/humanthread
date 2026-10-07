import { AlertCircle, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { PrimaryNavigation, type DesktopNavigationKey } from "../components/shell/primary-navigation";
import { TopBar } from "../components/shell/top-bar";
import { AGENT_BUILD_VERSION } from "../lib/build-version";

export function DesktopShell(props: {
  activeKey: DesktopNavigationKey;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cacheNoticeOpen, setCacheNoticeOpen] = useState(false);
  const CollapseIcon = collapsed ? ChevronRight : ChevronLeft;

  return (
    <div
      className="desktop-shell"
      data-mobile-nav-open={String(mobileOpen)}
      data-nav-collapsed={String(collapsed)}
    >
      <a className="skip-link" href="#desktop-feature-canvas">跳到主要内容</a>
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <img src="./brand/humanthread-mark.svg" alt="" />
          <span className="desktop-brand-copy">
            <strong>HumanThread</strong>
            <small>Desktop</small>
          </span>
          <button
            aria-label="关闭主导航"
            className="desktop-nav-close"
            onClick={() => setMobileOpen(false)}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
        <PrimaryNavigation
          activeKey={props.activeKey}
          collapsed={collapsed}
          onNavigate={() => setMobileOpen(false)}
        />
        <div className="desktop-sidebar-footer">
          <div className="relative">
            <button
              aria-label="本地会话缓存说明"
              className="desktop-nav-collapse"
              onBlur={() => setCacheNoticeOpen(false)}
              onClick={() => setCacheNoticeOpen((open) => !open)}
              onFocus={() => setCacheNoticeOpen(true)}
              onMouseEnter={() => setCacheNoticeOpen(true)}
              onMouseLeave={() => setCacheNoticeOpen(false)}
              type="button"
            >
              <AlertCircle aria-hidden="true" size={16} />
              <span>本地缓存</span>
            </button>
            {cacheNoticeOpen ? <div role="tooltip" className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border border-[#d0d7de] bg-white p-3 text-sm shadow-lg">
              <strong>本地会话缓存</strong>
              <p className="mt-1 leading-6 text-[#57606a]">删除本地缓存后，刷新页面不会恢复这部分内容；服务端只做实时转发，不保留会话正文。</p>
              <p className="mt-2 text-xs text-[#6e7781]">默认保留 30 天，可在设置中修改；会话结束后按保留策略清理。</p>
            </div> : null}
          </div>
          <button
            aria-label={collapsed ? "展开主导航" : "收起主导航"}
            className="desktop-nav-collapse"
            onClick={() => setCollapsed((current) => !current)}
            type="button"
          >
            <CollapseIcon aria-hidden="true" size={16} />
            <span>{collapsed ? "展开" : "收起"}</span>
          </button>
          <p className="desktop-build-version" title={AGENT_BUILD_VERSION}>{AGENT_BUILD_VERSION}</p>
        </div>
      </aside>
      {mobileOpen ? (
        <button
          aria-label="关闭导航遮罩"
          className="desktop-nav-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}
      <TopBar onOpenMobileNav={() => setMobileOpen(true)} />
      <main className="desktop-feature-canvas" id="desktop-feature-canvas">{props.children}</main>
    </div>
  );
}
