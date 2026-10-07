const TONES = {
  neutral: { fill: "bg-[#8c959f]/[0.08]", bar: "bg-[#8c959f]" },
  blue: { fill: "bg-[#0969da]/[0.08]", bar: "bg-[#0969da]" },
  warning: { fill: "bg-[#9a6700]/[0.1]", bar: "bg-[#bf8700]" },
  success: { fill: "bg-[#1a7f37]/[0.1]", bar: "bg-[#1a7f37]" },
  danger: { fill: "bg-[#cf222e]/[0.1]", bar: "bg-[#cf222e]" },
} as const;

export function RoadmapProgressBackdrop({ label, percent, tone }: { label: string; percent: number; tone: keyof typeof TONES }) {
  const value = Math.min(100, Math.max(0, percent));
  const colors = TONES[tone];
  return <>
    <div className={`pointer-events-none absolute inset-0 ${colors.fill} transition-colors duration-300 motion-reduce:transition-none`} aria-hidden="true">
      <div className={`h-full ${colors.bar} opacity-[0.06] transition-[width] duration-500 ease-out motion-reduce:transition-none`} style={{ width: `${value}%` }} />
    </div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-[#eaeef2]">
      <div className={`h-full ${colors.bar} transition-[width] duration-500 ease-out motion-reduce:transition-none`} style={{ width: `${value}%` }} />
    </div>
  </>;
}
