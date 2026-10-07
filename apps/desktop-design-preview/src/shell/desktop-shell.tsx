import { useState, type ReactNode } from "react";

import { Sidebar, type DesktopNavigationKey } from "./sidebar";
import { GlobalSearch } from "./global-search";
import { QuickCreate } from "./quick-create";
import { TopBar } from "./topbar";

export function DesktopShell(props: {
  activeKey: DesktopNavigationKey;
  children: ReactNode;
  onOpenSearch?: () => void;
  onOpenQuickCreate?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  return (
    <div
      className="desktop-shell"
      data-mobile-nav-open={String(mobileOpen)}
      data-nav-collapsed={String(collapsed)}
    >
      <a className="skip-link" href="#desktop-content">跳到主要内容</a>
      <Sidebar
        activeKey={props.activeKey}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onNavigate={() => setMobileOpen(false)}
        onToggleCollapsed={() => setCollapsed((current) => !current)}
      />
      {mobileOpen ? (
        <button
          aria-label="关闭导航遮罩"
          className="mobile-nav-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}
      <TopBar
        onOpenMobileNav={() => setMobileOpen(true)}
        onOpenQuickCreate={() => {
          props.onOpenQuickCreate?.();
          setQuickCreateOpen(true);
        }}
        onOpenSearch={() => {
          props.onOpenSearch?.();
          setSearchOpen(true);
        }}
      />
      <main className="desktop-feature-canvas" id="desktop-content">
        {props.children}
      </main>
      {searchOpen ? <GlobalSearch onClose={() => setSearchOpen(false)} /> : null}
      {quickCreateOpen ? <QuickCreate onClose={() => setQuickCreateOpen(false)} /> : null}
    </div>
  );
}
