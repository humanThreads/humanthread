"use client";

import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { WorkbenchButton } from "./workbench-ui";

export function SettingsSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border-b border-[#d8dee4] py-6 first:pt-1 last:border-b-0 last:pb-0">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[#24292f]">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#57606a]">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SettingsFormActions({
  dirty,
  pending,
  onCancel,
  successMessage,
  errorMessage,
  saveLabel = "保存",
}: {
  dirty: boolean;
  pending: boolean;
  onCancel: () => void;
  successMessage?: string;
  errorMessage?: string;
  saveLabel?: string;
}) {
  if (!dirty && !pending && !successMessage && !errorMessage) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[#d8dee4] pt-4" aria-live="polite">
      {successMessage ? (
        <span className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-[#116329]">
          <CheckCircle2 size={16} aria-hidden="true" />
          {successMessage}
        </span>
      ) : null}
      {errorMessage ? (
        <span role="alert" className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-[#cf222e]">
          <CircleAlert size={16} aria-hidden="true" />
          {errorMessage}
        </span>
      ) : null}
      {dirty || pending ? (
        <>
          <WorkbenchButton type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            取消
          </WorkbenchButton>
          <WorkbenchButton type="submit" variant="primary" disabled={pending || !dirty}>
            {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" size={16} aria-hidden="true" /> : null}
            {pending ? "保存中" : saveLabel}
          </WorkbenchButton>
        </>
      ) : null}
    </div>
  );
}
