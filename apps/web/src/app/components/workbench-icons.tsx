import type { WorkbenchNavItem } from "./workbench-nav";

export function WorkbenchNavIcon({
  name,
  active,
}: {
  name: WorkbenchNavItem["icon"];
  active: boolean;
}) {
  const className = active ? "h-4 w-4 text-[#0969da]" : "h-4 w-4 text-[#57606a]";

  if (name === "home") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M1.5 7.5 8 2l6.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.5 6.5v7h9v-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "users") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.75 7.75a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M1.75 13c.4-2 2-3.5 3.75-3.5S9.1 11 9.5 13" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.5 13c.15-1.35 1.2-2.5 2.75-2.5 1.15 0 2.15.55 2.75 1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "folder") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M1.75 4.5h4l1.5 1.5h7v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1v-8Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "book") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3.5 2.5h6.75a1.75 1.75 0 0 1 1.75 1.75v9.25H5.25A1.75 1.75 0 0 0 3.5 15.25V2.5Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 5h4.5" strokeLinecap="round" />
        <path d="M5.5 7.5h4.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "tasks") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5.25 3.5h8" strokeLinecap="round" />
        <path d="M5.25 8h8" strokeLinecap="round" />
        <path d="M5.25 12.5h8" strokeLinecap="round" />
        <path d="m2.5 3.75.9.9 1.35-1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m2.5 8.25.9.9 1.35-1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m2.5 12.75.9.9 1.35-1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "agent") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="10" height="8" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="8" r="0.75" fill="currentColor" stroke="none" />
        <circle cx="10" cy="8" r="0.75" fill="currentColor" stroke="none" />
        <path d="M6 10.5c.45.4 1.1.65 2 .65s1.55-.25 2-.65" strokeLinecap="round" />
        <path d="M8 1.75v1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "loop") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="3.25" cy="4" r="1.5" />
        <circle cx="12.75" cy="8" r="1.5" />
        <circle cx="3.25" cy="12" r="1.5" />
        <path d="M4.75 4h3A3.25 3.25 0 0 1 11 7.25V8" strokeLinecap="round" />
        <path d="M11.25 8h-3A3.25 3.25 0 0 0 5 11.25V12" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "bell") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3.25 11.25h9.5c-.85-1-1.4-2.05-1.4-4.15 0-2.4-1.45-4.1-3.35-4.1S4.65 4.7 4.65 7.1c0 2.1-.55 3.15-1.4 4.15Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.25 12.5c.35.7 1.05 1.15 1.75 1.15s1.4-.45 1.75-1.15" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "chart") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2.5 13.25h11" strokeLinecap="round" />
        <path d="M4 11V7.5" strokeLinecap="round" />
        <path d="M8 11V4.75" strokeLinecap="round" />
        <path d="M12 11V6" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "layers") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="m8 2 5.5 3L8 8 2.5 5 8 2Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m2.5 8 5.5 3 5.5-3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m2.5 10.75 5.5 3 5.5-3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 5.75v4.5" strokeLinecap="round" />
      <path d="M5.75 8h4.5" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({
  className = "h-4 w-4 text-[#24292f]",
}: {
  className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3.5v9" strokeLinecap="round" />
      <path d="M3.5 8h9" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({
  className = "h-4 w-4 text-[#57606a]",
}: {
  className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="3.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.85 9.85 13.5 13.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BellIcon({
  active,
}: {
  active: boolean;
}) {
  const className = active ? "h-4 w-4 text-[#0969da]" : "h-4 w-4 text-[#57606a]";

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3.25 11.25h9.5c-.85-1-1.4-2.05-1.4-4.15 0-2.4-1.45-4.1-3.35-4.1S4.65 4.7 4.65 7.1c0 2.1-.55 3.15-1.4 4.15Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.25 12.5c.35.7 1.05 1.15 1.75 1.15s1.4-.45 1.75-1.15" strokeLinecap="round" />
    </svg>
  );
}
