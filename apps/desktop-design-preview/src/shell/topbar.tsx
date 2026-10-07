import { Bell, LogOut, Menu, Plus, Search } from "lucide-react";
import { useState } from "react";

import { usePreviewSession } from "../session/preview-session";
import { StatusPill } from "../ui/primitives";

function initials(name: string): string {
  const value = name.trim();
  return value ? value.slice(0, 2).toUpperCase() : "HT";
}

export function TopBar(props: {
  onOpenMobileNav(): void;
  onOpenSearch(): void;
  onOpenQuickCreate(): void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const session = usePreviewSession();
  const spaces = session.bootstrap?.spaces ?? [{ key: "personal", kind: "personal", name: "个人空间" }];
  const activeSpaceName = spaces.find((space) => space.key === session.activeSpaceKey)?.name ?? "个人空间";
  const userName = session.user?.name ?? "HumanThread";

  return (
    <header className="desktop-topbar">
      <div className="toolbar-group">
        <button
          aria-label="打开主导航"
          className="icon-button mobile-nav-trigger"
          onClick={props.onOpenMobileNav}
          type="button"
        >
          <Menu aria-hidden="true" size={18} />
        </button>
        <label className="space-switcher">
          <span aria-hidden="true" className="space-switcher-mark">
            {activeSpaceName.slice(0, 1).toUpperCase()}
          </span>
          <select
            aria-label="当前空间"
            disabled={session.status !== "ready"}
            onChange={(event) => void session.switchSpace(event.target.value)}
            value={session.activeSpaceKey}
          >
            {spaces.map((space) => (
              <option key={space.key} value={space.key}>{space.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="topbar-actions">
        <StatusPill tone="warning">只读预览</StatusPill>
        <button aria-label="全局搜索" className="icon-button" onClick={props.onOpenSearch} type="button">
          <Search aria-hidden="true" size={17} />
        </button>
        <button aria-label="快速新建" className="icon-button" onClick={props.onOpenQuickCreate} type="button">
          <Plus aria-hidden="true" size={18} />
        </button>
        <span className="connection-state">{session.status === "ready" ? "已连接官网" : "等待连接"}</span>
        <button aria-label="通知中心" className="icon-button" type="button">
          <Bell aria-hidden="true" size={17} />
        </button>
        <div className="desktop-account">
          <button
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            aria-label={`账号菜单：${userName}`}
            className="account-button"
            onClick={() => setAccountOpen((current) => !current)}
            type="button"
          >
            {initials(userName)}
          </button>
          {accountOpen ? (
            <div className="account-menu" role="menu">
              <div className="account-menu-identity">
                <strong>{userName}</strong>
                <span>{session.user?.email ?? "尚未登录"}</span>
              </div>
              <button onClick={() => void session.logout()} role="menuitem" type="button">
                <LogOut aria-hidden="true" size={15} />
                退出预览账号
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
