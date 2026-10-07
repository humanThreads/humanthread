"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { WorkbenchButton } from "./workbench-ui";

export function SettingsDialog({
  triggerLabel,
  title,
  description,
  children,
  open,
  onOpenChange,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <Dialog.Trigger asChild>
        <WorkbenchButton type="button">{triggerLabel}</WorkbenchButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45 motion-reduce:transition-none" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 max-h-[calc(100vh-32px)] -translate-y-1/2 overflow-hidden rounded-lg border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)] outline-none sm:left-1/2 sm:w-[min(92vw,560px)] sm:-translate-x-1/2 motion-safe:duration-200">
          <div className="flex items-start gap-3 border-b border-[#d8dee4] px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-[#24292f]">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-5 text-[#57606a]">{description}</Dialog.Description>
            </div>
            <Dialog.Close className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa]" aria-label={`关闭${title}`}>
              <X size={17} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="max-h-[calc(100vh-150px)] overflow-y-auto px-5 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DangerConfirmDialog({
  triggerLabel,
  triggerIcon,
  triggerSize = "normal",
  title,
  description,
  actionLabel,
  confirmationText,
  onConfirm,
}: {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  triggerSize?: "normal" | "small";
  title: string;
  description: string;
  actionLabel: string;
  confirmationText?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = !confirmationText || confirmation === confirmationText;

  async function confirm() {
    if (!confirmed || pending) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
      setConfirmation("");
    } catch {
      setError("操作失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <Dialog.Trigger asChild>
        <WorkbenchButton type="button" variant="danger" size={triggerSize}>{triggerIcon}{triggerLabel}</WorkbenchButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45 motion-reduce:transition-none" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 max-h-[calc(100vh-32px)] -translate-y-1/2 overflow-y-auto rounded-lg border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)] outline-none sm:left-1/2 sm:w-[min(92vw,520px)] sm:-translate-x-1/2">
          <div className="flex items-start gap-3 border-b border-[#d8dee4] px-5 py-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#ffebe9] text-[#cf222e]">
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-[#24292f]">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-5 text-[#57606a]">{description}</Dialog.Description>
            </div>
            <Dialog.Close disabled={pending} className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa] disabled:opacity-50" aria-label={`关闭${title}`}>
              <X size={17} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="grid gap-4 px-5 py-5">
            {confirmationText ? (
              <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                输入 {confirmationText} 以确认
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={pending}
                  className="h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                />
              </label>
            ) : null}
            {error ? <div role="alert" className="text-sm font-medium text-[#cf222e]">{error}</div> : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#d8dee4] bg-[#fbfcfd] px-5 py-3">
            <Dialog.Close asChild>
              <WorkbenchButton type="button" variant="ghost" disabled={pending}>取消</WorkbenchButton>
            </Dialog.Close>
            <WorkbenchButton type="button" variant="danger" disabled={!confirmed || pending} onClick={() => void confirm()}>
              {pending ? "处理中" : actionLabel}
            </WorkbenchButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
