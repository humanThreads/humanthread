"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";

export function LoopValidationPanel({ errors }: { errors: string[] }) {
  return (
    <section
      aria-label="Loop 校验结果"
      className="border-t border-[#d0d7de] bg-white px-4 py-3"
      role="region"
    >
      {errors.length === 0 ? (
        <div className="flex items-center gap-2 text-xs font-medium text-[#116329]">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          图结构有效，可以保存或发布
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#cf222e]" />
          <div>
            <h2 className="text-xs font-semibold text-[#24292f]">需要处理 {errors.length} 项</h2>
            <ul className="mt-1 grid gap-1 text-xs text-[#cf222e]">
              {errors.map((error, index) => <li key={`${error}:${index}`}>{error}</li>)}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
