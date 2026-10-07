"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis } from "lucide-react";
import type { ReactNode } from "react";
import type { DocumentTreeCommand } from "./document-tree-interactions";

export interface DocumentTreeMenuCommand {
  command: DocumentTreeCommand;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}

interface DocumentTreeItemMenuProps {
  item: { id: string; label: string };
  commands: DocumentTreeMenuCommand[];
  onCommand(command: DocumentTreeCommand): void;
  disabled?: boolean;
}

export function DocumentTreeItemMenu({
  item,
  commands,
  onCommand,
  disabled = false,
}: DocumentTreeItemMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`${item.label}的更多操作`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded text-[#57606a] transition hover:bg-[#eaeef2] hover:text-[#24292f] md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100"
        >
          <Ellipsis size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[70] min-w-44 rounded-md border border-[#d0d7de] bg-white p-1 text-sm text-[#24292f] shadow-[0_12px_32px_rgba(31,35,40,0.18)]"
        >
          {commands.map((itemCommand) => (
            <DropdownMenu.Item
              key={`${itemCommand.command.type}:${itemCommand.label}`}
              {...(itemCommand.disabled !== undefined ? { disabled: itemCommand.disabled } : {})}
              onSelect={() => onCommand(itemCommand.command)}
              className={itemCommand.destructive
                ? "flex h-8 cursor-default select-none items-center gap-2 rounded px-2.5 text-[#cf222e] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-[#ffebe9]"
                : "flex h-8 cursor-default select-none items-center gap-2 rounded px-2.5 outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-[#f6f8fa]"}
            >
              {itemCommand.icon}
              <span>{itemCommand.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
