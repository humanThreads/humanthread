import {
  desktopSearchResponseSchema,
  workbenchQueryKey,
  type DesktopSearchResponse,
} from "@humanthread/workbench-client";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { GlobalSearch } from "../../features/search/global-search";
import { NotificationBell } from "../../features/notifications/notification-bell";
import { QuickCreateDialog } from "../../features/quick-create/quick-create-dialog";
import { useOptionalDesktopSession } from "../../session/session-provider";

const createResponseSchema = z.object({ ok: z.literal(true), data: z.unknown() });

function initials(name: string): string {
  const value = name.trim();
  if (!value) return "HT";
  return value.slice(0, 2).toUpperCase();
}

export function TopBar(props: { onOpenMobileNav?: () => void } = {}) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const queryClient = useQueryClient();
  const session = useOptionalDesktopSession();
  const spaces = session?.bootstrap?.spaces ?? [];
  const globalActionsEnabled = session?.status === "ready" && session.actionsEnabled;
  const activeSpaceKey = session?.context?.spaceKey ?? "personal";
  const activeSpaceName = spaces.find((space) => space.key === activeSpaceKey)?.name
    ?? "个人空间";
  const userName = session?.user?.name ?? "HumanThread";
  const contextKey = session?.context
    ? `${session.context.deploymentKey}:${session.context.sessionId}:${session.context.spaceKey}`
    : "desktop:inactive";
  const search = useCallback(async (query: string): Promise<DesktopSearchResponse["data"]> => {
    if (!session?.client || !session.context) throw new Error("桌面会话不可用");
    const params = new URLSearchParams({ q: query, space: session.context.spaceKey });
    const response = await session.client.request(
      `/api/desktop/search?${params.toString()}`,
      desktopSearchResponseSchema,
    );
    return response.data;
  }, [session?.client, session?.context]);
  const create = useCallback(async (
    kind: "task" | "project" | "document",
    payload: Record<string, string>,
  ) => {
    if (!globalActionsEnabled || !session?.client || !session.context) {
      throw new Error("桌面会话当前不可写");
    }
    await session.client.request("/api/desktop/create", createResponseSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, spaceKey: session.context.spaceKey, ...payload }),
    });
    await queryClient.invalidateQueries({
      queryKey: workbenchQueryKey(session.context, "dashboard"),
    });
  }, [globalActionsEnabled, queryClient, session?.client, session?.context]);

  useEffect(() => {
    if (globalActionsEnabled) return;
    setSearchOpen(false);
    setQuickCreateOpen(false);
  }, [globalActionsEnabled]);

  return (
    <header className="desktop-top-bar">
      <div className="top-bar-context">
        <button
          aria-label="打开主导航"
          className="icon-button desktop-mobile-nav-trigger"
          onClick={props.onOpenMobileNav}
          type="button"
        >
          <Menu aria-hidden="true" size={18} />
        </button>
        <label className="space-switcher">
          <span className="space-switcher-mark" aria-hidden="true">
            {activeSpaceName.slice(0, 1).toUpperCase()}
          </span>
          <select
            aria-label="当前空间"
            disabled={!session?.actionsEnabled}
            onChange={(event) => void session?.switchSpace(event.target.value)}
            value={activeSpaceKey}
          >
            {spaces.length > 0 ? spaces.map((space) => (
              <option key={space.key} value={space.key}>{space.name}</option>
            )) : <option value="personal">个人空间</option>}
          </select>
        </label>
      </div>
      <div className="top-bar-actions">
        <span className="desktop-execution-state" data-enabled={String(Boolean(globalActionsEnabled))}>
          {globalActionsEnabled ? "执行已开启" : "只读会话"}
        </span>
        <button className="icon-button" aria-label="全局搜索" disabled={!globalActionsEnabled} onClick={() => setSearchOpen(true)} type="button">
          <Search aria-hidden="true" size={18} />
        </button>
        <button className="icon-button" aria-label="快速新建" disabled={!globalActionsEnabled} onClick={() => setQuickCreateOpen(true)} type="button">
          <Plus aria-hidden="true" size={19} />
        </button>
        <span className="connection-state"><span aria-hidden="true" />已连接</span>
        <NotificationBell />
        <div className="account-menu-anchor">
          <button
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            aria-label={`账号菜单：${userName}`}
            className="account-button"
            onClick={() => setAccountMenuOpen((current) => !current)}
            type="button"
          >
            {initials(userName)}
          </button>
          {accountMenuOpen ? (
            <div className="account-menu" role="menu">
              <div className="account-menu-identity">
                <strong>{userName}</strong>
                <span>{session?.user?.email}</span>
              </div>
              <button
                onClick={() => void session?.logout()}
                role="menuitem"
                type="button"
              >
                <LogOut aria-hidden="true" size={16} />
                退出桌面账号
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {searchOpen ? (
        <GlobalSearch contextKey={contextKey} onClose={() => setSearchOpen(false)} search={search} />
      ) : null}
      {quickCreateOpen ? (
        <QuickCreateDialog
          createDocument={({ title }) => create("document", { title })}
          createProject={({ name, objective }) => create("project", { name, objective })}
          createTask={({ commandId, title }) => create("task", { commandId, title })}
          onClose={() => setQuickCreateOpen(false)}
        />
      ) : null}
    </header>
  );
}
