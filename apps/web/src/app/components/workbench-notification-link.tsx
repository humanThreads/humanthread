"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellIcon } from "./workbench-icons";

export function WorkbenchNotificationLink({
  initialUnreadCount = 0,
}: {
  initialUnreadCount?: number;
}) {
  const [loadedUnreadCount, setLoadedUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      try {
        const response = await fetch("/api/notifications/summary", {
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          ok: boolean;
          summary?: {
            unreadCount: number;
          };
        };

        if (!cancelled && payload.ok && payload.summary) {
          setLoadedUnreadCount(payload.summary.unreadCount);
        }
      } catch {
        // Ignore summary refresh failures and keep the last known badge count.
      }
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [initialUnreadCount]);

  const unreadCount = loadedUnreadCount ?? initialUnreadCount;

  return (
    <Link
      href="/notifications"
      className="relative grid h-7 w-7 place-items-center rounded-full transition hover:bg-[#f6f8fa]"
      aria-label="站内信"
    >
      <BellIcon active={false} />
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 grid h-3 min-w-3 place-items-center rounded-full border border-white bg-[#cf222e] px-1 text-[8px] font-semibold leading-none text-white">
          {unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
