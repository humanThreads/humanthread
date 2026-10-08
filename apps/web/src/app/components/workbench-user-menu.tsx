"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Download, LifeBuoy, LogOut, Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { logoutWorkbenchAction } from "../workbench/actions";

function formatWorkbenchUserName(
  name: string | null | undefined,
  email: string | null,
): string {
  const normalizedName = name?.trim();

  if (normalizedName) {
    return normalizedName;
  }

  if (!email) {
    return "当前账号";
  }

  const localPart = email.split("@")[0] ?? "";
  const segments = localPart.split(/[._-]+/u).filter(Boolean);

  if (segments.length === 0) {
    return email;
  }

  return segments
    .map((segment) =>
      segment.length > 1
        ? `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`
        : segment.toUpperCase(),
    )
    .join(" ");
}

function getUserInitials(
  name: string | null | undefined,
  email: string | null,
): string {
  const normalizedName = name?.trim();

  if (normalizedName) {
    const firstCharacter = normalizedName.charAt(0);
    return firstCharacter ? firstCharacter.toUpperCase() : "U";
  }

  if (!email) {
    return "U";
  }

  const localPart = email.split("@")[0] ?? "";
  const first = localPart.trim().charAt(0);

  return first ? first.toUpperCase() : "U";
}

function WorkbenchAvatar({
  name,
  email,
  avatarSrc,
  sizeClassName,
  textClassName,
}: {
  name: string | null | undefined;
  email: string | null;
  avatarSrc?: string | null;
  sizeClassName: string;
  textClassName: string;
}) {
  const initials = getUserInitials(name, email);
  const alt = formatWorkbenchUserName(name, email);

  if (avatarSrc) {
    return (
      <Image
        src={avatarSrc}
        alt={alt}
        width={36}
        height={36}
        unoptimized
        className={`${sizeClassName} rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      className={`grid ${sizeClassName} place-items-center rounded-full bg-[#0969da] font-semibold text-white ${textClassName}`}
    >
      {initials}
    </span>
  );
}

const ACCOUNT_MENU_ITEM_CLASS_NAME =
  "flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-[#24292f] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-[#f6f8fa]";

const WORKBENCH_USER_MENU_POPOVER_CLASS_NAME =
  "z-[90] w-[min(288px,calc(100vw-16px))] translate-y-1 rounded-lg border border-[#d0d7de] bg-white p-1.5 text-[#24292f] opacity-0 shadow-[0_12px_32px_rgba(31,35,40,0.16)] outline-none transition duration-150 data-[state=open]:translate-y-0 data-[state=open]:opacity-100 motion-reduce:transition-none";

function LogoutMenuItem({
  pending,
  onLogout,
}: {
  pending: boolean;
  onLogout: () => void;
}) {
  return (
    <DropdownMenu.Item
      asChild
      disabled={pending}
      onSelect={(event) => {
        event.preventDefault();
        onLogout();
      }}
    >
      <button
        type="button"
        disabled={pending}
        className={`${ACCOUNT_MENU_ITEM_CLASS_NAME} w-full text-[#cf222e] data-[highlighted]:bg-[#ffebe9]`}
      >
        <LogOut size={16} aria-hidden="true" />
        <span>{pending ? "正在退出..." : "退出登录"}</span>
      </button>
    </DropdownMenu.Item>
  );
}

export function WorkbenchUserMenu({
  email,
  name = null,
  avatarSrc = null,
}: {
  email: string | null;
  name?: string | null;
  avatarSrc?: string | null;
}) {
  const displayName = formatWorkbenchUserName(name, email);
  const [open, setOpen] = useState(false);
  const [pending, startLogoutTransition] = useTransition();

  function logout() {
    if (pending) {
      return;
    }

    startLogoutTransition(async () => {
      await logoutWorkbenchAction();
    });
  }

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) {
          setOpen(nextOpen);
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="打开账号菜单"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-transparent outline-none transition-colors hover:bg-[#f6f8fa] focus-visible:ring-2 focus-visible:ring-[#0969da] focus-visible:ring-offset-1 data-[state=open]:bg-[#f6f8fa]"
        >
          <WorkbenchAvatar
            name={name}
            email={email}
            avatarSrc={avatarSrc}
            sizeClassName="h-6 w-6 shrink-0"
            textClassName="text-[9px]"
          />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className={WORKBENCH_USER_MENU_POPOVER_CLASS_NAME}
        >
          <DropdownMenu.Label className="flex min-w-0 items-center gap-3 px-2.5 py-2.5">
            <WorkbenchAvatar
              name={name}
              email={email}
              avatarSrc={avatarSrc}
              sizeClassName="h-9 w-9 shrink-0"
              textClassName="text-[11px]"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[#24292f]">{displayName}</span>
              <span className="mt-0.5 block truncate text-xs font-normal text-[#57606a]">{email ?? "未登录"}</span>
            </span>
          </DropdownMenu.Label>

          <DropdownMenu.Separator className="my-1 h-px bg-[#d8dee4]" />
          <DropdownMenu.Item asChild>
            <Link href="/settings" className={ACCOUNT_MENU_ITEM_CLASS_NAME}>
              <Settings size={16} aria-hidden="true" />
              <span>设置中心</span>
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/downloads" className={ACCOUNT_MENU_ITEM_CLASS_NAME}>
              <Download size={16} aria-hidden="true" />
              <span>下载本地 Agent</span>
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/help" className={ACCOUNT_MENU_ITEM_CLASS_NAME}>
              <LifeBuoy size={16} aria-hidden="true" />
              <span>帮助中心</span>
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-[#d8dee4]" />
          <LogoutMenuItem pending={pending} onLogout={logout} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
