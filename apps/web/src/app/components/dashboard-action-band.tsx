import Link from "next/link";
import { MotionReveal } from "./motion-reveal";

export interface DashboardActionSignal {
  key: "assigned" | "blocked" | "acceptance" | "confirmation";
  label: string;
  count: number;
  description: string;
  href: string;
}

export function DashboardActionBand({
  signals,
  motionKey,
}: {
  signals: DashboardActionSignal[];
  motionKey: string;
}) {
  return (
    <MotionReveal motionKey={motionKey}>
      <section aria-label="行动信号" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {signals.map((signal) => (
          <Link key={signal.key} href={signal.href} className="min-h-[118px] border border-[#d0d7de] bg-white p-4 transition hover:border-[#0969da] hover:bg-[#f6f8fa]">
            <div className="flex items-start justify-between gap-3"><span className="text-sm font-semibold text-[#24292f]">{signal.label}</span><span className="text-2xl font-semibold text-[#24292f]">{signal.count}</span></div>
            <p className="mt-3 text-xs leading-5 text-[#57606a]">{signal.description}</p>
          </Link>
        ))}
      </section>
    </MotionReveal>
  );
}
