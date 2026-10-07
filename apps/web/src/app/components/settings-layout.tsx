"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Building2,
  ChevronRight,
  KeyRound,
  Menu,
  MonitorSmartphone,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { WorkbenchSettingsContext } from "../../lib/workbench/workbench-settings-context";

export type SettingsNavKey =
  | "overview"
  | "account"
  | "security"
  | "devices"
  | "mcp"
  | "workers"
  | "companies"
  | "admin";

interface SettingsNavItem {
  href: string;
  label: string;
  key: SettingsNavKey;
  icon: LucideIcon;
}

export interface SettingsNavGroup {
  label: "个人" | "公司" | "平台";
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { href: "/settings/account", label: "个人资料", key: "account", icon: UserRound },
  { href: "/settings/security", label: "安全", key: "security", icon: ShieldCheck },
  { href: "/settings/devices", label: "Agent 设备", key: "devices", icon: MonitorSmartphone },
  { href: "/settings/mcp", label: "MCP 凭据", key: "mcp", icon: KeyRound },
  { href: "/settings/workers", label: "Linux Worker", key: "workers", icon: ServerCog },
] as const;

export const SETTINGS_COMPANY_NAV_ITEM: SettingsNavItem = {
  href: "/settings/companies",
  label: "公司管理",
  key: "companies",
  icon: Building2,
};

export const SETTINGS_ADMIN_NAV_ITEM: SettingsNavItem = {
  href: "/settings/admin",
  label: "平台设置",
  key: "admin",
  icon: ServerCog,
};

export function getSettingsNavigation(
  context: Pick<WorkbenchSettingsContext, "isSiteAdmin">,
): SettingsNavGroup[] {
  return [
    { label: "个人", items: [...SETTINGS_NAV_ITEMS] },
    { label: "公司", items: [SETTINGS_COMPANY_NAV_ITEM] },
    ...(context.isSiteAdmin
      ? [{ label: "平台" as const, items: [SETTINGS_ADMIN_NAV_ITEM] }]
      : []),
  ];
}

function SettingsNavigation({
  activeKey,
  groups,
  onNavigate,
}: {
  activeKey: SettingsNavKey;
  groups: SettingsNavGroup[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="设置导航" className="grid gap-5">
      <Link
        href="/settings"
        {...(onNavigate ? { onClick: onNavigate } : {})}
        aria-current={activeKey === "overview" ? "page" : undefined}
        className={activeKey === "overview"
          ? "flex min-h-9 items-center gap-2 rounded-md bg-[#f6f8fa] px-3 text-sm font-semibold text-[#24292f] ring-1 ring-inset ring-[#d0d7de]"
          : "flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#24292f]"}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>设置总览</span>
      </Link>
      {groups.map((group) => (
        <div key={group.label} className="grid gap-1">
          <div className="px-3 pb-1 text-xs font-semibold text-[#8c959f]">
            {group.label}
          </div>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = item.key === activeKey;

            return (
              <Link
                key={item.key}
                href={item.href}
                {...(onNavigate ? { onClick: onNavigate } : {})}
                aria-current={active ? "page" : undefined}
                className={active
                  ? "flex min-h-9 items-center gap-2 rounded-md bg-[#f6f8fa] px-3 text-sm font-semibold text-[#24292f] ring-1 ring-inset ring-[#d0d7de]"
                  : "flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#24292f]"}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{item.label}</span>
                {active ? <ChevronRight className="ml-auto" size={14} aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function SettingsLayout({
  activeKey,
  children,
  context,
  showAdmin = false,
}: {
  activeKey: SettingsNavKey;
  children?: ReactNode;
  context?: WorkbenchSettingsContext;
  showAdmin?: boolean;
}) {
  const groups = getSettingsNavigation({
    isSiteAdmin: context?.isSiteAdmin ?? showAdmin,
  });

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="hidden border-r border-[#d8dee4] pr-4 lg:block">
        <div className="sticky top-0 py-1">
          <SettingsNavigation activeKey={activeKey} groups={groups} />
        </div>
      </aside>

      <div className="lg:hidden">
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="flex min-h-10 w-full items-center gap-2 rounded-md border border-[#d0d7de] bg-white px-3 text-left text-sm font-semibold text-[#24292f]"
            >
              <Menu size={17} aria-hidden="true" />
              <span>当前设置范围</span>
              <ChevronRight className="ml-auto" size={16} aria-hidden="true" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/40 motion-reduce:transition-none" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(88vw,320px)] overflow-y-auto border-r border-[#d0d7de] bg-white p-4 shadow-xl outline-none motion-safe:transition-transform motion-safe:duration-200">
              <div className="mb-5 flex items-start justify-between gap-3 border-b border-[#d8dee4] pb-4">
                <div>
                  <Dialog.Title className="text-base font-semibold text-[#24292f]">设置导航</Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm text-[#57606a]">切换个人、公司或平台设置</Dialog.Description>
                </div>
                <Dialog.Close className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa]" aria-label="关闭设置导航">
                  <X size={17} aria-hidden="true" />
                </Dialog.Close>
              </div>
              <Dialog.Close asChild>
                <div>
                  <SettingsNavigation activeKey={activeKey} groups={groups} />
                </div>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
