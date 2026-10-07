import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type WorkbenchButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type WorkbenchButtonSize = "normal" | "small";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md border font-semibold shadow-[0_1px_0_rgba(31,35,40,0.04)] transition";

const BUTTON_VARIANTS: Record<WorkbenchButtonVariant, string> = {
  primary: "border-[#1f883d] bg-[#1f883d] text-white hover:bg-[#1a7f37]",
  secondary:
    "border-[#d0d7de] bg-[#f6f8fa] text-[#24292f] hover:bg-[#f3f4f6]",
  danger:
    "border-[#d0d7de] bg-white text-[#cf222e] hover:border-[#a40e26] hover:bg-[#a40e26] hover:text-white",
  ghost: "border-[#d0d7de] bg-white text-[#24292f] hover:bg-[#f6f8fa]",
};

const BUTTON_SIZES: Record<WorkbenchButtonSize, string> = {
  normal: "min-h-8 px-3 py-1.5 text-sm",
  small: "min-h-7 px-2.5 py-1 text-xs",
};

export function getWorkbenchButtonClassName(
  input: {
    variant?: WorkbenchButtonVariant;
    size?: WorkbenchButtonSize;
    className?: string | undefined;
  } = {},
) {
  return [
    BUTTON_BASE,
    BUTTON_VARIANTS[input.variant ?? "secondary"],
    BUTTON_SIZES[input.size ?? "normal"],
    input.className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function WorkbenchButton({
  href,
  variant = "secondary",
  size = "normal",
  className,
  children,
  ...props
}: {
  href?: string;
  variant?: WorkbenchButtonVariant;
  size?: WorkbenchButtonSize;
  className?: string | undefined;
  children?: ReactNode;
} & ComponentPropsWithoutRef<"button">) {
  const classes = getWorkbenchButtonClassName({ variant, size, className });

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button {...props} className={classes}>
      {children}
    </button>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 mt-4 flex flex-wrap items-start justify-between gap-4 border-b border-[#d0d7de] px-4 pb-4 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#24292f]">
          {title}
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#57606a]">
          {subtitle}
        </p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section
      className={[
        "overflow-hidden rounded-lg border border-[#d0d7de] bg-white",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#d8dee4] bg-[#f6f8fa] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#24292f]">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function KpiCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#57606a]">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[#24292f]">
        {value}
      </div>
      <div className="mt-2 text-xs leading-5 text-[#57606a]">{caption}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#d0d7de] bg-[#f6f8fa] p-5 text-sm text-[#57606a]">
      <div className="font-semibold text-[#24292f]">{title}</div>
      <p className="mt-1 leading-6">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Callout({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#b6d7f2] bg-[#ddf4ff] p-4 text-sm leading-6 text-[#0a3069]">
      <div className="font-semibold">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function StatusPill({
  tone = "default",
  children,
}: {
  tone?: "default" | "success" | "danger" | "warning" | "blue";
  children?: ReactNode;
}) {
  const tones = {
    default: "border-[#d0d7de] bg-white text-[#24292f]",
    success: "border-[#2da44e33] bg-[#dafbe1] text-[#116329]",
    danger: "border-[#cf222e33] bg-[#ffebe9] text-[#cf222e]",
    warning: "border-[#d4a72c33] bg-[#fff8c5] text-[#9a6700]",
    blue: "border-[#0969da33] bg-[#ddf4ff] text-[#0a3069]",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function SegmentedControl({
  items,
  activeKey,
}: {
  items: Array<{
    key: string;
    label: string;
    href: string;
  }>;
  activeKey: string;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-[#d0d7de] bg-white">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={
            item.key === activeKey
              ? "border-r border-[#d0d7de] bg-[#0969da] px-3 py-1.5 text-xs font-semibold text-white last:border-r-0"
              : "border-r border-[#d0d7de] px-3 py-1.5 text-xs font-semibold text-[#24292f] hover:bg-[#f6f8fa] last:border-r-0"
          }
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
