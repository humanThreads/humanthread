"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  BellIcon,
  PlusIcon,
  SearchIcon,
  WorkbenchNavIcon,
} from "./workbench-icons";
import {
  WORKBENCH_NAV_ITEMS,
  WORKBENCH_NAV_GROUPS,
  type WorkbenchNavKey,
} from "./workbench-nav";
import { WorkbenchNotificationLink } from "./workbench-notification-link";
import { PageHeader } from "./workbench-ui";
import {
  type WorkbenchUserSpaceFilter,
  WorkbenchSpaceSwitcher,
} from "./workbench-space-switcher";
import { WorkbenchUserMenu } from "./workbench-user-menu";
import type { WorkbenchProjectOverview } from "../../lib/workbench/workbench-projects";
import {
  TaskCreateDialog,
  type TaskCreateSpaceOption,
} from "./tasks/task-create-dialog";
import { WEB_BUILD_VERSION } from "../../lib/build-version";

function WorkbenchMobileNavigation({
  activeKey,
}: {
  activeKey: WorkbenchNavKey;
}) {
  const activeItem = WORKBENCH_NAV_ITEMS.find((item) => item.key === activeKey);
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[#d0d7de] bg-white px-4 py-2 md:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-3 rounded-md border border-[#d0d7de] bg-white px-3 text-left text-sm font-semibold text-[#24292f] transition hover:bg-[#f6f8fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0969da]/35"
            aria-label={`打开工作台导航，当前栏目为${activeItem?.label ?? "当前页面"}`}
          >
            <Menu size={17} aria-hidden="true" />
            <span className={activeItem ? undefined : "text-[#57606a]"}>{activeItem?.label ?? "工作台导航"}</span>
            <span className="ml-auto text-xs font-normal text-[#6e7781]">导航</span>
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/40 md:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(88vw,340px)] overflow-y-auto border-r border-[#d0d7de] bg-white p-4 shadow-xl outline-none md:hidden">
            <div className="mb-5 flex items-start justify-between gap-3 border-b border-[#d8dee4] pb-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-[#24292f]">工作台导航</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-[#57606a]">切换任务、Agent、项目与设置</Dialog.Description>
              </div>
              <Dialog.Close
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-[#57606a] transition hover:bg-[#f6f8fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0969da]/35"
                aria-label="关闭工作台导航"
              >
                <X size={17} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <nav className="grid gap-5" aria-label="移动端工作台导航">
              {WORKBENCH_NAV_GROUPS.map((group) => (
                <div key={`mobile-group:${group.key}`} className="grid gap-1">
                  <div className="px-3 pb-1 text-xs font-semibold text-[#8c959f]">{group.label}</div>
                  {group.items.map((key) => {
                    const item = WORKBENCH_NAV_ITEMS.find((candidate) => candidate.key === key);
                    if (!item) return null;
                    const isActive = item.key === activeKey;

                    return (
                      <Link
                        key={`mobile:${item.key}`}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={isActive
                          ? "flex min-h-11 items-center gap-3 rounded-md bg-[#f6f8fa] px-3 text-sm font-semibold text-[#24292f] ring-1 ring-inset ring-[#d0d7de]"
                          : "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-[#57606a] transition hover:bg-[#f6f8fa] hover:text-[#24292f]"}
                      >
                        <WorkbenchNavIcon name={item.icon} active={isActive} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="mt-5 flex items-center gap-2 border-t border-[#d8dee4] px-3 pt-4 text-xs text-[#6e7781]">
              <BellIcon active={false} />
              <span>{WEB_BUILD_VERSION}</span>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function WorkbenchHeaderSearchLink() {
  return (
    <Link
      href="/search"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-full border border-[#d0d7de] bg-white text-sm text-[#57606a] transition hover:bg-[#f6f8fa] hover:text-[#24292f] sm:w-auto sm:px-3"
      aria-label="搜索任务、项目、文档、成员"
    >
      <SearchIcon />
      <span className="hidden font-medium sm:inline">搜索</span>
      <span className="hidden lg:inline text-xs text-[#8c959f]">任务 / 项目 / 文档 / 成员</span>
    </Link>
  );
}

function WorkbenchQuickCreateButton({
  spaces = [],
  initialSpaceId,
  projects = [],
  selectedProjectId,
}: {
  spaces?: TaskCreateSpaceOption[];
  initialSpaceId?: string;
  projects?: WorkbenchProjectOverview[];
  selectedProjectId?: string;
}) {
  const [open, setOpen] = useState(false);
  const taskProjects = projects.flatMap((project) => project.spaceId ? [{
    id: project.id,
    name: project.name,
    spaceId: project.spaceId,
    milestones: project.milestones,
  }] : []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative grid h-7 w-7 place-items-center rounded-full transition hover:bg-[#f6f8fa]"
        aria-label="快速创建事项"
      >
        <PlusIcon />
      </button>

      <TaskCreateDialog
        open={open}
        spaces={spaces}
        projects={taskProjects}
        {...(initialSpaceId ? { initialSpaceId } : {})}
        {...(selectedProjectId ? { initialProjectId: selectedProjectId } : {})}
        onOpenChange={setOpen}
        onCreated={({ taskId }) => {
          window.location.assign(`/tasks/${encodeURIComponent(taskId)}`);
        }}
      />
    </>
  );
}

interface WorkbenchAppShellProps {
  activeKey: WorkbenchNavKey;
  title: string;
  subtitle: string;
  contentMode?: "page" | "workspace";
  children?: ReactNode;
  aside?: ReactNode;
  actions?: ReactNode;
  loginName?: string | null;
  loginEmail?: string | null;
  loginAvatarSrc?: string | null;
  spaceLabel?: string | null;
  selectedSpaceKey?: string;
  spaceFilters?: WorkbenchUserSpaceFilter[];
  spaceSwitchPath?: string;
  notificationUnreadCount?: number;
  quickCreateSpaces?: TaskCreateSpaceOption[];
  quickCreateInitialSpaceId?: string;
  quickCreateProjects?: WorkbenchProjectOverview[];
  quickCreateSelectedProjectId?: string;
}

export function WorkbenchAppShell({
  activeKey,
  title,
  subtitle,
  contentMode = "page",
  children,
  aside,
  actions,
  loginName,
  loginEmail,
  loginAvatarSrc,
  selectedSpaceKey,
  spaceFilters = [],
  spaceSwitchPath,
  notificationUnreadCount = 0,
  quickCreateSpaces = [],
  quickCreateInitialSpaceId,
  quickCreateProjects = [],
  quickCreateSelectedProjectId,
}: WorkbenchAppShellProps) {
  const taskCreateSpaces = quickCreateSpaces.length > 0
    ? quickCreateSpaces
    : spaceFilters.flatMap((filter) => filter.spaceId && filter.ownerType ? [{
        id: filter.spaceId,
        name: filter.label,
        type: filter.ownerType,
      }] : []);
  const taskCreateInitialSpaceId = quickCreateInitialSpaceId
    ?? spaceFilters.find((filter) => filter.key === selectedSpaceKey)?.spaceId
    ?? undefined;

  return (
    <main className="h-screen overflow-hidden bg-[#ffffff] text-[#24292f]">
      <div className="grid h-screen grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-[linear-gradient(180deg,rgba(246,248,250,0.82),rgba(246,248,250,0)_18%)]">
        <header className="sticky top-0 z-40 border-b border-[#d0d7de] bg-white/95 backdrop-blur">
          <div className="flex h-16 w-full items-center gap-3 px-4 sm:px-5">
            <Link href="/" className="group inline-flex items-center gap-3 text-sm font-semibold text-[#24292f]">
              <Image
                src="/brand/humanthread-mark.svg"
                alt="HumanThread"
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5"
                priority
              />
              <span className="flex flex-col leading-none">
                <span className="bg-[linear-gradient(180deg,#1f2328,#4b5563)] bg-clip-text text-[1.35rem] font-semibold tracking-[-0.055em] text-transparent">
                  HumanThread
                </span>
                <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.28em] text-[#6e7781]">
                  Workbench
                </span>
              </span>
            </Link>
            <WorkbenchSpaceSwitcher
              {...(selectedSpaceKey ? { selectedSpaceKey } : {})}
              spaceFilters={spaceFilters}
              {...(spaceSwitchPath ? { spaceSwitchPath } : {})}
            />

            <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
              <WorkbenchHeaderSearchLink />
              <WorkbenchQuickCreateButton
                spaces={taskCreateSpaces}
                {...(taskCreateInitialSpaceId ? { initialSpaceId: taskCreateInitialSpaceId } : {})}
                projects={quickCreateProjects}
                {...(quickCreateSelectedProjectId
                  ? { selectedProjectId: quickCreateSelectedProjectId }
                  : {})}
              />
              <WorkbenchNotificationLink initialUnreadCount={notificationUnreadCount} />
              <WorkbenchUserMenu
                name={loginName ?? null}
                email={loginEmail ?? null}
                avatarSrc={loginAvatarSrc ?? null}
              />
            </div>
          </div>
        </header>

        <div className="grid min-h-0 md:grid-cols-[auto_minmax(0,1fr)]">
          <aside className="hidden md:block border-r border-[#d0d7de] bg-white">
            <div className="flex h-full w-[80px] flex-col">
              <div className="flex-1 px-2 py-3">
                <nav className="grid gap-3" aria-label="工作台导航">
                  {WORKBENCH_NAV_GROUPS.map((group) => <div key={group.key} className="grid gap-1">
                    <span className="px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8c959f]">{group.label}</span>
                    {group.items.map((key) => {
                      const item = WORKBENCH_NAV_ITEMS.find((candidate) => candidate.key === key);
                      if (!item) return null;
                    const isActive = item.key === activeKey;

                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        className={
                          isActive
                            ? "grid justify-items-center gap-1 rounded-lg border border-[#d0d7de] bg-[#f6f8fa] px-2 py-2 text-[10px] font-semibold text-[#24292f]"
                            : "grid justify-items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold text-[#57606a] hover:bg-[#f6f8fa] hover:text-[#24292f]"
                        }
                      >
                        <WorkbenchNavIcon name={item.icon} active={isActive} />
                        <span className="leading-none">{item.compactLabel}</span>
                      </Link>
                    );
                    })}
                  </div>)}
                </nav>
                {aside ? <div className="mt-4">{aside}</div> : null}
              </div>
              <p className="px-1 pb-3 text-center text-[11px] leading-4 text-[#6e7781]" title={WEB_BUILD_VERSION}>{WEB_BUILD_VERSION}</p>
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden">
            <div
              className={contentMode === "workspace"
                ? "grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
                : "grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]"}
            >
              <WorkbenchMobileNavigation activeKey={activeKey} />
              {contentMode === "page" ? (
                <PageHeader title={title} subtitle={subtitle} actions={actions} />
              ) : null}
              <div
                data-workbench-content-mode={contentMode}
                className={contentMode === "workspace"
                  ? "min-h-0 overflow-hidden md:row-start-1"
                  : "min-h-0 min-w-0 overflow-y-auto px-4 pb-6 sm:px-6 lg:px-8"}
              >
                {children}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export const WorkbenchShell = WorkbenchAppShell;
