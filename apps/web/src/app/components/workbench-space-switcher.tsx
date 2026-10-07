"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Building2,
  Check,
  ChevronDown,
  Layers3,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { WorkbenchCompanyFilter } from "../../lib/workbench/workbench-companies";
import {
  buildWorkbenchSpaceHref,
  getWorkbenchMenuSelectedSpaceKey,
  getWorkbenchSpaceFiltersForMenu,
} from "../../lib/workbench/workbench-space-filters";
import {
  switchWorkbenchSpaceAction,
  type WorkbenchSpaceActionState,
} from "../workbench/actions";

export type WorkbenchUserSpaceFilter = WorkbenchCompanyFilter;

type WorkbenchSpaceAction = (
  formData: FormData,
) => Promise<WorkbenchSpaceActionState>;

function getSpaceAccessibleName(filter: WorkbenchUserSpaceFilter) {
  if (filter.ownerType === null) {
    return "全部工作空间";
  }

  if (filter.ownerType === "personal") {
    return filter.label;
  }

  return filter.role
    ? `${filter.label}，公司空间，当前角色 ${filter.role}`
    : `${filter.label}，公司空间`;
}

function getSpaceMeta(filter: WorkbenchUserSpaceFilter) {
  if (filter.ownerType === null) {
    return "汇总范围";
  }

  if (filter.ownerType === "personal") {
    return "个人";
  }

  return filter.role ? `公司 · ${filter.role}` : "公司";
}

function SpaceIcon({ ownerType }: Pick<WorkbenchUserSpaceFilter, "ownerType">) {
  if (ownerType === "personal") {
    return <UserRound size={16} aria-hidden="true" />;
  }

  if (ownerType === "company") {
    return <Building2 size={16} aria-hidden="true" />;
  }

  return <Layers3 size={16} aria-hidden="true" />;
}

export function WorkbenchSpaceSwitcher({
  selectedSpaceKey,
  spaceFilters = [],
  spaceSwitchPath,
  action = switchWorkbenchSpaceAction,
}: {
  selectedSpaceKey?: string;
  spaceFilters?: WorkbenchUserSpaceFilter[];
  spaceSwitchPath?: string;
  action?: WorkbenchSpaceAction;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const spaceOptions = spaceFilters.length > 0
    ? getWorkbenchSpaceFiltersForMenu({ userCompanyFilters: spaceFilters })
    : [];
  const activeSpaceKey = getWorkbenchMenuSelectedSpaceKey({
    filters: spaceOptions,
    selectedKey: selectedSpaceKey,
  });
  const activeSpace = spaceOptions.find((filter) => filter.key === activeSpaceKey);

  function selectSpace(nextKey: string) {
    if (pending) {
      return;
    }

    if (nextKey === activeSpaceKey) {
      setOpen(false);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("spaceKey", nextKey);
        const result = await action(formData);

        if (!result.ok) {
          setError(result.error ?? "工作空间切换失败，请重试");
          return;
        }

        setOpen(false);
        const targetFilter = spaceOptions.find((filter) => filter.key === nextKey);
        if (spaceSwitchPath && targetFilter) {
          router.push(buildWorkbenchSpaceHref(spaceSwitchPath, targetFilter));
        } else {
          router.refresh();
        }
      } catch {
        setError("工作空间切换失败，请重试");
      }
    });
  }

  if (!activeSpace) {
    return (
      <button
        type="button"
        disabled
        aria-label="暂无可用工作空间"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#d0d7de] bg-[#f6f8fa] text-[#8c959f]"
      >
        <Layers3 size={16} aria-hidden="true" />
      </button>
    );
  }

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) {
          setOpen(nextOpen);
          if (nextOpen) setError(null);
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`切换工作空间，当前为 ${activeSpace.label}`}
          className="inline-flex h-9 max-w-[220px] shrink-0 items-center gap-2 rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-2.5 text-xs font-semibold text-[#24292f] outline-none transition-colors hover:bg-[#eef1f4] focus-visible:ring-2 focus-visible:ring-[#0969da] focus-visible:ring-offset-1 data-[state=open]:border-[#8c959f] sm:max-w-[240px]"
        >
          <SpaceIcon ownerType={activeSpace.ownerType} />
          <span className="hidden min-w-0 truncate sm:block">{activeSpace.label}</span>
          <ChevronDown className="hidden shrink-0 sm:block" size={14} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-[90] w-[min(320px,calc(100vw-16px))] translate-y-1 rounded-lg border border-[#d0d7de] bg-white p-1.5 text-sm text-[#24292f] opacity-0 shadow-[0_12px_32px_rgba(31,35,40,0.16)] outline-none transition duration-150 data-[state=open]:translate-y-0 data-[state=open]:opacity-100 motion-reduce:transition-none"
        >
          <DropdownMenu.Label className="px-2.5 py-2">
            <span className="block text-xs font-semibold text-[#24292f]">切换工作空间</span>
            <span className="mt-0.5 block text-xs font-normal text-[#57606a]">选择任务、项目和文档的数据范围</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-[#d8dee4]" />

          <DropdownMenu.RadioGroup value={activeSpaceKey}>
            <div
              data-testid="workbench-space-options"
              className="max-h-72 overflow-y-auto overscroll-contain"
            >
              {spaceOptions.map((filter) => (
                <DropdownMenu.RadioItem
                  key={filter.key}
                  value={filter.key}
                  disabled={pending}
                  aria-label={getSpaceAccessibleName(filter)}
                  onSelect={(event) => {
                    event.preventDefault();
                    selectSpace(filter.key);
                  }}
                  className="grid min-h-10 cursor-default select-none grid-cols-[20px_minmax(0,1fr)_16px] items-center gap-2 rounded-md px-2.5 py-1.5 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-[#f6f8fa]"
                >
                  <span className="text-[#57606a]">
                    <SpaceIcon ownerType={filter.ownerType} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-[#24292f]">{filter.label}</span>
                    <span className="block truncate text-[11px] text-[#57606a]">{getSpaceMeta(filter)}</span>
                  </span>
                  <DropdownMenu.ItemIndicator>
                    <Check size={15} className="text-[#0969da]" aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </div>
          </DropdownMenu.RadioGroup>

          {pending ? (
            <div role="status" className="border-t border-[#d8dee4] px-2.5 py-2 text-xs font-medium text-[#57606a]">
              正在切换工作空间...
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="border-t border-[#d8dee4] px-2.5 py-2 text-xs font-medium text-[#cf222e]">
              {error}
            </div>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
